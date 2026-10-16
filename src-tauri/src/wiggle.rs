use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default, Copy, Clone)]
struct POINT {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetCursorPos(lpPoint: *mut POINT) -> i32;
    fn GetForegroundWindow() -> isize;
    fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
    fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
    fn CloseHandle(hObject: isize) -> i32;
    fn QueryFullProcessImageNameW(
        hProcess: isize,
        dwFlags: u32,
        lpExeName: *mut u16,
        lpdwSize: *mut u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
fn is_roblox_studio_active() -> bool {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 {
            return false;
        }

        // 1. Check window title
        let mut title_buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 256);
        if len > 0 {
            let title = String::from_utf16_lossy(&title_buf[..len as usize]);
            if title.contains("Roblox Studio") {
                return true;
            }
        }

        // 2. Check process executable name
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != 0 {
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
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn is_roblox_studio_active() -> bool {
    false
}

/// Spawns a background thread that monitors cursor motion and brings ForgePilot to front
/// ONLY when a hard, intentional cursor wiggle occurs inside Roblox Studio.
pub fn start_wiggle_detector(app: AppHandle, enabled: Arc<AtomicBool>) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        let mut last_pt = POINT::default();
        unsafe {
            GetCursorPos(&mut last_pt);
        }

        let mut last_dir = 0; // -1 = left, 1 = right
        let mut reversals = 0;
        let mut last_reversal_time = Instant::now();
        let mut total_distance: i32 = 0;
        let mut cooldown = Instant::now();

        loop {
            std::thread::sleep(Duration::from_millis(16));

            if !enabled.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }

            let mut current_pt = POINT::default();
            if unsafe { GetCursorPos(&mut current_pt) } == 0 {
                continue;
            }

            let dx = current_pt.x - last_pt.x;
            let dy = current_pt.y - last_pt.y;
            let step_dist = ((dx * dx + dy * dy) as f64).sqrt() as i32;
            last_pt = current_pt;

            let now = Instant::now();

            // Reset streak if movement paused or took longer than 400ms between reversals
            if now.duration_since(last_reversal_time).as_millis() > 400 {
                reversals = 0;
                total_distance = 0;
            }

            // Direction must exceed 22 pixels displacement in one tick to be part of a "hard wiggle"
            let current_dir = if dx > 22 {
                1
            } else if dx < -22 {
                -1
            } else {
                0
            };

            if current_dir != 0 {
                total_distance += step_dist;
                if last_dir != 0 && current_dir != last_dir {
                    reversals += 1;
                    last_reversal_time = now;
                }
                last_dir = current_dir;
            }

            // TRIGGER CONDITION:
            // 1. At least 5 rapid directional reversals within 400ms
            // 2. Total accumulated travel distance > 320 pixels (ensures it's a vigorous, hard shake)
            // 3. Cooldown of 2.5s to prevent re-triggering
            // 4. Foreground window MUST be Roblox Studio
            if reversals >= 5 && total_distance > 320 && now.duration_since(cooldown).as_millis() > 2500 {
                if is_roblox_studio_active() {
                    cooldown = now;
                    reversals = 0;
                    total_distance = 0;

                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("studio-hard-wiggle", ());
                    }
                }
            }
        }
    });
}
