#[cfg(target_os = "macos")]
mod app_nap;
#[cfg(target_os = "macos")]
mod panel;
#[cfg(target_os = "linux")]
mod panel_linux;
#[cfg(target_os = "linux")]
use panel_linux as panel;
#[cfg(target_os = "windows")]
mod panel_windows;
use crossusage_core::{plugin_engine, provider_accounts};
#[cfg(target_os = "windows")]
use panel_windows as panel;
mod local_http_api;
mod log_path;
mod os_diagnostics;
mod support_bundle;
mod usage_alert_sound;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod popover_platform;
mod tray;
#[cfg(target_os = "linux")]
mod tray_linux;
#[cfg(target_os = "macos")]
mod webkit_config;

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_aptabase::EventTracker;

/// Aptabase app key (dashboard: https://aptabase.com) — CrossUsage fork analytics.
const APTABASE_APP_KEY: &str = "A-US-2161452114";
#[cfg(target_os = "macos")]
use tauri_plugin_liquid_glass::{GlassMaterialVariant, LiquidGlassConfig, LiquidGlassExt};
use tauri_plugin_log::{Target, TargetKind};
use uuid::Uuid;

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const GLOBAL_SHORTCUT_STORE_KEY: &str = "globalShortcut";
const DAILY_ACTIVE_TRACKED_DAY_KEY: &str = "analytics.daily_active_day";
const DAILY_ACTIVE_EVENT_NAME: &str = "app_started";
const MAX_CONCURRENT_PROBES: usize = 4;

fn probe_worker_count(plugin_count: usize) -> usize {
    plugin_count.min(MAX_CONCURRENT_PROBES)
}

/// Coalesces overlapping probe requests so an enablement wake mid-batch is not
/// dropped (#856). If `instance_id` is already probing, the latest request is
/// kept in `pending` and runs after the in-flight probe finishes.
struct PendingProbe {
    batch_id: String,
    plugin: plugin_engine::manifest::LoadedPlugin,
    account: provider_accounts::ProviderAccountContext,
}

struct ProbeCoord {
    in_flight: HashSet<String>,
    pending: HashMap<String, PendingProbe>,
    batch_remaining: HashMap<String, usize>,
    active_workers: usize,
}

fn probe_coord() -> &'static Mutex<ProbeCoord> {
    static COORD: OnceLock<Mutex<ProbeCoord>> = OnceLock::new();
    COORD.get_or_init(|| {
        Mutex::new(ProbeCoord {
            in_flight: HashSet::new(),
            pending: HashMap::new(),
            batch_remaining: HashMap::new(),
            active_workers: 0,
        })
    })
}

fn note_probe_finished(app_handle: &tauri::AppHandle, batch_id: &str) {
    let complete = {
        let mut coord = probe_coord()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let remaining = coord.batch_remaining.entry(batch_id.to_string()).or_insert(0);
        if *remaining > 0 {
            *remaining -= 1;
        }
        if *remaining == 0 {
            coord.batch_remaining.remove(batch_id);
            true
        } else {
            false
        }
    };
    if complete {
        log::info!("[refresh] batch {} complete", batch_id);
        let _ = app_handle.emit(
            "probe:batch-complete",
            ProbeBatchComplete {
                batch_id: batch_id.to_string(),
            },
        );
    }
}

fn take_follow_up(finished_id: Option<&str>) -> Option<PendingProbe> {
    let mut coord = probe_coord()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(id) = finished_id {
        coord.in_flight.remove(id);
        if let Some(entry) = coord.pending.remove(id) {
            coord.in_flight.insert(id.to_string());
            return Some(entry);
        }
    }
    let free_id = coord
        .pending
        .keys()
        .find(|id| !coord.in_flight.contains(*id))
        .cloned();
    free_id.and_then(|id| {
        coord.in_flight.insert(id.clone());
        coord.pending.remove(&id)
    })
}

/// Create `~/.crossusage/config.json` on first launch if missing (proxy + optional Synthetic key).
fn ensure_crossusage_user_config_file() {
    let Some(home) = dirs::home_dir() else {
        log::debug!("Skipping default user config: no home directory");
        return;
    };
    let dir = home.join(".crossusage");
    let path = dir.join("config.json");
    if path.exists() {
        return;
    }
    if let Err(e) = fs::create_dir_all(&dir) {
        log::warn!("Cannot create {}: {}", dir.display(), e);
        return;
    }
    const TEMPLATE: &str = r#"{
  "proxy": {
    "enabled": false,
    "url": ""
  },
  "synthetic": {
    "apiKey": ""
  }
}
"#;
    match fs::write(&path, TEMPLATE) {
        Ok(()) => log::info!("Created default user config at {}", path.display()),
        Err(e) => log::warn!("Cannot write {}: {}", path.display(), e),
    }
}

fn today_utc_ymd() -> String {
    let date = time::OffsetDateTime::now_utc().date();
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        date.month() as u8,
        date.day()
    )
}

fn should_track_daily_active(last_tracked_day: Option<&str>, today: &str) -> bool {
    match last_tracked_day {
        Some(day) => day != today,
        None => true,
    }
}

#[cfg(desktop)]
fn track_daily_active_if_needed(app_handle: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;

    let today = today_utc_ymd();

    let store = match app_handle.store("settings.json") {
        Ok(store) => store,
        Err(error) => {
            log::warn!(
                "Failed to access settings store for daily analytics gate: {}",
                error
            );
            return;
        }
    };

    let last_tracked_day = store
        .get(DAILY_ACTIVE_TRACKED_DAY_KEY)
        .and_then(|value| value.as_str().map(|value| value.to_string()));

    if !should_track_daily_active(last_tracked_day.as_deref(), &today) {
        return;
    }

    if let Err(error) = app_handle.track_event(DAILY_ACTIVE_EVENT_NAME, None) {
        log::warn!("Failed to track daily analytics event: {}", error);
        return;
    }

    store.set(
        DAILY_ACTIVE_TRACKED_DAY_KEY,
        serde_json::Value::String(today),
    );
    if let Err(error) = store.save() {
        log::warn!("Failed to save daily analytics tracked day: {}", error);
    }
}

#[cfg(not(desktop))]
fn track_daily_active_if_needed(app_handle: &tauri::AppHandle) {
    let _ = app_handle.track_event(DAILY_ACTIVE_EVENT_NAME, None);
}

#[cfg(desktop)]
fn seconds_until_next_utc_day(now: time::OffsetDateTime) -> u64 {
    let now_time = now.time();
    let seconds_since_midnight = u64::from(now_time.hour()) * 60 * 60
        + u64::from(now_time.minute()) * 60
        + u64::from(now_time.second());
    let seconds_until_next_day = 86_400_u64.saturating_sub(seconds_since_midnight);
    if seconds_until_next_day == 0 {
        86_400
    } else {
        seconds_until_next_day
    }
}

#[cfg(desktop)]
fn spawn_daily_active_rollover_tracker(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            let sleep_for = std::time::Duration::from_secs(seconds_until_next_utc_day(
                time::OffsetDateTime::now_utc(),
            ));
            std::thread::sleep(sleep_for);
            track_daily_active_if_needed(&app_handle);
        }
    });
}

#[cfg(desktop)]
fn managed_shortcut_slot() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Shared shortcut handler that toggles the panel when the shortcut is pressed.
#[cfg(desktop)]
fn handle_global_shortcut(
    app: &tauri::AppHandle,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state == ShortcutState::Pressed {
        log::debug!("Global shortcut triggered");
        panel::toggle_panel(app);
    }
}

pub struct AppState {
    pub plugins: Vec<plugin_engine::manifest::LoadedPlugin>,
    pub app_data_dir: PathBuf,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMeta {
    pub id: String,
    pub name: String,
    pub icon_url: String,
    pub icon_file_path: String,
    pub brand_color: Option<String>,
    pub lines: Vec<ManifestLineDto>,
    pub links: Vec<PluginLinkDto>,
    /// Ordered list of primary metric candidates (sorted by primaryOrder).
    /// Frontend picks the first one that exists in runtime data.
    pub primary_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestLineDto {
    #[serde(rename = "type")]
    pub line_type: String,
    pub label: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLinkDto {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeBatchStarted {
    pub batch_id: String,
    pub plugin_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeTarget {
    pub instance_id: String,
    pub base_provider_id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountInfo {
    pub instance_id: String,
    pub base_provider_id: String,
    pub label: String,
    pub has_access_token: bool,
    pub has_refresh_token: bool,
    pub has_session_key: bool,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderAccountRequest {
    pub instance_id: String,
    pub base_provider_id: String,
    pub label: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub session_key: Option<String>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub batch_id: String,
    pub output: plugin_engine::runtime::PluginOutput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeBatchComplete {
    pub batch_id: String,
}

#[tauri::command]
fn init_panel(app_handle: tauri::AppHandle) {
    panel::init(&app_handle).expect("Failed to initialize panel");
}

#[tauri::command]
fn hide_panel(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app_handle.get_webview_panel("main") {
            panel.hide();
        }
    }
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            window
                .hide()
                .unwrap_or_else(|e| log::warn!("Failed to hide window: {}", e));
        }
    }
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            window
                .hide()
                .unwrap_or_else(|e| log::warn!("Failed to hide window: {}", e));
        }
    }
}

#[tauri::command]
#[allow(unused_variables)] // `enabled` / `window` only used on macOS and Windows
fn set_liquid_glass_enabled(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri::Manager;

    let Some(window) = app_handle.get_webview_window("main") else {
        return Ok(());
    };

    // macOS: native Liquid Glass material via tauri-plugin-liquid-glass
    #[cfg(target_os = "macos")]
    {
        let config = if enabled {
            LiquidGlassConfig {
                corner_radius: 22.0,
                variant: GlassMaterialVariant::Sidebar,
                ..Default::default()
            }
        } else {
            LiquidGlassConfig {
                enabled: false,
                ..Default::default()
            }
        };
        app_handle
            .liquid_glass()
            .set_effect(&window, config)
            .map_err(|error| error.to_string())?;
    }

    // Windows: Acrylic blur (Windows 10/11) with a subtle dark tint, falling back
    // gracefully on older builds where the compositor doesn't support it.
    #[cfg(target_os = "windows")]
    {
        if enabled {
            if let Err(e) = window_vibrancy::apply_acrylic(&window, Some((18, 18, 20, 160))) {
                log::warn!("Acrylic not supported on this Windows build: {}", e);
                // Fall back to Mica (Windows 11 only) if Acrylic fails
                if let Err(e2) = window_vibrancy::apply_mica(&window, Some(true)) {
                    log::warn!("Mica also unavailable: {}", e2);
                }
            }
        } else {
            // clear_acrylic returns error if acrylic wasn't applied; ignore it
            let _ = window_vibrancy::clear_acrylic(&window);
            let _ = window_vibrancy::clear_mica(&window);
        }
    }

    // Linux: transparency is compositor-dependent (KWin/Mutter compositing must be
    // active). No native API needed – the transparent Tauri window + CSS
    // backdrop-filter handles it when a compositor is running.

    Ok(())
}

#[tauri::command]
fn open_devtools(#[allow(unused)] app_handle: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            window.open_devtools();
        }
    }
}

#[tauri::command]
fn list_provider_accounts(
    state: tauri::State<'_, Mutex<AppState>>,
    base_provider_id: Option<String>,
) -> Result<Vec<ProviderAccountInfo>, String> {
    let app_data_dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    let store = provider_accounts::load_store(&app_data_dir).map_err(|e| e.to_string())?;
    let base_filter = base_provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut accounts: Vec<ProviderAccountInfo> = store
        .accounts
        .into_values()
        .filter(|account| {
            base_filter
                .as_ref()
                .map(|base| account.base_provider_id == *base)
                .unwrap_or(true)
        })
        .map(|account| ProviderAccountInfo {
            instance_id: account.instance_id,
            base_provider_id: account.base_provider_id,
            label: account.label,
            has_access_token: account
                .credential
                .access_token
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
            has_refresh_token: account
                .credential
                .refresh_token
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
            has_session_key: account
                .credential
                .session_key
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
            expires_at: account.credential.expires_at,
        })
        .collect();
    accounts.sort_by(|a, b| a.instance_id.cmp(&b.instance_id));
    Ok(accounts)
}

#[tauri::command]
fn save_provider_account(
    state: tauri::State<'_, Mutex<AppState>>,
    account: SaveProviderAccountRequest,
) -> Result<ProviderAccountInfo, String> {
    let app_data_dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    let mut credential = provider_accounts::ProviderCredential {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        session_key: account.session_key,
        expires_at: account.expires_at,
    };
    if credential.is_empty() {
        if let Ok(Some(existing)) =
            provider_accounts::get_account(&app_data_dir, account.instance_id.trim())
        {
            credential = existing.credential;
        }
    }
    let provider_account = provider_accounts::ProviderAccount {
        instance_id: account.instance_id.trim().to_string(),
        base_provider_id: account.base_provider_id.trim().to_string(),
        label: account.label.trim().to_string(),
        credential,
    };
    if provider_account.instance_id.is_empty()
        || provider_account.base_provider_id.is_empty()
        || provider_account.label.is_empty()
    {
        return Err("provider account requires instanceId, baseProviderId, and label".into());
    }
    provider_accounts::upsert_account(&app_data_dir, provider_account.clone())
        .map_err(|e| e.to_string())?;
    Ok(ProviderAccountInfo {
        instance_id: provider_account.instance_id,
        base_provider_id: provider_account.base_provider_id,
        label: provider_account.label,
        has_access_token: provider_account
            .credential
            .access_token
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        has_refresh_token: provider_account
            .credential
            .refresh_token
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        has_session_key: provider_account
            .credential
            .session_key
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        expires_at: provider_account.credential.expires_at,
    })
}

#[tauri::command]
fn delete_provider_account(
    state: tauri::State<'_, Mutex<AppState>>,
    instance_id: String,
) -> Result<(), String> {
    let app_data_dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    provider_accounts::delete_account(&app_data_dir, instance_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_probe_batch(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    batch_id: Option<String>,
    plugin_ids: Option<Vec<String>>,
    probe_targets: Option<Vec<ProbeTarget>>,
) -> Result<ProbeBatchStarted, String> {
    let batch_id = batch_id
        .and_then(|id| {
            let trimmed = id.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let (plugins, app_data_dir, app_version) = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        (
            locked.plugins.clone(),
            locked.app_data_dir.clone(),
            locked.app_version.clone(),
        )
    };

    let selected_targets: Vec<ProbeTarget> = match probe_targets {
        Some(targets) => {
            let mut seen = HashSet::new();
            targets
                .into_iter()
                .filter_map(|target| {
                    let instance_id = target.instance_id.trim().to_string();
                    let base_provider_id = target.base_provider_id.trim().to_string();
                    if instance_id.is_empty()
                        || base_provider_id.is_empty()
                        || !seen.insert(instance_id.clone())
                    {
                        return None;
                    }
                    Some(ProbeTarget {
                        instance_id,
                        base_provider_id,
                        label: target.label.map(|label| label.trim().to_string()),
                    })
                })
                .collect()
        }
        None => match plugin_ids {
            Some(ids) => ids
                .into_iter()
                .map(|id| {
                    let instance_id = id.trim().to_string();
                    let account = provider_accounts::get_account(&app_data_dir, &instance_id)
                        .ok()
                        .flatten();
                    let base_provider_id = account
                        .as_ref()
                        .map(|entry| entry.base_provider_id.clone())
                        .filter(|base| !base.is_empty())
                        .unwrap_or_else(|| {
                            instance_id
                                .split_once(':')
                                .map(|(base, _)| base.to_string())
                                .unwrap_or_else(|| instance_id.clone())
                        });
                    let label = account
                        .map(|entry| entry.label)
                        .filter(|value| !value.trim().is_empty());
                    ProbeTarget {
                        instance_id,
                        base_provider_id,
                        label,
                    }
                })
                .collect(),
            None => plugins
                .iter()
                .map(|plugin| ProbeTarget {
                    instance_id: plugin.manifest.id.clone(),
                    base_provider_id: plugin.manifest.id.clone(),
                    label: None,
                })
                .collect(),
        },
    };

    let selected_plugins = {
        let by_id: HashMap<String, plugin_engine::manifest::LoadedPlugin> = plugins
                .into_iter()
                .map(|plugin| (plugin.manifest.id.clone(), plugin))
                .collect();
        selected_targets
            .into_iter()
            .filter_map(|target| {
                by_id.get(&target.base_provider_id).cloned().map(|plugin| {
                    let credential = provider_accounts::get_account(&app_data_dir, &target.instance_id)
                        .ok()
                        .flatten()
                        .map(|account| account.credential)
                        .filter(|credential| !credential.is_empty());
                    let label = target
                        .label
                        .filter(|label| !label.trim().is_empty())
                        .unwrap_or_else(|| target.instance_id.clone());
                    let account_context = provider_accounts::ProviderAccountContext {
                        instance_id: target.instance_id,
                        base_provider_id: target.base_provider_id,
                        label,
                        credential,
                        store_path: Some(provider_accounts::store_path(&app_data_dir)),
                    };
                    (plugin, account_context)
                })
            })
            .collect::<Vec<_>>()
    };

    let response_plugin_ids: Vec<String> = selected_plugins
        .iter()
        .map(|(_, account)| account.instance_id.clone())
        .collect();

    log::info!(
        "[refresh] batch {} starting: {:?}",
        batch_id,
        response_plugin_ids
    );

    if selected_plugins.is_empty() {
        let _ = app_handle.emit(
            "probe:batch-complete",
            ProbeBatchComplete {
                batch_id: batch_id.clone(),
            },
        );
        return Ok(ProbeBatchStarted {
            batch_id,
            plugin_ids: response_plugin_ids,
        });
    }

    // Partition: run now vs coalesce into pending follow-up (#856).
    let (to_run, need_drain_worker) = {
        let mut coord = probe_coord()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        coord
            .batch_remaining
            .insert(batch_id.clone(), selected_plugins.len());
        let mut to_run = Vec::new();
        let mut deferred = Vec::new();
        for (plugin, account) in selected_plugins {
            let id = account.instance_id.clone();
            if coord.in_flight.contains(&id) {
                coord.pending.insert(
                    id.clone(),
                    PendingProbe {
                        batch_id: batch_id.clone(),
                        plugin,
                        account,
                    },
                );
                deferred.push(id);
            } else {
                coord.in_flight.insert(id);
                to_run.push((plugin, account));
            }
        }
        if !deferred.is_empty() {
            log::info!(
                "[refresh] batch {} deferred (already in-flight): {:?}",
                batch_id,
                deferred
            );
        }
        let need_drain = to_run.is_empty() && !deferred.is_empty() && coord.active_workers == 0;
        if need_drain {
            // Stale in_flight with no workers — free deferred ids so the drain worker can run them.
            for id in &deferred {
                coord.in_flight.remove(id);
            }
        }
        (to_run, need_drain)
    };

    let history_dir = app_data_dir.clone();
    let spawn_count = if to_run.is_empty() {
        if need_drain_worker {
            1
        } else {
            0
        }
    } else {
        probe_worker_count(to_run.len())
    };

    if spawn_count > 0 && !to_run.is_empty() && spawn_count < to_run.len() {
        log::info!(
            "[refresh] batch {} using {} workers for {} plugins",
            batch_id,
            spawn_count,
            to_run.len()
        );
    }

    let probe_queue = Arc::new(Mutex::new(to_run.into_iter().collect::<VecDeque<_>>()));

    {
        let mut coord = probe_coord()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        coord.active_workers += spawn_count;
    }

    for _ in 0..spawn_count {
        let handle = app_handle.clone();
        let data_dir = app_data_dir.clone();
        let history_dir_spawn = history_dir.clone();
        let version = app_version.clone();
        let queue = Arc::clone(&probe_queue);
        let queue_batch_id = batch_id.clone();

        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let item = {
                    let mut queue = queue
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    queue.pop_front()
                };

                let (plugin, account_context, bid) = match item {
                    Some((plugin, account_context)) => {
                        (plugin, account_context, queue_batch_id.clone())
                    }
                    None => match take_follow_up(None) {
                        Some(pending) => (pending.plugin, pending.account, pending.batch_id),
                        None => break,
                    },
                };

                run_and_emit_probe(
                    &handle,
                    &data_dir,
                    &history_dir_spawn,
                    &version,
                    &bid,
                    plugin,
                    account_context,
                );
            }

            {
                let mut coord = probe_coord()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                coord.active_workers = coord.active_workers.saturating_sub(1);
            }
        });
    }

    Ok(ProbeBatchStarted {
        batch_id,
        plugin_ids: response_plugin_ids,
    })
}

fn run_and_emit_probe(
    handle: &tauri::AppHandle,
    data_dir: &PathBuf,
    history_dir: &PathBuf,
    version: &str,
    batch_id: &str,
    plugin: plugin_engine::manifest::LoadedPlugin,
    account_context: provider_accounts::ProviderAccountContext,
) {
    let plugin_id = account_context.instance_id.clone();
    let probe_display_name = if account_context.label.trim().is_empty() {
        plugin.manifest.name.clone()
    } else {
        format!(
            "{} ({})",
            plugin.manifest.name,
            account_context.label.trim()
        )
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        plugin_engine::runtime::run_probe_with_account(
            &plugin,
            data_dir,
            version,
            Some(account_context),
        )
    }));

    match result {
        Ok(output) => {
            let has_error = output.lines.iter().any(|line| {
                matches!(line, plugin_engine::runtime::MetricLine::Badge { label, .. } if label == "Error")
            });
            if has_error {
                log::warn!("probe {} completed with error", plugin_id);
            } else {
                log::info!(
                    "probe {} completed ok ({} lines)",
                    plugin_id,
                    output.lines.len()
                );
                local_http_api::cache_successful_output(&output);
                if persist_usage_history_enabled(handle) {
                    if let Err(e) =
                        crossusage_core::usage_history::append_probe_snapshot(history_dir, &output)
                    {
                        log::debug!("usage history append: {}", e);
                    }
                    crossusage_core::plugin_engine::host_api::post_probe_ccusage_daily(
                        history_dir,
                        &plugin_id,
                        &output.display_name,
                    );
                }
            }
            let _ = handle.emit(
                "probe:result",
                ProbeResult {
                    batch_id: batch_id.to_string(),
                    output,
                },
            );
        }
        Err(_) => {
            log::error!("probe {} panicked", plugin_id);
            let output = plugin_engine::runtime::probe_fault_output(
                &plugin,
                &plugin_id,
                &probe_display_name,
                "The probe crashed. Try again or update the app.".to_string(),
            );
            let _ = handle.emit(
                "probe:result",
                ProbeResult {
                    batch_id: batch_id.to_string(),
                    output,
                },
            );
        }
    }

    note_probe_finished(handle, batch_id);

    // Run coalesced follow-up for this id (nested call continues the chain).
    if let Some(pending) = take_follow_up(Some(&plugin_id)) {
        run_and_emit_probe(
            handle,
            data_dir,
            history_dir,
            version,
            &pending.batch_id,
            pending.plugin,
            pending.account,
        );
    }
}

pub(crate) fn resolve_log_file_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("no home dir")?;
        let bundle_id = app_handle.config().identifier.clone();
        let log_dir = home.join("Library").join("Logs").join(&bundle_id);
        let log_file = log_dir.join(format!("{}.log", app_handle.package_info().name));
        Ok(log_file.to_string_lossy().to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::Manager;
        let log_dir = app_handle.path().app_log_dir().map_err(|e| e.to_string())?;
        let log_file = log_dir.join(format!("{}.log", app_handle.package_info().name));
        Ok(log_file.to_string_lossy().to_string())
    }
}

#[tauri::command]
fn codex_claim_reset_credit(
    state: tauri::State<'_, Mutex<AppState>>,
    app_handle: tauri::AppHandle,
    expires_at_iso: String,
    redeem_request_id: String,
    plugin_id: Option<String>,
) -> Result<String, String> {
    let instance_id = plugin_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("codex")
        .to_string();
    let (plugins, app_data_dir, version) = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        (
            locked.plugins.clone(),
            locked.app_data_dir.clone(),
            app_handle.package_info().version.to_string(),
        )
    };

    let account = provider_accounts::get_account(&app_data_dir, &instance_id)
        .ok()
        .flatten();
    let base_provider_id = account
        .as_ref()
        .map(|entry| entry.base_provider_id.clone())
        .filter(|base| !base.is_empty())
        .unwrap_or_else(|| {
            instance_id
                .split_once(':')
                .map(|(base, _)| base.to_string())
                .unwrap_or_else(|| {
                    if instance_id.starts_with("codex") {
                        "codex".to_string()
                    } else {
                        instance_id.clone()
                    }
                })
        });

    let plugin = plugins
        .into_iter()
        .find(|p| p.manifest.id == base_provider_id || p.manifest.id == "codex")
        .ok_or_else(|| "codex plugin not loaded".to_string())?;

    let credential = account
        .as_ref()
        .map(|entry| entry.credential.clone())
        .filter(|credential| !credential.is_empty());
    let label = account
        .as_ref()
        .map(|entry| entry.label.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| instance_id.clone());
    let account_context = provider_accounts::ProviderAccountContext {
        instance_id: instance_id.clone(),
        base_provider_id,
        label,
        credential,
        store_path: Some(provider_accounts::store_path(&app_data_dir)),
    };

    let args = serde_json::json!({
        "expiresAtIso": expires_at_iso,
        "redeemRequestId": redeem_request_id,
    });
    plugin_engine::runtime::run_plugin_action(
        &plugin,
        &app_data_dir,
        &version,
        "claimResetCredit",
        &args.to_string(),
        Some(account_context),
    )
}

#[tauri::command]
fn get_log_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    log_path::for_app(&app_handle).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_log_level(app_handle: tauri::AppHandle) -> String {
    tray::log_level_to_str(tray::current_log_level(&app_handle)).to_string()
}

#[tauri::command]
fn set_log_level(app_handle: tauri::AppHandle, level: String) -> Result<(), String> {
    let filter = tray::log_level_from_str(level.trim())
        .ok_or_else(|| format!("invalid log level: {level}"))?;
    tray::apply_log_level(&app_handle, filter);
    Ok(())
}

#[tauri::command]
fn reveal_log_in_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = log_path::for_app(&app_handle).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().ok_or_else(|| "log file has no parent directory".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Returns `std::env::consts::OS` for the **built** target (e.g. `linux`, `windows`, `macos`).
#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn get_os_diagnostics() -> os_diagnostics::OsDiagnostics {
    os_diagnostics::collect()
}

/// Linux: updates disabled tray menu rows that mirror the dynamic usage tooltip. Other OS: no-op.
#[tauri::command]
fn update_tray_usage_summary(summary: String) {
    tray::update_tray_usage_summary(&summary);
}

#[tauri::command]
fn get_support_bundle_json(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    support_bundle::build_support_bundle(&app_handle)
}

fn persist_usage_history_enabled(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    match app.store("settings.json") {
        Ok(store) => store
            .get("persistUsageHistory")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        Err(_) => false,
    }
}

#[tauri::command]
fn list_usage_history(
    state: tauri::State<'_, Mutex<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<crossusage_core::usage_history::UsageHistoryRow>, String> {
    let dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    crossusage_core::usage_history::list_recent(&dir, limit.unwrap_or(80)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_usage_insights(
    state: tauri::State<'_, Mutex<AppState>>,
    limit: Option<u32>,
) -> Result<crossusage_core::usage_history::HistoryInsightsSummary, String> {
    let dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    crossusage_core::usage_history::insights_summary(&dir, limit.unwrap_or(5))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_usage_history(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    crossusage_core::usage_history::clear_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_usage_daily(
    state: tauri::State<'_, Mutex<AppState>>,
    limit: Option<u32>,
    instance_id: Option<String>,
) -> Result<Vec<crossusage_core::usage_daily::UsageDailyRow>, String> {
    let dir = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        locked.app_data_dir.clone()
    };
    crossusage_core::usage_daily::list_recent(
        &dir,
        limit.unwrap_or(120),
        instance_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn query_cursor_usage_stats(
    plugin_id: Option<String>,
    since: Option<String>,
    until: Option<String>,
    group: Option<String>,
) -> Result<serde_json::Value, String> {
    let plugin_id = plugin_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("cursor");
    let payload = crossusage_core::cursor_usage_export::query_usage_stats(
        plugin_id,
        since.as_deref(),
        until.as_deref(),
        group.as_deref().unwrap_or("model"),
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_value(payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_restart_label(text: String) {
    tray::set_tray_restart_menu_text(&text);
}

/// Update the global shortcut registration.
/// Pass `null` to disable the shortcut, or a shortcut string like "CommandOrControl+Shift+U".
#[cfg(desktop)]
#[tauri::command]
fn update_global_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: Option<String>,
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();
    let normalized_shortcut = shortcut.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let mut managed_shortcut = managed_shortcut_slot()
        .lock()
        .map_err(|e| format!("failed to lock managed shortcut state: {}", e))?;

    if *managed_shortcut == normalized_shortcut {
        log::debug!("Global shortcut unchanged");
        return Ok(());
    }

    let previous_shortcut = managed_shortcut.clone();
    if let Some(existing) = previous_shortcut.as_deref() {
        match global_shortcut.unregister(existing) {
            Ok(()) => {
                // Keep in-memory state aligned with actual registration state.
                *managed_shortcut = None;
            }
            Err(e) => {
                log::warn!(
                    "Failed to unregister existing shortcut '{}': {}",
                    existing,
                    e
                );
            }
        }
    }

    if let Some(shortcut) = normalized_shortcut {
        log::info!("Registering global shortcut: {}", shortcut);
        global_shortcut
            .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
                handle_global_shortcut(app, event);
            })
            .map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;
        *managed_shortcut = Some(shortcut);
    } else {
        log::info!("Global shortcut disabled");
        *managed_shortcut = None;
    }

    Ok(())
}

#[tauri::command]
fn list_plugins(state: tauri::State<'_, Mutex<AppState>>) -> Vec<PluginMeta> {
    let plugins = {
        let locked = state.lock().expect("plugin state poisoned");
        locked.plugins.clone()
    };
    log::debug!("list_plugins: {} plugins", plugins.len());

    plugins
        .into_iter()
        .map(|plugin| {
            // Extract primary candidates: progress lines with primary_order, sorted by order
            let mut candidates: Vec<_> = plugin
                .manifest
                .lines
                .iter()
                .filter(|line| line.line_type == "progress" && line.primary_order.is_some())
                .collect();
            candidates.sort_by_key(|line| line.primary_order.unwrap());
            let primary_candidates: Vec<String> =
                candidates.iter().map(|line| line.label.clone()).collect();

            PluginMeta {
                id: plugin.manifest.id,
                name: plugin.manifest.name,
                icon_url: plugin.icon_data_url,
                icon_file_path: plugin.icon_file_path.to_string_lossy().to_string(),
                brand_color: plugin.manifest.brand_color,
                lines: plugin
                    .manifest
                    .lines
                    .iter()
                    .map(|line| ManifestLineDto {
                        line_type: line.line_type.clone(),
                        label: line.label.clone(),
                        scope: line.scope.clone(),
                    })
                    .collect(),
                links: plugin
                    .manifest
                    .links
                    .iter()
                    .map(|link| PluginLinkDto {
                        label: link.label.clone(),
                        url: link.url.clone(),
                    })
                    .collect(),
                primary_candidates,
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = runtime.enter();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_aptabase::Builder::new(APTABASE_APP_KEY).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(10_000_000) // 10 MB
                .level(log::LevelFilter::Trace) // Allow all levels; runtime filter via tray menu
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Info)
                .level_for("tauri_plugin_updater", log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_liquid_glass::init())
        .invoke_handler(tauri::generate_handler![
            init_panel,
            hide_panel,
            set_liquid_glass_enabled,
            open_devtools,
            start_probe_batch,
            codex_claim_reset_credit,
            list_provider_accounts,
            save_provider_account,
            delete_provider_account,
            list_plugins,
            get_log_path,
            get_log_level,
            set_log_level,
            reveal_log_in_folder,
            get_support_bundle_json,
            list_usage_history,
            get_usage_insights,
            list_usage_daily,
            query_cursor_usage_stats,
            clear_usage_history,
            get_platform,
            usage_alert_sound::play_usage_alert_sound,
            get_os_diagnostics,
            update_tray_usage_summary,
            set_tray_restart_label,
            update_global_shortcut
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(target_os = "macos")]
            {
                app_nap::disable_app_nap();
                webkit_config::configure_webview(app.handle());
            }

            use tauri::Manager;

            let version = app.package_info().version.to_string();
            log::info!(
                "CrossUsage v{} starting | Tauri {} | id {} | {}",
                version,
                tauri::VERSION,
                app.config().identifier,
                os_diagnostics::log_summary_one_line()
            );

            ensure_crossusage_user_config_file();

            track_daily_active_if_needed(app.handle());
            // Send startup event immediately; otherwise Aptabase only flushes on an interval and the
            // dashboard can sit on “Waiting for the first event…” for up to a minute in release builds.
            app.handle().flush_events_blocking();
            #[cfg(desktop)]
            spawn_daily_active_rollover_tracker(app.handle().clone());

            let app_data_dir = app.path().app_data_dir().expect("no app data dir");
            // `tauri dev` often has no packaged `resource_dir()` (returns Err) — do not panic;
            // `initialize_plugins` falls back to repo `plugins/` via `find_dev_plugins_dir()` and/or
            // copies from bundled resources when a root exists (release / portable).
            let resource_dir = app.path().resource_dir().ok();
            if resource_dir.is_none() {
                log::warn!(
                    "resource_dir unavailable (common in tauri dev); using dev plugins dir / app data only"
                );
            }
            log::debug!("app_data_dir: {:?}", app_data_dir);
            log::debug!("resource_dir: {:?}", resource_dir);

            let (_, plugins) =
                plugin_engine::initialize_plugins(&app_data_dir, resource_dir.as_deref());
            let known_plugin_ids: Vec<String> =
                plugins.iter().map(|p| p.manifest.id.clone()).collect();
            local_http_api::init(&app_data_dir, known_plugin_ids);
            local_http_api::start_server();

            app.manage(Mutex::new(AppState {
                plugins,
                app_data_dir,
                app_version: app.package_info().version.to_string(),
            }));

            tray::create(app.handle())?;

            // Main window defaults to `visible: false` in `tauri.conf.json`. Windows already
            // shows it here; Linux needs the same so `tauri dev` is usable without hunting the
            // tray first (especially when the shell job is easy to confuse with a crash).
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                panel::init(app.handle())?;
                panel::show_panel(app.handle());
            }

            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Register global shortcut from stored settings
            #[cfg(desktop)]
            {
                use tauri_plugin_store::StoreExt;

                if let Ok(store) = app.handle().store("settings.json") {
                    if let Some(shortcut_value) = store.get(GLOBAL_SHORTCUT_STORE_KEY) {
                        if let Some(shortcut) = shortcut_value.as_str() {
                            let shortcut = shortcut.trim();
                            if !shortcut.is_empty() {
                                let handle = app.handle().clone();
                                log::info!("Registering initial global shortcut: {}", shortcut);
                                if let Err(e) = handle.global_shortcut().on_shortcut(
                                    shortcut,
                                    |app, _shortcut, event| {
                                        handle_global_shortcut(app, event);
                                    },
                                ) {
                                    log::warn!("Failed to register initial global shortcut: {}", e);
                                } else if let Ok(mut managed_shortcut) =
                                    managed_shortcut_slot().lock()
                                {
                                    *managed_shortcut = Some(shortcut.to_string());
                                } else {
                                    log::warn!("Failed to store managed shortcut in memory");
                                }
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // Only prevent exit for window close (code=None). Allow Restart and Quit from tray.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        DAILY_ACTIVE_TRACKED_DAY_KEY, seconds_until_next_utc_day, should_track_daily_active,
    };
    use time::{Date, Month, PrimitiveDateTime, Time};

    #[test]
    fn should_track_when_no_previous_day() {
        assert!(should_track_daily_active(None, "2026-02-12"));
    }

    #[test]
    fn should_not_track_when_same_day() {
        assert!(!should_track_daily_active(Some("2026-02-12"), "2026-02-12"));
    }

    #[test]
    fn should_track_when_day_changes() {
        assert!(should_track_daily_active(Some("2026-02-11"), "2026-02-12"));
    }

    #[test]
    fn daily_active_key_is_not_version_scoped() {
        assert_eq!(DAILY_ACTIVE_TRACKED_DAY_KEY, "analytics.daily_active_day");
        assert!(!DAILY_ACTIVE_TRACKED_DAY_KEY.contains("0.6.2"));
        assert!(!DAILY_ACTIVE_TRACKED_DAY_KEY.contains("0.6.3"));
    }

    #[test]
    fn rollover_sleep_waits_for_next_utc_day_boundary() {
        let now = PrimitiveDateTime::new(
            Date::from_calendar_date(2026, Month::February, 12).unwrap(),
            Time::from_hms(23, 59, 50).unwrap(),
        )
        .assume_utc();

        assert_eq!(seconds_until_next_utc_day(now), 10);
    }
}
