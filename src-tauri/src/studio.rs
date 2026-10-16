use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct StudioInfo {
    pub running: bool,
    pub title: String,
    pub pid: u32,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetForegroundWindow() -> isize;
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

                // Prioritize window that has "Roblox Studio" or "Place" in title
                if title.contains("Roblox Studio") || title.contains("Place") {
                    *out = Some((hwnd, title, pid));
                    return 0; // Found primary Studio window, stop enumerating
                } else if out.is_none() {
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
fn send_ctrl_plus_key(vk: u8) {
    unsafe {
        const KEYEVENTF_KEYUP: u32 = 0x0002;
        const VK_CONTROL: u8 = 0x11;

        keybd_event(VK_CONTROL, 0, 0, 0);
        std::thread::sleep(Duration::from_millis(20));
        keybd_event(vk, 0, 0, 0);
        std::thread::sleep(Duration::from_millis(30));
        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        std::thread::sleep(Duration::from_millis(20));
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
    }
}

#[cfg(target_os = "windows")]
fn send_key_press(vk: u8) {
    unsafe {
        const KEYEVENTF_KEYUP: u32 = 0x0002;
        keybd_event(vk, 0, 0, 0);
        std::thread::sleep(Duration::from_millis(30));
        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
    }
}

/// Cleans and sanitizes Luau code for smooth command bar execution.
/// Removes lines that are only comments so that they don't break single-line command bar execution.
pub fn sanitize_luau_code(code: &str) -> String {
    let mut cleaned = Vec::new();
    for line in code.lines() {
        let trimmed = line.trim();
        // Skip pure single-line comment lines
        if trimmed.starts_with("--") && !trimmed.starts_with("--[[") {
            continue;
        }
        // If line has trailing comment, strip it unless inside a string literal
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
    let (hwnd, title, _pid) = find_studio_window()
        .ok_or_else(|| "Roblox Studio is not running or no active Place is open. Please open your Place in Roblox Studio.".to_string())?;

    let clean_code = sanitize_luau_code(code);
    if clean_code.trim().is_empty() {
        return Err("No executable Luau code found to run.".to_string());
    }

    // Set clipboard with clean code
    set_clipboard_text(&clean_code)?;

    unsafe {
        // Restore window if minimized
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, 9); // SW_RESTORE
        }

        // Attach thread input to reliably gain foreground focus
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

    // Give Studio a moment to become active
    std::thread::sleep(Duration::from_millis(150));

    // 1. Focus Command Bar: Ctrl + J (0x4A)
    send_ctrl_plus_key(0x4A);
    std::thread::sleep(Duration::from_millis(100));

    // 2. Paste code into Command Bar: Ctrl + V (0x56)
    send_ctrl_plus_key(0x56);
    std::thread::sleep(Duration::from_millis(100));

    // 3. Execute command: Enter (0x0D)
    send_key_press(0x0D);
    std::thread::sleep(Duration::from_millis(150));

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
