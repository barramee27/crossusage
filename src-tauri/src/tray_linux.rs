//! Linux AppIndicator does not deliver tray click events to Tauri. GTK/Wayland cannot reliably
//! distinguish primary vs secondary tray opens for our menu, so we do not intercept the menu.
//!
//! - **Primary click:** opens the GTK context menu (platform default).
//! - **Middle-click** (or shift+click on some hosts): `app_indicator_set_secondary_activate_target`
//!   runs the same action as **Show Stats**.

use gtk::glib::translate::ToGlibPtr;
use gtk::prelude::*;
use gtk_sys::GtkWidget;
use libappindicator::AppIndicator;
use libappindicator_sys as sys;
use std::cell::Cell;
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Wry;
use tauri::tray::TrayIcon;

const _: () =
    assert!(std::mem::size_of::<AppIndicator>() == std::mem::size_of::<*mut std::ffi::c_void>());

pub fn wire_tray_extras(tray: &TrayIcon<Wry>) -> tauri::Result<()> {
    tray.with_inner_tray_icon(move |inner| {
        let wrapper = unsafe { inner.app_indicator() };
        let c_ai: *mut sys::AppIndicator =
            unsafe { std::ptr::read(wrapper as *const *mut sys::AppIndicator) };
        if c_ai.is_null() {
            return;
        }

        let gtk_menu_ptr = unsafe { sys::app_indicator_get_menu(c_ai) };
        if gtk_menu_ptr.is_null() {
            return;
        }

        let menu: gtk::Menu = unsafe { gtk::glib::translate::from_glib_none(gtk_menu_ptr) };

        for w in menu.children() {
            let Some(mi) = w.downcast_ref::<gtk::MenuItem>() else {
                continue;
            };
            if !mi.is_sensitive() {
                continue;
            }
            let matches = mi
                .label()
                .as_ref()
                .is_some_and(|g| g.as_str() == "Show Stats");
            if !matches {
                continue;
            }

            let widget_ptr: *mut GtkWidget =
                ToGlibPtr::<*mut GtkWidget>::to_glib_none(mi.upcast_ref::<gtk::Widget>()).0;
            unsafe {
                sys::app_indicator_set_secondary_activate_target(c_ai, widget_ptr);
            }
            log::debug!("Linux tray: secondary activate → Show Stats");

            // AppIndicator often forces primary click to open the GTK menu and does not emit
            // tray click events to Tauri. Mirror popover UX by auto-running Show Stats when
            // the tray menu is shown. Set CROSSUSAGE_LINUX_TRAY_MENU=1 to disable this behavior.
            let auto_open_popup = std::env::var("CROSSUSAGE_LINUX_TRAY_MENU")
                .ok()
                .is_none_or(|value| value != "1");
            if auto_open_popup {
                let show_stats_item = mi.clone();
                let last_trigger_ms = Rc::new(Cell::new(0u128));
                let last_trigger_ms_ref = Rc::clone(&last_trigger_ms);
                menu.connect_show(move |shown_menu| {
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|duration| duration.as_millis())
                        .unwrap_or(0);
                    if now_ms.saturating_sub(last_trigger_ms_ref.get()) < 350 {
                        return;
                    }
                    last_trigger_ms_ref.set(now_ms);

                    let show_stats_item = show_stats_item.clone();
                    let shown_menu = shown_menu.clone();
                    gtk::glib::idle_add_local_once(move || {
                        show_stats_item.activate();
                        shown_menu.popdown();
                    });
                });
            }
            break;
        }
    })?;
    Ok(())
}
