use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect};

const WINDOW_LABEL: &str = "trayhover";
const DEFAULT_WIDTH: f64 = 280.0;
const DEFAULT_HEIGHT: f64 = 160.0;
const ICON_POINTER_PAD: i32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayHoverItem {
    pub label: String,
    pub caption: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayHoverGroup {
    pub name: String,
    pub color: Option<String>,
    pub items: Vec<TrayHoverItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayHoverModel {
    pub dark: bool,
    pub glass: bool,
    pub groups: Vec<TrayHoverGroup>,
}

impl Default for TrayHoverModel {
    fn default() -> Self {
        Self {
            dark: false,
            glass: false,
            groups: Vec::new(),
        }
    }
}

struct HoverState {
    model: TrayHoverModel,
    width: f64,
    height: f64,
    anchor: Option<IconAnchor>,
    visible: bool,
    generation: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct IconAnchor {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

static HOVER: Mutex<HoverState> = Mutex::new(HoverState {
    model: TrayHoverModel {
        dark: false,
        glass: false,
        groups: Vec::new(),
    },
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    anchor: None,
    visible: false,
    generation: 0,
});

fn lock() -> std::sync::MutexGuard<'static, HoverState> {
    HOVER.lock().unwrap_or_else(|err| err.into_inner())
}

pub fn model() -> TrayHoverModel {
    lock().model.clone()
}

pub fn set_model(app: &AppHandle, model: TrayHoverModel) {
    lock().model = model.clone();
    let _ = app.emit_to(WINDOW_LABEL, "tray-hover-model", model);
}

pub fn set_size(app: &AppHandle, width: f64, height: f64) {
    if width < 1.0 || height < 1.0 {
        return;
    }
    let anchor = {
        let mut state = lock();
        state.width = width;
        state.height = height;
        if state.visible {
            state.anchor
        } else {
            None
        }
    };
    if let Some(anchor) = anchor {
        place(app, anchor);
    }
}

pub fn ensure_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == WINDOW_LABEL)
        .cloned()
    else {
        log::warn!("tray hover window config is missing");
        return Ok(());
    };
    tauri::WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

pub fn show_at(app: &AppHandle, rect: &Rect) {
    ensure_pointer_watch(app);
    let anchor = icon_anchor(rect);
    {
        let mut state = lock();
        if state.visible && state.anchor == Some(anchor) {
            return;
        }
        state.anchor = Some(anchor);
        state.generation = state.generation.wrapping_add(1);
        state.visible = true;
    }
    place(app, anchor);
}

pub fn hide(app: &AppHandle) {
    lock().visible = false;
    hide_window(app);
}

fn hide_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    // Shown with SetWindowPos, so tao still has VISIBLE unset and window.hide()
    // becomes a no-op. Hide the HWND directly, then sync tao.
    #[cfg(target_os = "windows")]
    if let Ok(handle) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        unsafe {
            ShowWindow(handle.0 as _, SW_HIDE);
        }
    }
    let _ = window.hide();
}

fn ensure_pointer_watch(app: &AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    if std::thread::Builder::new()
        .name("tray-hover-pointer".into())
        .spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(80));
                if !lock().visible {
                    continue;
                }
                let app_for_hide = app.clone();
                if app
                    .run_on_main_thread(move || dismiss_if_pointer_left(&app_for_hide))
                    .is_err()
                {
                    break;
                }
            }
        })
        .is_err()
    {
        STARTED.store(false, Ordering::SeqCst);
    }
}

fn dismiss_if_pointer_left(app: &AppHandle) {
    let (anchor, generation) = {
        let state = lock();
        if !state.visible {
            return;
        }
        (state.anchor, state.generation)
    };
    let Some(anchor) = anchor else {
        return;
    };
    if pointer_on_icon_now(anchor) {
        return;
    }
    {
        let state = lock();
        if state.generation != generation || !state.visible {
            return;
        }
    }
    if pointer_on_icon_now(anchor) {
        return;
    }
    {
        let mut state = lock();
        if state.generation != generation || !state.visible {
            return;
        }
        state.visible = false;
    }
    hide_window(app);
}

fn pointer_on_icon(x: i32, y: i32, anchor: IconAnchor) -> bool {
    let left = anchor.x.saturating_sub(ICON_POINTER_PAD);
    let top = anchor.y.saturating_sub(ICON_POINTER_PAD);
    let right = anchor
        .x
        .saturating_add(anchor.w)
        .saturating_add(ICON_POINTER_PAD);
    let bottom = anchor
        .y
        .saturating_add(anchor.h)
        .saturating_add(ICON_POINTER_PAD);
    x >= left && y >= top && x < right && y < bottom
}

#[cfg(target_os = "windows")]
fn pointer_on_icon_now(anchor: IconAnchor) -> bool {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return true;
    }
    pointer_on_icon(cursor.x, cursor.y, anchor)
}

#[cfg(not(target_os = "windows"))]
fn pointer_on_icon_now(anchor: IconAnchor) -> bool {
    let _ = anchor;
    true
}

fn icon_anchor(rect: &Rect) -> IconAnchor {
    let (x, y) = match rect.position {
        tauri::Position::Physical(position) => (position.x, position.y),
        tauri::Position::Logical(position) => (position.x.round() as i32, position.y.round() as i32),
    };
    let (w, h) = match rect.size {
        tauri::Size::Physical(size) => (size.width.max(1) as i32, size.height.max(1) as i32),
        tauri::Size::Logical(size) => (
            size.width.round().max(1.0) as i32,
            size.height.round().max(1.0) as i32,
        ),
    };
    IconAnchor { x, y, w, h }
}

fn place(app: &AppHandle, anchor: IconAnchor) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        log::warn!("tray hover window is not open");
        return;
    };
    let state = lock();
    let width = state.width;
    let height = state.height;
    drop(state);

    let monitors = app.available_monitors().unwrap_or_default();
    let center_x = anchor.x + anchor.w / 2;
    let center_y = anchor.y + anchor.h / 2;
    let monitor = monitors.iter().find(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        center_x >= origin.x
            && center_y >= origin.y
            && center_x < origin.x + size.width as i32
            && center_y < origin.y + size.height as i32
    });
    let Some(monitor) = monitor.or_else(|| monitors.first()) else {
        return;
    };
    let scale = monitor.scale_factor();
    let win_w = (width * scale).round().max(1.0) as i32;
    let win_h = (height * scale).round().max(1.0) as i32;
    let gap = (8.0 * scale).round().max(1.0) as i32;
    let work = monitor.work_area();
    let (x, y) = hover_origin(
        anchor.x,
        anchor.y,
        anchor.w,
        anchor.h,
        win_w,
        win_h,
        work.position.x,
        work.position.y,
        work.size.width as i32,
        work.size.height as i32,
        gap,
    );

    let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(
        win_w as u32,
        win_h as u32,
    )));
    let _ = window.set_position(tauri::Position::Physical(PhysicalPosition::new(x, y)));
    show_without_focus(&window);
}

#[cfg(target_os = "windows")]
fn show_without_focus(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };
    let Ok(handle) = window.hwnd() else {
        let _ = window.show();
        return;
    };
    unsafe {
        SetWindowPos(
            handle.0 as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_without_focus(window: &tauri::WebviewWindow) {
    let _ = window.show();
}

/// Place the card above the tray icon when it fits, otherwise below, then clamp to the work area.
pub(crate) fn hover_origin(
    icon_x: i32,
    icon_y: i32,
    icon_w: i32,
    icon_h: i32,
    win_w: i32,
    win_h: i32,
    work_x: i32,
    work_y: i32,
    work_w: i32,
    work_h: i32,
    gap: i32,
) -> (i32, i32) {
    let mut x = icon_x + icon_w / 2 - win_w / 2;
    let above = icon_y - gap - win_h;
    let below = icon_y + icon_h + gap;
    let y = if above >= work_y { above } else { below };
    let max_x = work_x + work_w - win_w;
    let max_y = work_y + work_h - win_h;
    if max_x >= work_x {
        x = x.clamp(work_x, max_x);
    }
    let y = if max_y >= work_y {
        y.clamp(work_y, max_y)
    } else {
        y
    };
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::hover_origin;

    #[test]
    fn places_the_card_above_a_bottom_taskbar_icon() {
        let (x, y) = hover_origin(1800, 1040, 24, 24, 280, 160, 0, 0, 1920, 1040, 8);
        assert_eq!(y, 1040 - 8 - 160);
        assert_eq!(x, 1920 - 280);
    }

    #[test]
    fn places_the_card_below_when_the_top_edge_has_no_room() {
        let (x, y) = hover_origin(10, 0, 24, 40, 280, 160, 0, 0, 1920, 1080, 8);
        assert_eq!(y, 48);
        assert_eq!(x, 0);
    }

    #[test]
    fn pointer_on_the_icon_includes_a_small_edge_pad() {
        let anchor = super::IconAnchor {
            x: 100,
            y: 200,
            w: 24,
            h: 24,
        };
        assert!(super::pointer_on_icon(100, 200, anchor));
        assert!(super::pointer_on_icon(96, 200, anchor));
        assert!(!super::pointer_on_icon(95, 200, anchor));
        assert!(!super::pointer_on_icon(128, 200, anchor));
    }
}
