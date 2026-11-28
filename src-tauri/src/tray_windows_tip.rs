use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};

use windows_sys::Win32::Foundation::{FALSE, HWND, LPARAM, LRESULT, TRUE, WPARAM};
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, NIF_TIP, NIM_MODIFY, NOTIFYICONDATAW, SetWindowSubclass, Shell_NotifyIconW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowThreadProcessId, RegisterWindowMessageW,
};
use windows_sys::core::w;

/// tray-icon 0.23 posts these after it has already called Shell_NotifyIconW.
const WM_USER_UPDATE_TRAYICON: u32 = 6004;
const WM_USER_SHOW_TRAYICON: u32 = 6005;
const WM_USER_UPDATE_TRAYTOOLTIP: u32 = 6007;
const SUBCLASS_ID: usize = 0x4355_5450;

struct TipState {
    uid: u32,
    taskbar_created: u32,
    last_tip: Mutex<String>,
}

/// Copy `tip` into a 128-unit shell buffer, always leaving a NUL in the last unit.
pub(crate) fn write_tray_tip(tip: &str, sz_tip: &mut [u16; 128]) {
    sz_tip.fill(0);
    let mut units: Vec<u16> = tip.encode_utf16().collect();
    if units.len() > 127 {
        units.truncate(127);
    }
    sz_tip[..units.len()].copy_from_slice(&units);
}

fn apply_wide_tip(hwnd: HWND, uid: u32, tip: &str) -> bool {
    unsafe {
        let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
        nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        nid.hWnd = hwnd;
        nid.uID = uid;
        nid.uFlags = NIF_TIP;
        write_tray_tip(tip, &mut nid.szTip);
        Shell_NotifyIconW(NIM_MODIFY, &mut nid) != 0
    }
}

struct Search {
    pid: u32,
    hwnd: HWND,
}

unsafe extern "system" fn enum_tray_window(hwnd: HWND, lparam: LPARAM) -> i32 {
    let search = unsafe { &mut *(lparam as *mut Search) };
    let mut class = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32) };
    if len <= 0 {
        return TRUE;
    }
    let name = String::from_utf16_lossy(&class[..len as usize]);
    if name != "tray_icon_app" {
        return TRUE;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == search.pid {
        search.hwnd = hwnd;
        return FALSE;
    }
    TRUE
}

fn find_tray_window() -> Option<HWND> {
    let mut search = Search {
        pid: unsafe { GetCurrentProcessId() },
        hwnd: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(enum_tray_window), &mut search as *mut Search as LPARAM);
    }
    if search.hwnd.is_null() {
        None
    } else {
        Some(search.hwnd)
    }
}

fn find_icon_id(hwnd: HWND) -> Option<u32> {
    for uid in 1..=16 {
        if apply_wide_tip(hwnd, uid, "CrossUsage") {
            return Some(uid);
        }
    }
    None
}

unsafe extern "system" fn on_tray_message(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    data: usize,
) -> LRESULT {
    let state = unsafe { &*(data as *const TipState) };
    let new_tip = if msg == WM_USER_UPDATE_TRAYTOOLTIP && wparam != 0 {
        unsafe { (*(wparam as *const Option<String>)).clone() }
    } else {
        None
    };
    let result = unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
    if let Some(text) = new_tip.as_ref() {
        *state.last_tip.lock().unwrap_or_else(|err| err.into_inner()) = text.clone();
    }
    let taskbar_restart = state.taskbar_created != 0 && msg == state.taskbar_created;
    let should_widen = new_tip.is_some()
        || msg == WM_USER_UPDATE_TRAYICON
        || msg == WM_USER_SHOW_TRAYICON
        || taskbar_restart;
    if should_widen {
        let text = state
            .last_tip
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clone();
        if !apply_wide_tip(hwnd, state.uid, &text) {
            static WARNED: AtomicBool = AtomicBool::new(false);
            if !WARNED.swap(true, Ordering::Relaxed) {
                log::warn!("failed to resend the wide tray tooltip");
            }
        }
    }
    result
}

/// Ask the shell to read 128 tip units. tray-icon's own calls leave cbSize at 0,
/// which keeps the legacy 64-unit tip. Version 4 is left alone so tray clicks stay valid.
pub fn install() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let Some(hwnd) = find_tray_window() else {
            log::warn!("tray window was not found; hover text stays at 64 characters");
            return;
        };
        let Some(uid) = find_icon_id(hwnd) else {
            log::warn!("tray icon id was not found; hover text stays at 64 characters");
            return;
        };
        let state = Box::leak(Box::new(TipState {
            uid,
            taskbar_created: unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) },
            last_tip: Mutex::new("CrossUsage".to_string()),
        }));
        let ok = unsafe {
            SetWindowSubclass(
                hwnd,
                Some(on_tray_message),
                SUBCLASS_ID,
                state as *const TipState as usize,
            )
        };
        if ok == 0 {
            log::warn!("tray tooltip subclass was not installed");
            return;
        }
        log::info!("tray tooltip uses the 128-character shell limit");
    });
}

#[cfg(test)]
mod tests {
    use super::write_tray_tip;

    #[test]
    fn short_tip_is_nul_terminated() {
        let mut tip = [1u16; 128];
        write_tray_tip("CrossUsage", &mut tip);
        let text: Vec<u16> = "CrossUsage".encode_utf16().collect();
        assert_eq!(&tip[..text.len()], &text[..]);
        assert_eq!(tip[text.len()], 0);
    }

    #[test]
    fn long_tip_keeps_127_units_and_a_nul() {
        let mut tip = [1u16; 128];
        write_tray_tip(&"A".repeat(200), &mut tip);
        assert!(tip[..127].iter().all(|unit| *unit == u16::from(b'A')));
        assert_eq!(tip[127], 0);
    }
}
