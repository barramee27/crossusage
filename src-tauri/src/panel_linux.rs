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
        // Set up event handler to hide window when it loses focus
        let handle = app_handle.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if !focused {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }
        });
        
        let _ = window.set_always_on_top(true);
        let _ = window.set_decorations(false);
    }

    Ok(())
}

pub fn position_panel_at_tray_icon(
    app_handle: &tauri::AppHandle,
    icon_position: Position,
    icon_size: Size,
) {
    let window = app_handle.get_webview_window("main").unwrap();

    let (icon_x, icon_y) = match &icon_position {
        Position::Physical(pos) => (pos.x as f64, pos.y as f64),
        Position::Logical(pos) => (pos.x, pos.y),
    };
    
    let (icon_w, icon_h) = match &icon_size {
        Size::Physical(s) => (s.width as f64, s.height as f64),
        Size::Logical(s) => (s.width, s.height),
    };

    let panel_width = match (window.outer_size(), window.scale_factor()) {
        (Ok(s), Ok(win_scale)) => s.width as f64 / win_scale,
        _ => {
            let conf: serde_json::Value =
                serde_json::from_str(include_str!("../tauri.conf.json"))
                    .expect("tauri.conf.json must be valid JSON");
            conf["app"]["windows"][0]["width"]
                .as_f64()
                .expect("width must be set in tauri.conf.json")
        }
    };

    let icon_center_x = icon_x + (icon_w / 2.0);
    let panel_x = icon_center_x - (panel_width / 2.0);
    // Position below the tray icon 
    let nudge_down: f64 = 6.0;
    let panel_y = icon_y + icon_h + nudge_down;

    let _ = window.set_position(tauri::LogicalPosition::new(panel_x, panel_y));
}