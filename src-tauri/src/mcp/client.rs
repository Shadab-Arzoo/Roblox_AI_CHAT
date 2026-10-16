use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::Duration;

/// JSON-RPC request
#[derive(Serialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// JSON-RPC response
#[derive(Deserialize, Debug)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: Option<u64>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcError {
    code: i64,
    message: String,
}

/// An MCP tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Option<Value>,
}

/// MCP connection status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpStatus {
    pub connected: bool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: usize,
    pub error: Option<String>,
}

/// Result from a tool call
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub success: bool,
    pub content: Value,
    pub error: Option<String>,
}

/// Studio instance info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioInstance {
    pub studio_id: String,
    pub name: String,
    pub place_id: Option<String>,
}

pub struct McpClient {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    rx: Mutex<Option<Receiver<String>>>,
    next_id: AtomicU64,
    tools: Mutex<Vec<McpTool>>,
    server_info: Mutex<Option<(String, String)>>,
}

impl McpClient {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            rx: Mutex::new(None),
            next_id: AtomicU64::new(1),
            tools: Mutex::new(vec![]),
            server_info: Mutex::new(None),
        }
    }

    /// Get the MCP command for the current OS
    fn get_mcp_command() -> (String, Vec<String>) {
        if cfg!(target_os = "windows") {
            let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
            let mcp_bat = format!("{}\\Roblox\\mcp.bat", local_app_data);
            ("cmd.exe".to_string(), vec!["/c".to_string(), mcp_bat])
        } else if cfg!(target_os = "macos") {
            ("/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP".to_string(), vec![])
        } else {
            ("cmd.exe".to_string(), vec!["/c".to_string(), "mcp.bat".to_string()])
        }
    }

    /// Connect to the Roblox Studio MCP server via stdio without hanging
    pub fn connect(&self) -> Result<McpStatus, String> {
        let (cmd, args) = Self::get_mcp_command();

        let mut child = Command::new(&cmd)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start MCP server process '{}': {}. Make sure Roblox Studio is installed.", cmd, e))?;

        let stdin = child.stdin.take().ok_or("Cannot access MCP server stdin")?;
        let stdout = child.stdout.take().ok_or("Cannot access MCP server stdout")?;

        let (tx, rx) = channel::<String>();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line) {
                if n == 0 { break; }
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let _ = tx.send(trimmed.to_string());
                }
                line.clear();
            }
        });

        *self.child.lock().unwrap() = Some(child);
        *self.stdin.lock().unwrap() = Some(stdin);
        *self.rx.lock().unwrap() = Some(rx);

        // Send initialize request with 3-second timeout
        let init_result = self.send_request_timeout("initialize", Some(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "ForgePilot",
                "version": "0.1.0"
            }
        })), 3000)?;

        let server_name = init_result.get("serverInfo")
            .and_then(|s| s.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("RobloxStudio")
            .to_string();
        let server_version = init_result.get("serverInfo")
            .and_then(|s| s.get("version"))
            .and_then(|v| v.as_str())
            .unwrap_or("1.0.0")
            .to_string();

        *self.server_info.lock().unwrap() = Some((server_name.clone(), server_version.clone()));

        // Send initialized notification
        self.send_notification("notifications/initialized", None)?;

        // Query tools with a fast 1.5s timeout (Roblox Studio pushes tools when place is open)
        let tools: Vec<McpTool> = match self.send_request_timeout("tools/list", None, 1500) {
            Ok(tools_result) => {
                if let Some(tools_array) = tools_result.get("tools") {
                    serde_json::from_value(tools_array.clone()).unwrap_or_default()
                } else {
                    vec![]
                }
            }
            Err(_) => vec![],
        };

        let tools_count = tools.len();
        *self.tools.lock().unwrap() = tools;

        Ok(McpStatus {
            connected: true,
            server_name: Some(server_name),
            server_version: Some(server_version),
            tools_count,
            error: None,
        })
    }

    /// Disconnect from the MCP server
    pub fn disconnect(&self) -> Result<(), String> {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *self.stdin.lock().unwrap() = None;
        *self.rx.lock().unwrap() = None;
        *self.tools.lock().unwrap() = vec![];
        *self.server_info.lock().unwrap() = None;
        Ok(())
    }

    /// Get current connection status
    pub fn status(&self) -> McpStatus {
        let child = self.child.lock().unwrap();
        let info = self.server_info.lock().unwrap();
        let tools = self.tools.lock().unwrap();

        if child.is_some() && info.is_some() {
            let (name, version) = info.as_ref().unwrap().clone();
            McpStatus {
                connected: true,
                server_name: Some(name),
                server_version: Some(version),
                tools_count: tools.len(),
                error: None,
            }
        } else {
            McpStatus {
                connected: false,
                server_name: None,
                server_version: None,
                tools_count: 0,
                error: None,
            }
        }
    }

    /// Get list of available tools, refreshing if currently empty
    pub fn get_tools(&self) -> Vec<McpTool> {
        let mut tools = self.tools.lock().unwrap().clone();
        if tools.is_empty() {
            if let Ok(tools_result) = self.send_request_timeout("tools/list", None, 1000) {
                if let Some(tools_array) = tools_result.get("tools") {
                    if let Ok(parsed) = serde_json::from_value::<Vec<McpTool>>(tools_array.clone()) {
                        *self.tools.lock().unwrap() = parsed.clone();
                        tools = parsed;
                    }
                }
            }
        }
        tools
    }

    /// Call an MCP tool with timeout
    pub fn call_tool(&self, tool_name: &str, arguments: Value) -> Result<ToolCallResult, String> {
        let result = self.send_request_timeout("tools/call", Some(json!({
            "name": tool_name,
            "arguments": arguments,
        })), 12000)?;

        let content = result.get("content").cloned().unwrap_or(json!([]));

        Ok(ToolCallResult {
            success: true,
            content,
            error: None,
        })
    }

    /// List connected Roblox Studio instances
    pub fn list_studios(&self) -> Result<Vec<StudioInstance>, String> {
        let result = self.call_tool("list_roblox_studios", json!({}))?;
        let mut studios = vec![];
        if let Some(arr) = result.content.as_array() {
            for item in arr {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                        if let Some(instances) = parsed.as_array() {
                            for inst in instances {
                                studios.push(StudioInstance {
                                    studio_id: inst.get("studioId")
                                        .or_else(|| inst.get("studio_id"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    name: inst.get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown")
                                        .to_string(),
                                    place_id: inst.get("placeId")
                                        .or_else(|| inst.get("place_id"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                });
                            }
                        }
                    }
                }
            }
        }
        Ok(studios)
    }

    /// Send a JSON-RPC request and wait for the response matching our id with timeout
    fn send_request_timeout(&self, method: &str, params: Option<Value>, timeout_ms: u64) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };

        let request_str = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;

        // Write request to stdin
        {
            let mut stdin_guard = self.stdin.lock().unwrap();
            let stdin = stdin_guard.as_mut().ok_or("MCP server is not connected")?;
            writeln!(stdin, "{}", request_str)
                .map_err(|e| format!("Failed to send to MCP server: {}", e))?;
            stdin.flush()
                .map_err(|e| format!("Failed to flush MCP stdin: {}", e))?;
        }

        // Wait for response matching our ID from the reader thread
        let rx_guard = self.rx.lock().unwrap();
        let rx = rx_guard.as_ref().ok_or("MCP receiver channel not available")?;

        let start = std::time::Instant::now();
        let timeout = Duration::from_millis(timeout_ms);

        while start.elapsed() < timeout {
            let remaining = timeout.saturating_sub(start.elapsed());
            match rx.recv_timeout(remaining) {
                Ok(line) => {
                    if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                        if response.id == Some(id) {
                            if let Some(error) = response.error {
                                return Err(format!("MCP error {}: {}", error.code, error.message));
                            }
                            return response.result.ok_or_else(|| "Empty result from MCP server".to_string());
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    return Err(format!("MCP request '{}' timed out after {}ms", method, timeout_ms));
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("MCP server stdout closed unexpectedly".to_string());
                }
            }
        }

        Err(format!("MCP request '{}' timed out after {}ms", method, timeout_ms))
    }

    /// Send a JSON-RPC notification (no response expected)
    fn send_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let notification = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(json!({})),
        });

        let notification_str = serde_json::to_string(&notification)
            .map_err(|e| format!("Failed to serialize notification: {}", e))?;

        let mut stdin_guard = self.stdin.lock().unwrap();
        let stdin = stdin_guard.as_mut().ok_or("MCP server is not connected")?;
        writeln!(stdin, "{}", notification_str)
            .map_err(|e| format!("Failed to send notification: {}", e))?;
        stdin.flush()
            .map_err(|e| format!("Failed to flush MCP stdin: {}", e))?;

        Ok(())
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        let _ = self.disconnect();
    }
}
