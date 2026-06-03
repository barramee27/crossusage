//! Window icon from bundled PNG (complements tauri.conf bundle icons).
use tauri::image::Image;
use tauri::{AppHandle, Manager};

const WINDOW_ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

pub fn set_main_window_icon(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(WINDOW_ICON_PNG)?;
    if let Some(window) = app.get_webview_window("main") {
        window.set_icon(icon)?;
    }
    Ok(())
}
