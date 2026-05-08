use std::sync::{Mutex, OnceLock};

use tauri::Wry;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::path::BaseDirectory;
use tauri::tray::TrayIconBuilder;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

#[cfg(target_os = "linux")]
static TRAY_USAGE_SUMMARY_ITEM: OnceLock<Mutex<MenuItem<Wry>>> = OnceLock::new();

static TRAY_RESTART_ITEM: OnceLock<Mutex<MenuItem<Wry>>> = OnceLock::new();

fn store_tray_restart_handle(item: MenuItem<Wry>) {
    let _ = TRAY_RESTART_ITEM.set(Mutex::new(item));
}

/// Tray "Restart" / "Restart to update" label (set from the webview when an updater bundle is ready).
pub fn set_tray_restart_menu_text(text: &str) {
    let Some(lock) = TRAY_RESTART_ITEM.get() else {
        return;
    };
    let Ok(guard) = lock.lock() else {
        return;
    };
    let _ = guard.set_text(text);
}

/// Cap lines so the tray menu stays readable; mirrors native tooltip truncation intent.
#[cfg(target_os = "linux")]
const TRAY_USAGE_SUMMARY_MAX_LINES: usize = 12;

/// Linux AppIndicator: native tray tooltips are unreliable. We mirror the same text in one
/// disabled menu row using embedded newlines (GTK allocates one item, not N blank rows).
#[cfg(target_os = "linux")]
fn store_tray_usage_summary_handle(item: MenuItem<Wry>) {
    let _ = TRAY_USAGE_SUMMARY_ITEM.set(Mutex::new(item));
}

/// Update the disabled “usage summary” item on Linux. No-op on other platforms.
pub fn update_tray_usage_summary(summary: &str) {
    #[cfg(not(target_os = "linux"))]
    let _ = summary;

    #[cfg(target_os = "linux")]
    {
        let Some(lock) = TRAY_USAGE_SUMMARY_ITEM.get() else {
            return;
        };
        let Ok(item) = lock.lock() else {
            return;
        };

        let mut lines: Vec<String> = summary
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| {
                if s.chars().count() > 120 {
                    format!("{}…", s.chars().take(120).collect::<String>())
                } else {
                    s.to_string()
                }
            })
            .collect();

        if lines.is_empty() {
            lines.push("CrossUsage".to_string());
        }
        if lines.len() > TRAY_USAGE_SUMMARY_MAX_LINES {
            lines.truncate(TRAY_USAGE_SUMMARY_MAX_LINES);
        }

        let joined = lines.join("\n");
        let _ = item.set_text(&joined);
    }
}

#[cfg(target_os = "macos")]
use crate::panel::position_panel_at_tray_icon;
use crate::panel::show_panel;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use crate::panel::toggle_panel;

#[cfg(target_os = "macos")]
use crate::panel::get_or_init_panel;

const LOG_LEVEL_STORE_KEY: &str = "logLevel";

fn get_stored_log_level(app_handle: &AppHandle) -> log::LevelFilter {
    let store = match app_handle.store("settings.json") {
        Ok(s) => s,
        Err(_) => return log::LevelFilter::Error,
    };
    let value = store.get(LOG_LEVEL_STORE_KEY);
    let level_str = value.and_then(|v| v.as_str().map(|s| s.to_string()));
    match level_str.as_deref() {
        Some("error") => log::LevelFilter::Error,
        Some("warn") => log::LevelFilter::Warn,
        Some("info") => log::LevelFilter::Info,
        Some("debug") => log::LevelFilter::Debug,
        Some("trace") => log::LevelFilter::Trace,
        _ => log::LevelFilter::Error, // Default: least verbose
    }
}

fn set_stored_log_level(app_handle: &AppHandle, level: log::LevelFilter) {
    let level_str = match level {
        log::LevelFilter::Error => "error",
        log::LevelFilter::Warn => "warn",
        log::LevelFilter::Info => "info",
        log::LevelFilter::Debug => "debug",
        log::LevelFilter::Trace => "trace",
        log::LevelFilter::Off => "off",
    };
    log::info!("Log level changing to {:?}", level);
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(LOG_LEVEL_STORE_KEY, serde_json::json!(level_str));
        let _ = store.save();
    }
    log::set_max_level(level);
}

pub fn create(app_handle: &AppHandle) -> tauri::Result<()> {
    let icon = match app_handle
        .path()
        .resolve("icons/tray-icon.png", BaseDirectory::Resource)
        .ok()
        .and_then(|path| Image::from_path(path).ok())
    {
        Some(icon) => icon,
        None => Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?,
    };

    // Load persisted log level
    let current_level = get_stored_log_level(app_handle);
    log::set_max_level(current_level);

    let show_stats = MenuItem::with_id(app_handle, "show_stats", "Show Stats", true, None::<&str>)?;
    let go_to_settings = MenuItem::with_id(
        app_handle,
        "go_to_settings",
        "Go to Settings",
        true,
        None::<&str>,
    )?;

    // Log level submenu - clone items for use in event handler
    let log_error = CheckMenuItem::with_id(
        app_handle,
        "log_error",
        "Error",
        true,
        current_level == log::LevelFilter::Error,
        None::<&str>,
    )?;
    let log_warn = CheckMenuItem::with_id(
        app_handle,
        "log_warn",
        "Warn",
        true,
        current_level == log::LevelFilter::Warn,
        None::<&str>,
    )?;
    let log_info = CheckMenuItem::with_id(
        app_handle,
        "log_info",
        "Info",
        true,
        current_level == log::LevelFilter::Info,
        None::<&str>,
    )?;
    let log_debug = CheckMenuItem::with_id(
        app_handle,
        "log_debug",
        "Debug",
        true,
        current_level == log::LevelFilter::Debug,
        None::<&str>,
    )?;
    let log_trace = CheckMenuItem::with_id(
        app_handle,
        "log_trace",
        "Trace",
        true,
        current_level == log::LevelFilter::Trace,
        None::<&str>,
    )?;
    let log_level_submenu = Submenu::with_items(
        app_handle,
        "Debug Level",
        true,
        &[&log_error, &log_warn, &log_info, &log_debug, &log_trace],
    )?;

    // Clone for capture in event handler
    let log_items = [
        (log_error.clone(), log::LevelFilter::Error),
        (log_warn.clone(), log::LevelFilter::Warn),
        (log_info.clone(), log::LevelFilter::Info),
        (log_debug.clone(), log::LevelFilter::Debug),
        (log_trace.clone(), log::LevelFilter::Trace),
    ];

    let separator = PredefinedMenuItem::separator(app_handle)?;
    let restart = MenuItem::with_id(app_handle, "restart", "Restart", true, None::<&str>)?;
    store_tray_restart_handle(restart.clone());
    let about = MenuItem::with_id(app_handle, "about", "About CrossUsage", true, None::<&str>)?;
    let quit = MenuItem::with_id(app_handle, "quit", "Quit", true, None::<&str>)?;

    #[cfg(target_os = "linux")]
    let menu = {
        let usage_summary = MenuItem::with_id(
            app_handle,
            "tray_usage_summary",
            "CrossUsage",
            false,
            None::<&str>,
        )?;
        store_tray_usage_summary_handle(usage_summary.clone());
        let sep_usage = PredefinedMenuItem::separator(app_handle)?;
        Menu::with_items(
            app_handle,
            &[
                &usage_summary,
                &sep_usage,
                &show_stats,
                &go_to_settings,
                &log_level_submenu,
                &separator,
                &restart,
                &about,
                &quit,
            ],
        )?
    };

    #[cfg(not(target_os = "linux"))]
    let menu = Menu::with_items(
        app_handle,
        &[
            &show_stats,
            &go_to_settings,
            &log_level_submenu,
            &separator,
            &restart,
            &about,
            &quit,
        ],
    )?;

    // Template images are a macOS menu-bar convention (alpha mask + system tint).
    // On Windows/Linux use the PNG as a normal color icon so the tray looks correct.
    let mut builder = TrayIconBuilder::with_id("tray")
        .icon(icon)
        .tooltip("CrossUsage");
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder.menu(&menu).show_menu_on_left_click(false);
    }
    #[cfg(target_os = "linux")]
    {
        // Linux (AppIndicator): tray click events are not delivered; the GTK menu is the main
        // interaction. Use "Show Stats" for the stats window. show_menu_on_left_click is a no-op.
        builder = builder.menu(&menu).show_menu_on_left_click(true);
    }
    #[cfg(target_os = "windows")]
    {
        // Left click: stats window via on_tray_icon_event. Right click: native context menu.
        builder = builder.menu(&menu).show_menu_on_left_click(false);
    }

    // Linux reads the indicator after build for secondary-activate wiring; other OSes only need the icon to stay alive.
    #[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
    let tray_icon = builder
        .on_menu_event(move |app_handle, event| {
            log::debug!("tray menu: {}", event.id.as_ref());
            match event.id.as_ref() {
                "show_stats" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:navigate", "home");
                }
                "go_to_settings" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:navigate", "settings");
                }
                "about" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:show-about", ());
                }
                "restart" => {
                    log::info!("restart or apply-update requested via tray");
                    let _ = app_handle.emit("tray:restart-or-update", ());
                }
                "quit" => {
                    log::info!("quit requested via tray");
                    app_handle.exit(0);
                }
                "log_error" | "log_warn" | "log_info" | "log_debug" | "log_trace" => {
                    let selected_level = match event.id.as_ref() {
                        "log_error" => log::LevelFilter::Error,
                        "log_warn" => log::LevelFilter::Warn,
                        "log_info" => log::LevelFilter::Info,
                        "log_debug" => log::LevelFilter::Debug,
                        "log_trace" => log::LevelFilter::Trace,
                        _ => unreachable!(),
                    };
                    set_stored_log_level(app_handle, selected_level);
                    // Update all checkmarks - only the selected level should be checked
                    for (item, level) in &log_items {
                        let _ = item.set_checked(*level == selected_level);
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Record tray icon bounds for `tauri-plugin-positioner` (TrayCenter, etc.).
            #[cfg(desktop)]
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let app_handle = tray.app_handle();

                if let TrayIconEvent::Click {
                    button,
                    button_state,
                    rect,
                    ..
                } = event
                {
                    #[cfg(not(target_os = "macos"))]
                    let _ = rect;

                    // Secondary click opens the tray menu. Primary press toggles the stats UI
                    // (Down is more reliable than Up on some Windows shells).
                    if button != MouseButton::Left || button_state != MouseButtonState::Down {
                        return;
                    }

                    #[cfg(target_os = "macos")]
                    {
                        let Some(panel) = get_or_init_panel!(app_handle) else {
                            return;
                        };

                        if panel.is_visible() {
                            log::debug!("tray click: hiding panel");
                            panel.hide();
                            return;
                        }
                        log::debug!("tray click: showing panel");

                        // macOS quirk: must show window before positioning to another monitor
                        panel.show_and_make_key();
                        position_panel_at_tray_icon(app_handle, rect.position, rect.size);
                    }

                    #[cfg(target_os = "windows")]
                    {
                        log::debug!("tray click: toggle popover");
                        toggle_panel(app_handle);
                    }

                    #[cfg(target_os = "linux")]
                    {
                        // AppIndicator click events are DE-dependent. When delivered, treat primary
                        // click as a direct popover toggle just like other platforms.
                        log::debug!("tray click: toggle popover (linux)");
                        toggle_panel(app_handle);
                    }
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                let _ = (tray, event);
            }
        })
        .build(app_handle)?;

    #[cfg(target_os = "linux")]
    if let Err(e) = crate::tray_linux::wire_tray_extras(&tray_icon) {
        log::warn!("Linux tray secondary-activate wiring failed: {}", e);
    }

    Ok(())
}
