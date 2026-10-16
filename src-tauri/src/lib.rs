mod providers;
mod mcp;
mod wiggle;
mod studio;

use studio::StudioInfo;

use providers::ollama::OllamaClient;
use providers::cloud::CloudClient;
use providers::{ChatMessage, ProviderStatus, StreamChunk};
use mcp::McpClient;
use mcp::client::{McpStatus, McpTool, StudioInstance, ToolCallResult};

use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, State};

/// Application state shared across all commands
pub struct AppState {
    ollama: OllamaClient,
    cloud: CloudClient,
    mcp: McpClient,
    cancel_flag: Arc<AtomicBool>,
    wiggle_enabled: Arc<AtomicBool>,
}

// ─── Ollama Commands ───────────────────────────────────────────────

#[tauri::command]
async fn ollama_status(state: State<'_, AppState>) -> Result<ProviderStatus, String> {
    Ok(state.ollama.status().await)
}

#[tauri::command]
async fn ollama_models(state: State<'_, AppState>) -> Result<Vec<providers::ModelInfo>, String> {
    state.ollama.list_models().await
}

#[tauri::command]
async fn ollama_chat(
    state: State<'_, AppState>,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    state.ollama.chat(&model, messages).await
}

#[tauri::command]
async fn ollama_chat_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model: String,
    messages: Vec<ChatMessage>,
    conversation_id: String,
) -> Result<String, String> {
    state.cancel_flag.store(false, Ordering::Relaxed);
    let cancel = state.cancel_flag.clone();
    let ollama = state.ollama.clone();
    let app_handle = app.clone();
    let conv_id = conversation_id.clone();

    let result = ollama.chat_stream(&model, messages, cancel, move |chunk: StreamChunk| {
        let _ = app_handle.emit("chat-stream", serde_json::json!({
            "conversationId": conv_id,
            "content": chunk.content,
            "done": chunk.done,
        }));
    }).await;

    result
}

#[tauri::command]
async fn cancel_stream(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

// ─── Cloud Commands (OpenAI, GitHub Models, Gemini, Custom) ────────

#[tauri::command]
async fn cloud_test_connection(
    state: State<'_, AppState>,
    base_url: String,
    api_key: String,
    model: String,
) -> Result<String, String> {
    state.cloud.test_connection(&base_url, &api_key, &model).await
}

#[tauri::command]
async fn cloud_chat_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    conversation_id: String,
) -> Result<String, String> {
    state.cancel_flag.store(false, Ordering::Relaxed);
    let cancel = state.cancel_flag.clone();
    let cloud = state.cloud.clone();
    let app_handle = app.clone();
    let conv_id = conversation_id.clone();

    let result = cloud
        .chat_stream(&base_url, &api_key, &model, messages, cancel, move |chunk: StreamChunk| {
            let _ = app_handle.emit(
                "chat-stream",
                serde_json::json!({
                    "conversationId": conv_id,
                    "content": chunk.content,
                    "done": chunk.done,
                }),
            );
        })
        .await;

    result
}

// ─── MCP Commands ──────────────────────────────────────────────────

#[tauri::command]
async fn mcp_connect(state: State<'_, AppState>) -> Result<McpStatus, String> {
    state.mcp.connect()
}

#[tauri::command]
async fn mcp_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    state.mcp.disconnect()
}

#[tauri::command]
async fn mcp_status(state: State<'_, AppState>) -> Result<McpStatus, String> {
    Ok(state.mcp.status())
}

#[tauri::command]
async fn mcp_tools(state: State<'_, AppState>) -> Result<Vec<McpTool>, String> {
    Ok(state.mcp.get_tools())
}

#[tauri::command]
async fn mcp_call_tool(
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Value,
) -> Result<ToolCallResult, String> {
    state.mcp.call_tool(&tool_name, arguments)
}

#[tauri::command]
async fn mcp_list_studios(state: State<'_, AppState>) -> Result<Vec<StudioInstance>, String> {
    state.mcp.list_studios()
}

// ─── Direct Roblox Studio Commands ─────────────────────────────────

#[tauri::command]
async fn studio_status() -> Result<StudioInfo, String> {
    if let Some((_hwnd, title, pid)) = studio::find_studio_window() {
        Ok(StudioInfo {
            running: true,
            title,
            pid,
        })
    } else {
        Ok(StudioInfo {
            running: false,
            title: String::new(),
            pid: 0,
        })
    }
}

#[tauri::command]
async fn studio_execute(code: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        studio::run_code_in_studio(&code)
    })
    .await
    .map_err(|e| format!("Execution error: {}", e))?
}

// ─── Window Commands ───────────────────────────────────────────────

#[tauri::command]
async fn set_compact_mode(window: tauri::Window) -> Result<(), String> {
    let (screen_w, screen_h) = if let Ok(Some(m)) = window.current_monitor() {
        let size = m.size().to_logical::<f64>(m.scale_factor());
        (size.width, size.height)
    } else {
        (1024.0, 576.0)
    };

    let target_w = 390.0f64.min(screen_w - 30.0);
    let target_h = 500.0f64.min(screen_h - 50.0);

    window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: target_w, height: target_h }))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(true)
        .map_err(|e| e.to_string())?;

    // Ensure window position is safely on screen
    if let Ok(pos) = window.outer_position() {
        let scale = window.scale_factor().unwrap_or(1.0);
        let log_y = (pos.y as f64) / scale;
        if log_y < 15.0 || (log_y + target_h) > screen_h {
            let safe_y = 25.0f64.max((screen_h - target_h) / 2.0);
            let safe_x = (pos.x as f64 / scale).min(screen_w - target_w - 20.0).max(20.0);
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: safe_x, y: safe_y }));
        }
    }
    Ok(())
}

#[tauri::command]
async fn set_fullscreen_mode(window: tauri::Window) -> Result<(), String> {
    let (screen_w, screen_h) = if let Ok(Some(m)) = window.current_monitor() {
        let size = m.size().to_logical::<f64>(m.scale_factor());
        (size.width, size.height)
    } else {
        (1024.0, 576.0)
    };

    let target_w = 960.0f64.min(screen_w - 40.0);
    let target_h = 530.0f64.min(screen_h - 50.0);

    window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: target_w, height: target_h }))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(false)
        .map_err(|e| e.to_string())?;
    window.center()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_always_on_top(window: tauri::Window, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(dead_code)]
async fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(dead_code)]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_wiggle_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.wiggle_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

// ─── Application Setup ────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let wiggle_flag = Arc::new(AtomicBool::new(true));
    let wiggle_flag_clone = wiggle_flag.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            wiggle::start_wiggle_detector(app.handle().clone(), wiggle_flag_clone);
            Ok(())
        })
        .manage(AppState {
            ollama: OllamaClient::new(None),
            cloud: CloudClient::new(),
            mcp: McpClient::new(),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            wiggle_enabled: wiggle_flag,
        })
        .invoke_handler(tauri::generate_handler![
            // Ollama
            ollama_status,
            ollama_models,
            ollama_chat,
            ollama_chat_stream,
            cancel_stream,
            // Cloud (OpenAI, GitHub, Gemini, Custom)
            cloud_test_connection,
            cloud_chat_stream,
            // MCP
            mcp_connect,
            mcp_disconnect,
            mcp_status,
            mcp_tools,
            mcp_call_tool,
            mcp_list_studios,
            // Direct Roblox Studio
            studio_status,
            studio_execute,
            // Window
            set_compact_mode,
            set_fullscreen_mode,
            set_always_on_top,
            minimize_window,
            close_window,
            set_wiggle_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ForgePilot");
}
