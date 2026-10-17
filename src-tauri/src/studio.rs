use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct StudioInfo {
    pub running: bool,
    pub title: String,
    pub pid: u32,
    pub bridge_connected: bool,
}

static BRIDGE_QUEUE: OnceLock<Arc<Mutex<Option<String>>>> = OnceLock::new();
static LAST_PLUGIN_POLL: AtomicU64 = AtomicU64::new(0);

const BRIDGE_PLUGIN_LUA: &str = r#"-- ForgePilot Autonomous Studio Bridge Plugin
-- Automatically loads and executes Luau scripts from ForgePilot directly into your active workspace.

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

print("⚡ [ForgePilot] Autonomous Studio Bridge loaded & active!")

local PORT = 32128
local isPolling = true

if plugin and plugin.Unloading then
    plugin.Unloading:Connect(function()
        isPolling = false
        print("⚡ [ForgePilot] Bridge unloaded cleanly.")
    end)
end

task.spawn(function()
    while isPolling do
        local ok, response = pcall(function()
            return HttpService:GetAsync("http://127.0.0.1:" .. PORT .. "/poll?t=" .. tostring(os.clock()), true)
        end)

        if ok and response and #response > 0 then
            local data = nil
            pcall(function()
                data = HttpService:JSONDecode(response)
            end)

            if data and data.code and #data.code > 0 then
                print("⚡ [ForgePilot] Received script — executing in Workspace...")
                local fn, compileErr = loadstring(data.code)
                if fn then
                    setfenv(fn, getfenv(0))
                    task.spawn(function()
                        local recording = nil
                        pcall(function()
                            recording = ChangeHistoryService:TryBeginRecording("ForgePilot Generation")
                        end)

                        local runOk, runErr = pcall(fn)

                        if recording then
                            pcall(function()
                                ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
                            end)
                        else
                            pcall(function()
                                ChangeHistoryService:SetWaypoint("ForgePilot Generation")
                            end)
                        end

                        if runOk then
                            print("⚡ [ForgePilot] Successfully executed in Workspace!")
                        else
                            warn("⚡ [ForgePilot] Runtime error:", tostring(runErr))
                        end
                    end)
                else
                    warn("⚡ [ForgePilot] Compile error:", tostring(compileErr))
                end
            end
            task.wait(0.5)
        else
            task.wait(1.0)
        end
    end
end)
"#;

pub fn ensure_bridge_plugin_installed() {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let plugins_dir = std::path::PathBuf::from(local_app_data).join("Roblox").join("Plugins");
        if let Err(e) = std::fs::create_dir_all(&plugins_dir) {
            eprintln!("Failed to create plugins dir: {}", e);
            return;
        }

        let lua_path = plugins_dir.join("ForgePilotBridge.lua");
        let luau_path = plugins_dir.join("ForgePilotBridge.luau");

        let _ = std::fs::write(lua_path, BRIDGE_PLUGIN_LUA);
        let _ = std::fs::write(luau_path, BRIDGE_PLUGIN_LUA);
    }
}

fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn is_bridge_connected() -> bool {
    let last = LAST_PLUGIN_POLL.load(Ordering::Relaxed);
    if last == 0 {
        return false;
    }
    current_timestamp_secs().saturating_sub(last) < 4
}

pub fn get_bridge_queue() -> &'static Arc<Mutex<Option<String>>> {
    BRIDGE_QUEUE.get_or_init(|| {
        ensure_bridge_plugin_installed();
        let queue = Arc::new(Mutex::new(None));
        let q_clone = queue.clone();

        std::thread::spawn(move || {
            let addr = "127.0.0.1:32128";
            let listener = match std::net::TcpListener::bind(addr) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Failed to bind bridge server to {}: {}", addr, e);
                    return;
                }
            };

            for stream in listener.incoming() {
                if let Ok(mut s) = stream {
                    let q = q_clone.clone();
                    std::thread::spawn(move || {
                        use std::io::{Read, Write};
                        let mut buf = [0u8; 1024];
                        if let Ok(n) = s.read(&mut buf) {
                            if n > 0 {
                                let req = String::from_utf8_lossy(&buf[..n]);
                                if req.starts_with("GET /poll") {
                                    LAST_PLUGIN_POLL.store(current_timestamp_secs(), Ordering::Relaxed);

                                    let code_to_run = {
                                        let mut guard = q.lock().unwrap();
                                        guard.take()
                                    };

                                    let body = if let Some(code) = code_to_run {
                                        serde_json::json!({ "code": code }).to_string()
                                    } else {
                                        serde_json::json!({ "status": "idle" }).to_string()
                                    };

                                    let resp = format!(
                                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache, no-store, must-revalidate\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                        body.len(),
                                        body
                                    );
                                    let _ = s.write_all(resp.as_bytes());
                                }
                            }
                        }
                    });
                }
            }
        });

        queue
    })
}

#[cfg(target_os = "windows")]
extern "system" {
    fn SetForegroundWindow(hWnd: isize) -> i32;
    fn BringWindowToTop(hWnd: isize) -> i32;
    fn ShowWindow(hWnd: isize, nCmdShow: i32) -> i32;
    fn IsWindowVisible(hWnd: isize) -> i32;
    fn IsIconic(hWnd: isize) -> i32;
    fn EnumWindows(lpEnumFunc: unsafe extern "system" fn(isize, isize) -> i32, lParam: isize) -> i32;
    fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
    fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
    fn CloseHandle(hObject: isize) -> i32;
    fn QueryFullProcessImageNameW(hProcess: isize, dwFlags: u32, lpExeName: *mut u16, lpdwSize: *mut u32) -> i32;
    fn keybd_event(bVk: u8, bScan: u8, dwFlags: u32, dwExtraInfo: usize);
    fn GetCurrentThreadId() -> u32;
    fn AttachThreadInput(idAttach: u32, idAttachTo: u32, fAttach: i32) -> i32;
    fn OpenClipboard(hWndNewOwner: isize) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> isize;
    fn GlobalLock(hMem: isize) -> *mut u8;
    fn GlobalUnlock(hMem: isize) -> i32;
    fn SetClipboardData(uFormat: u32, hMem: isize) -> isize;
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_studio_proc(hwnd: isize, lparam: isize) -> i32 {
    let out = &mut *(lparam as *mut Option<(isize, String, u32)>);

    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        return 1;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if hproc != 0 {
        let mut exe_buf = [0u16; 512];
        let mut size = 512u32;
        let success = QueryFullProcessImageNameW(hproc, 0, exe_buf.as_mut_ptr(), &mut size);
        CloseHandle(hproc);

        if success != 0 {
            let path = String::from_utf16_lossy(&exe_buf[..size as usize]);
            if path.ends_with("RobloxStudioBeta.exe") || path.contains("RobloxStudio") {
                let mut title_buf = [0u16; 512];
                let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
                let title = if len > 0 {
                    String::from_utf16_lossy(&title_buf[..len as usize])
                } else {
                    String::new()
                };

                // Prioritize the main Studio window with "Roblox Studio" or "Place" in title
                if title.contains("Roblox Studio") || title.contains("Place") {
                    *out = Some((hwnd, title, pid));
                    return 0;
                } else if !title.trim().is_empty() && out.is_none() {
                    *out = Some((hwnd, title, pid));
                }
            }
        }
    }

    1
}

#[cfg(target_os = "windows")]
pub fn find_studio_window() -> Option<(isize, String, u32)> {
    unsafe {
        let mut result: Option<(isize, String, u32)> = None;
        EnumWindows(enum_studio_proc, &mut result as *mut _ as isize);
        result
    }
}

#[cfg(target_os = "windows")]
fn set_clipboard_text(text: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    unsafe {
        let wide: Vec<u16> = OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect();
        let bytes_len = wide.len() * 2;

        const GMEM_MOVEABLE: u32 = 0x0002;
        const CF_UNICODETEXT: u32 = 13;

        if OpenClipboard(0) == 0 {
            return Err("Could not open Windows clipboard".to_string());
        }
        EmptyClipboard();

        let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes_len);
        if hmem != 0 {
            let ptr = GlobalLock(hmem);
            if !ptr.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr, bytes_len);
                GlobalUnlock(hmem);
                SetClipboardData(CF_UNICODETEXT, hmem);
            }
        }
        CloseClipboard();
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn send_ctrl_plus_key(vk: u8, scan: u8) {
    unsafe {
        const KEYEVENTF_KEYUP: u32 = 0x0002;
        const VK_CONTROL: u8 = 0x11;

        keybd_event(VK_CONTROL, 0x1D, 0, 0);
        std::thread::sleep(Duration::from_millis(25));
        keybd_event(vk, scan, 0, 0);
        std::thread::sleep(Duration::from_millis(35));
        keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
        std::thread::sleep(Duration::from_millis(25));
        keybd_event(VK_CONTROL, 0x1D, KEYEVENTF_KEYUP, 0);
    }
}

#[cfg(target_os = "windows")]
fn send_key_press(vk: u8, scan: u8) {
    unsafe {
        const KEYEVENTF_KEYUP: u32 = 0x0002;
        keybd_event(vk, scan, 0, 0);
        std::thread::sleep(Duration::from_millis(30));
        keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
    }
}

pub fn sanitize_luau_code(code: &str) -> String {
    let mut cleaned = Vec::new();
    for line in code.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("--") && !trimmed.starts_with("--[[") {
            continue;
        }
        if let Some(pos) = line.find("--") {
            let prefix = &line[..pos];
            let quotes = prefix.chars().filter(|&c| c == '"' || c == '\'').count();
            if quotes % 2 == 0 {
                let trimmed_prefix = prefix.trim_end();
                if !trimmed_prefix.is_empty() {
                    cleaned.push(trimmed_prefix.to_string());
                }
                continue;
            }
        }
        if !trimmed.is_empty() {
            cleaned.push(line.to_string());
        }
    }
    cleaned.join("\n")
}

#[cfg(target_os = "windows")]
pub fn run_code_in_studio(code: &str) -> Result<String, String> {
    let clean_code = sanitize_luau_code(code);
    if clean_code.trim().is_empty() {
        return Err("No executable Luau code found to run.".to_string());
    }

    ensure_bridge_plugin_installed();

    // 1. Put into the local Studio Plugin Bridge queue:
    // If ForgePilotBridge.lua is loaded in Studio, it polls & executes autonomously!
    {
        let queue = get_bridge_queue();
        *queue.lock().unwrap() = Some(clean_code.clone());
    }

    // If the Studio Bridge plugin is actively polling, it picks it up in <500ms
    if is_bridge_connected() {
        return Ok("⚡ Executed autonomously via Studio Bridge Plugin!".to_string());
    }

    // 2. Direct Studio Command Bar Focus & Run:
    // Uses official Studio shortcut Ctrl + 9 to focus Command Bar directly!
    // No mouse snapping, no cursor guessing, no Explorer selection!
    let (hwnd, title, _pid) = find_studio_window()
        .ok_or_else(|| "Roblox Studio is not running or no active Place is open. Please open your Place in Roblox Studio.".to_string())?;

    set_clipboard_text(&clean_code)?;

    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, 9);
        }

        let cur_thread = GetCurrentThreadId();
        let target_thread = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
        if cur_thread != target_thread && target_thread != 0 {
            AttachThreadInput(cur_thread, target_thread, 1);
        }

        SetForegroundWindow(hwnd);
        BringWindowToTop(hwnd);

        if cur_thread != target_thread && target_thread != 0 {
            AttachThreadInput(cur_thread, target_thread, 0);
        }
    }

    std::thread::sleep(Duration::from_millis(150));

    // Focus Command Bar via official Studio shortcut: Ctrl + 9 (VK 0x39, Scan 0x0A)
    send_ctrl_plus_key(0x39, 0x0A);
    std::thread::sleep(Duration::from_millis(80));

    // Clear any previous text in Command Bar: Ctrl + A (VK 0x41, Scan 0x1E)
    send_ctrl_plus_key(0x41, 0x1E);
    std::thread::sleep(Duration::from_millis(50));

    // Paste code: Ctrl + V (VK 0x56, Scan 0x2F)
    send_ctrl_plus_key(0x56, 0x2F);
    std::thread::sleep(Duration::from_millis(100));

    // Execute: Ctrl + Enter (VK 0x0D, Scan 0x1C)
    send_ctrl_plus_key(0x0D, 0x1C);
    std::thread::sleep(Duration::from_millis(50));
    // Additional Enter press for standard Enter execution mode
    send_key_press(0x0D, 0x1C);
    std::thread::sleep(Duration::from_millis(80));

    let display_title = if title.is_empty() { "Roblox Studio" } else { &title };
    Ok(format!("⚡ Executed directly in {} Workspace!", display_title))
}

#[cfg(not(target_os = "windows"))]
pub fn run_code_in_studio(_code: &str) -> Result<String, String> {
    Err("Direct Roblox Studio execution is currently supported on Windows.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn find_studio_window() -> Option<(isize, String, u32)> {
    None
}
