use tauri::{AppHandle, Manager, Position, Size};

/// Show the panel (initializing if needed).
pub fn show_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Toggle panel visibility. If visible, hide it. If hidden, show it.
/// Used by global shortcut handler.
pub fn toggle_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            log::debug!("toggle_panel: hiding window");
            let _ = window.hide();
        } else {
            log::debug!("toggle_panel: showing window");
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn init(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app_handle.get_webview_window("main") {
        // On Windows, make the app a standard desktop window instead of a popup panel.
        // Same behavior as Linux: standard window, show on startup.
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);
        let _ = window.set_always_on_top(false);

        // Increase the default size a bit to fit more plugins comfortably
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 450.0,
            height: 750.0,
        }));
        let _ = window.center();

        // Show window on startup so it opens as a normal app when launched.
        // User can close (hide) to minimize to tray, then click tray icon to show again.
        let _ = window.show();
        let _ = window.set_focus();

        let handle = app_handle.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent actual closing of the window, just hide it
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
        });
    }

    Ok(())
}

pub fn position_panel_at_tray_icon(
    app_handle: &AppHandle,
    _icon_position: Position,
    _icon_size: Size,
) {
    // For Windows, same as Linux: center the window.
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.center();
    }
}
