use tauri::{AppHandle, Manager};

use crate::popover_platform;

/// Show the panel anchored to the tray when geometry is known; otherwise centered.
pub fn show_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        // `tauri-plugin-positioner` needs a current monitor; that is only reliable after `show()`.
        let _ = window.show();
        popover_platform::move_main_near_tray(app_handle);
        let _ = window.set_focus();
    }
}

/// Toggle panel visibility (global shortcut).
pub fn toggle_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            log::debug!("toggle_panel: hiding window");
            let _ = window.hide();
        } else {
            log::debug!("toggle_panel: showing window");
            let _ = window.show();
            popover_platform::move_main_near_tray(app_handle);
            let _ = window.set_focus();
        }
    }
}

pub fn init(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_resizable(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 380.0,
            height: 700.0,
        }));

        let handle = app_handle.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
        });
    }

    Ok(())
}
