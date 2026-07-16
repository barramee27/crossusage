//! Batch CLI (`list` / `probe` / live `export`) uses a wall-clock probe timeout (same default as the TUI).
//!
//! We use **`std::thread` + `mpsc::recv_timeout`** — **not** a per-probe Tokio `Runtime`. Creating and
//! dropping a `Runtime` after `timeout!` can **block forever** on shutdown while a `spawn_blocking`
//! probe is still running, which looked like “stuck on 11/16” after a timeout message.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crossusage_core::plugin_engine::manifest::LoadedPlugin;
use crossusage_core::plugin_engine::runtime::{self, MetricLine, PluginOutput};

/// Same as the dashboard: `CROSSUSAGE_PROBE_TIMEOUT_SEC` or **120** seconds.
pub fn probe_timeout_secs() -> u64 {
    std::env::var("CROSSUSAGE_PROBE_TIMEOUT_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&s| s > 0)
        .unwrap_or(120)
}

fn probe_error_output(plugin: &LoadedPlugin, message: String) -> PluginOutput {
    PluginOutput {
        provider_id: plugin.manifest.id.clone(),
        display_name: plugin.manifest.name.clone(),
        plan: None,
        warning: None,
        lines: vec![MetricLine::Text {
            label: "Error".into(),
            value: message,
            color: None,
            subtitle: None,
        model_breakdown: None,
        status_dot: None,
        expiry_tooltip: None,
        reset_credit_expiries: None,
        }],
        icon_url: plugin.icon_data_url.clone(),
    }
}

fn exit_if_interrupted(interrupt: Option<&Arc<AtomicBool>>) {
    if let Some(f) = interrupt {
        if f.load(Ordering::SeqCst) {
            eprintln!("\ncrossusage-cli: interrupted");
            std::process::exit(130);
        }
    }
}

/// Wall-clock timeout; optional **SIGINT** flag checked every ~200ms (so Ctrl+C works during a probe).
///
/// On timeout the probe **thread is left running** in the background until it finishes (same as
/// skipping ahead — we do not join it). The process exits after `list` completes, so this is bounded.
pub fn run_probe_with_timeout(
    plugin: &LoadedPlugin,
    app_data: &PathBuf,
    version: &str,
    interrupt: Option<&Arc<AtomicBool>>,
) -> PluginOutput {
    let plugin_for_err = plugin.clone();
    let plugin_id = plugin_for_err.manifest.id.clone();
    let timeout_sec = probe_timeout_secs();
    let deadline = Instant::now() + Duration::from_secs(timeout_sec);

    let plugin_thread = plugin.clone();
    let app_data_thread = app_data.clone();
    let version_thread = version.to_string();
    let (tx, rx) = mpsc::channel();
    let _join = thread::spawn(move || {
        let out = runtime::run_probe(&plugin_thread, &app_data_thread, &version_thread);
        let _ = tx.send(out);
    });

    const TICK: Duration = Duration::from_millis(200);

    loop {
        exit_if_interrupted(interrupt);

        let now = Instant::now();
        if now >= deadline {
            eprintln!(
                "crossusage-cli: probe timed out after {timeout_sec}s for provider `{plugin_id}` \
                 (set CROSSUSAGE_PROBE_TIMEOUT_SEC or e.g. `crossusage-cli list cursor`.)"
            );
            return probe_error_output(
                &plugin_for_err,
                format!(
                    "Probe timed out after {timeout_sec}s. The provider may be waiting on the network — \
                     set CROSSUSAGE_PROBE_TIMEOUT_SEC or probe fewer providers."
                ),
            );
        }

        let remaining = deadline.saturating_duration_since(now);
        let wait = TICK.min(remaining);

        match rx.recv_timeout(wait) {
            Ok(o) => return o,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return probe_error_output(
                    &plugin_for_err,
                    "Probe thread ended without returning a result (panic?).".into(),
                );
            }
        }
    }
}
