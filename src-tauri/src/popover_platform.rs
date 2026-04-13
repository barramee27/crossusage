//! Window placement for tray-style popovers on Windows / Linux.
//!
//! **Linux (AppIndicator):** tray icon events often never populate `tauri-plugin-positioner`'s
//! internal state before the user opens the menu, and the plugin **panics** with
//! `"Tray position not set"` for `TrayCenter`. We **do not** use `TrayCenter` on Linux.
//!
//! **Windows:** `TrayCenter` is used when tray geometry exists (left-click path), with fallback.
//!
//! Call [`move_main_near_tray`] only **after** [`WebviewWindow::show`](tauri::WebviewWindow::show)
//! so `current_monitor()` is usually available.

use tauri::{AppHandle, Manager};

#[cfg(target_os = "linux")]
use gtk::gdk::{self, prelude::*};
#[cfg(any(target_os = "linux", target_os = "windows"))]
use tauri::{PhysicalPosition, Runtime, WebviewWindow};

/// Move the main window using tray geometry from `on_tray_event`, constrained to the work area.
/// Must run **after** `show()`.
pub fn move_main_near_tray(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.current_monitor().ok().flatten().is_none() {
        log::debug!("popover: no current monitor; centering");
        let _ = window.center();
        return;
    }

    #[cfg(target_os = "linux")]
    {
        place_linux_pointer_popover(&window);
        return;
    }

    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_positioner::{Position, WindowExt};

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            window.move_window_constrained(Position::TrayCenter)
        }));

        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                log::debug!("popover: TrayCenter failed ({}), using monitor fallback", e);
                place_windows_monitor_fallback(&window);
            }
            Err(_) => {
                log::debug!("popover: TrayCenter unavailable; using monitor fallback");
                place_windows_monitor_fallback(&window);
            }
        }
    }
}

/// Linux AppIndicator does not reliably expose tray geometry, so anchor the popover near the
/// current pointer/menu position and clamp it to the monitor work area.
#[cfg(target_os = "linux")]
fn place_linux_pointer_popover<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(outer) = window.outer_size() else {
        let _ = window.center();
        return;
    };

    let Some(display) = gdk::Display::default() else {
        log::debug!("popover: no GDK display; centering");
        let _ = window.center();
        return;
    };

    let Some(pointer) = display.default_seat().and_then(|seat| seat.pointer()) else {
        log::debug!("popover: no pointer device; centering");
        let _ = window.center();
        return;
    };

    let (_, pointer_x, pointer_y) = pointer.position();
    let Some(monitor) = display.monitor_at_point(pointer_x, pointer_y) else {
        log::debug!("popover: no monitor at pointer; centering");
        let _ = window.center();
        return;
    };

    let workarea = monitor.workarea();
    let margin = 12i32;
    let width = outer.width as i32;
    let height = outer.height as i32;
    let min_x = workarea.x() + margin;
    let max_x = workarea.x() + workarea.width() - width - margin;
    let x = (pointer_x - (width / 2)).clamp(min_x, max_x.max(min_x));

    let workarea_mid_y = workarea.y() + (workarea.height() / 2);
    let prefer_top_anchor = pointer_y <= workarea_mid_y;
    let y = if prefer_top_anchor {
        workarea.y() + margin
    } else {
        workarea.y() + workarea.height() - height - margin
    };

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Windows fallback when tray geometry is unavailable: place near the top edge of the
/// current monitor so it still reads as a tray popover.
#[cfg(target_os = "windows")]
fn place_windows_monitor_fallback<R: Runtime>(window: &WebviewWindow<R>) {
    match (window.current_monitor(), window.outer_size()) {
        (Ok(Some(monitor)), Ok(outer)) => {
            let pos = monitor.position();
            let size = monitor.size();
            let margin = 12i32;
            let width = outer.width as i32;
            let x = pos.x + ((size.width as i32 - width) / 2);
            let y = pos.y + margin;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
        _ => {
            let _ = window.center();
        }
    }
}
