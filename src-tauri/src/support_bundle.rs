//! Redacted diagnostics for GitHub issues (no provider tokens or secrets).

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use log::warn;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const PLUGIN_SETTINGS_KEY: &str = "plugins";
const LOG_LEVEL_STORE_KEY: &str = "logLevel";

/// Max log file size we read entirely into memory for tail processing.
const LOG_FILE_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// How many **raw** lines from the end of the file we scan (before noise filter / dedupe).
const RAW_TAIL_MAX_LINES: usize = 12_000;
/// Lines kept after processing (newest region).
const OUT_MAX_LINES: usize = 200;
/// Hard cap on pasted characters (GitHub issue body limits).
const OUT_MAX_CHARS: usize = 72_000;

/// Strip common secret patterns from free-form text (best-effort, not cryptographic).
pub fn redact_sensitive_text(input: &str) -> String {
    let mut s = input.to_string();
    for needle in [
        "Bearer ",
        "bearer ",
        "Basic ",
        "sk-ant-",
        "sk-proj-",
        "sk-",
        "xoxb-",
        "ghp_",
        "gho_",
        "github_pat_",
        "session=",
        "refresh_token",
        "access_token",
    ] {
        while let Some(i) = s.find(needle) {
            let rest = &s[i + needle.len()..];
            let take = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
                .count();
            let end = i + needle.len() + take;
            s.replace_range(i..end, &format!("{}[REDACTED]", needle));
        }
    }
    s
}

fn enabled_instance_ids(plugins: Option<&Value>) -> Vec<String> {
    let Some(Value::Object(obj)) = plugins else {
        return vec![];
    };
    let order = obj
        .get("order")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let disabled: std::collections::HashSet<String> = obj
        .get("disabled")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    order
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .filter(|id| !disabled.contains(id))
        .collect()
}

fn provider_instance_key_count(plugins: Option<&Value>) -> usize {
    let Some(Value::Object(obj)) = plugins else {
        return 0;
    };
    obj.get("providerInstances")
        .and_then(|v| v.as_object())
        .map(|m| m.len())
        .unwrap_or(0)
}

/// Extract `[plugin:INSTANCE]` tag from a log line, if present.
fn plugin_id_tag_in_line(line: &str) -> Option<&str> {
    const PREFIX: &str = "[plugin:";
    let start = line.find(PREFIX)? + PREFIX.len();
    let rest = line.get(start..)?;
    let end = rest.find(']')?;
    Some(rest.get(..end)?.trim())
}

/// Drop lines for provider instances the user has **disabled** (not in sidebar order).
/// When `enabled` is empty we keep all plugin lines (cannot infer intent).
fn should_keep_line_for_enabled_plugins(line: &str, enabled: &HashSet<String>) -> bool {
    if enabled.is_empty() {
        return true;
    }
    let Some(pid) = plugin_id_tag_in_line(line) else {
        return true;
    };
    enabled.contains(pid)
}

/// High-churn lines that drown out real probe/account errors in a short tail window.
fn is_support_bundle_log_noise(line: &str) -> bool {
    if line.contains("tauri_plugin_updater::updater")
        && line.contains("update endpoint did not respond")
    {
        return true;
    }
    if line.contains("tauri_plugin_aptabase::dispatcher][TRACE]") {
        return line.contains("flushing tracking events")
            || line.contains("nothing to send")
            || line.contains("preparing ")
            || line.contains("sent ");
    }
    // Every session repeats these; they are not actionable in issue reports.
    if line.contains("crossusage_lib") && line.contains("CrossUsage v") && line.contains(" starting") {
        return true;
    }
    if line.contains("[crossusage_lib][DEBUG] app_data_dir:") {
        return true;
    }
    if line.contains("[crossusage_lib][DEBUG] resource_dir:") {
        return true;
    }
    if line.contains("crossusage_lib::local_http_api::server")
        && line.contains("local HTTP API listening")
    {
        return true;
    }
    // One-time startup / env; not actionable for issue triage.
    if line.contains("crossusage_core::proxy_config][DEBUG]")
        || line.contains("crossusage_lib::config][DEBUG]")
    {
        return true;
    }
    if line.contains("tauri_plugin_aptabase::dispatcher][DEBUG]")
        && line.contains("failed to track_event")
    {
        return true;
    }
    false
}

/// Collapse consecutive identical lines into one line with a repeat count (×N).
fn collapse_consecutive_identical_runs(lines: Vec<String>) -> Vec<String> {
    if lines.is_empty() {
        return lines;
    }
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let cur = &lines[i];
        let mut count = 1usize;
        while i + count < lines.len() && lines[i + count] == *cur {
            count += 1;
        }
        if count == 1 {
            out.push(cur.clone());
        } else {
            out.push(format!("{cur}  (×{count})"));
        }
        i += count;
    }
    out
}

fn truncate_chars_with_note(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        return s.to_string();
    }
    let head: String = s.chars().take(max_chars.saturating_sub(48)).collect();
    format!("{head}\n… (log tail truncated: {n} → ~{max_chars} chars)")
}

fn process_log_tail_for_bundle(raw: &str, enabled_plugin_instance_ids: Option<&HashSet<String>>) -> String {
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(RAW_TAIL_MAX_LINES);
    let filtered: Vec<String> = lines[start..]
        .iter()
        .filter(|line| !is_support_bundle_log_noise(line))
        .filter(|line| {
            enabled_plugin_instance_ids
                .map(|set| should_keep_line_for_enabled_plugins(line, set))
                .unwrap_or(true)
        })
        .map(|s| (*s).to_string())
        .collect();

    let collapsed = collapse_consecutive_identical_runs(filtered);
    let take_start = collapsed.len().saturating_sub(OUT_MAX_LINES);
    let tail: String = collapsed[take_start..].join("\n");
    truncate_chars_with_note(&tail, OUT_MAX_CHARS)
}

fn read_log_tail_redacted(path: &Path, enabled_plugin_instance_ids: Option<&HashSet<String>>) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > LOG_FILE_MAX_BYTES {
        return Some(format!(
            "(log file >{}MiB, tail omitted; path in logPath)",
            LOG_FILE_MAX_BYTES / (1024 * 1024)
        ));
    }
    let raw = fs::read_to_string(path).ok()?;
    Some(redact_sensitive_text(&process_log_tail_for_bundle(
        &raw,
        enabled_plugin_instance_ids,
    )))
}

/// Build JSON suitable for pasting into a GitHub issue.
pub fn build_support_bundle(app: &AppHandle) -> Result<Value, String> {
    let version = app.package_info().version.to_string();
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    let (enabled, account_slots, log_level) = match app.store("settings.json") {
        Ok(store) => {
            let plugins_val = store.get(PLUGIN_SETTINGS_KEY);
            let enabled = enabled_instance_ids(plugins_val.as_ref());
            let account_slots = provider_instance_key_count(plugins_val.as_ref());
            let log_level = store
                .get(LOG_LEVEL_STORE_KEY)
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "default".into());
            (enabled, account_slots, log_level)
        }
        Err(e) => {
            warn!("support bundle: could not open settings store: {}", e);
            (vec![], 0usize, "default".to_string())
        }
    };

    let enabled_set: HashSet<String> = enabled.iter().cloned().collect();

    let log_path = crate::resolve_log_file_path(app)?;
    let log_tail = Path::new(&log_path)
        .exists()
        .then(|| read_log_tail_redacted(Path::new(&log_path), Some(&enabled_set)))
        .flatten();

    let identifier = app.config().identifier.clone();
    let osd = crate::os_diagnostics::collect();

    Ok(json!({
        "app": "CrossUsage",
        "appVersion": version,
        "os": os,
        "arch": arch,
        "enabledProviderInstanceIds": enabled,
        "providerInstanceSlotCount": account_slots,
        "logLevel": log_level,
        "logPath": log_path,
        "logTailRedacted": log_tail,
        "logTailProcessing": format!(
            "last {} raw file lines scanned; startup chatter + proxy/clipboard debug + aptabase/updater noise dropped; lines tagged [plugin:ID] for disabled accounts (not in enabledProviderInstanceIds) dropped when that list is non-empty; consecutive identical lines collapsed; newest {} lines kept; max ~{} chars",
            RAW_TAIL_MAX_LINES, OUT_MAX_LINES, OUT_MAX_CHARS
        ),
        "runtime": {
            "tauriLibrary": tauri::VERSION,
            "identifier": identifier,
            "family": osd.family,
            "distro": osd.distro,
            "kernel": osd.kernel,
        },
        "note": "get_support_bundle_json returns full JSON for advanced use; Settings → Copy log tail builds a short header plus logTailRedacted. logTailRedacted omits lines for disabled provider accounts when enabledProviderInstanceIds is non-empty (on-disk log file is unchanged). Redaction is best-effort.",
    }))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{
        collapse_consecutive_identical_runs, is_support_bundle_log_noise, process_log_tail_for_bundle,
        redact_sensitive_text,
    };

    #[test]
    fn redacts_bearer() {
        let s = redact_sensitive_text("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx");
        assert!(!s.contains("eyJ"));
        assert!(s.contains("Bearer [REDACTED]"));
    }

    #[test]
    fn redacts_sk_prefix() {
        let s = redact_sensitive_text("key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789AB end");
        assert!(s.contains("[REDACTED]"));
        assert!(!s.contains("sk-proj-abc"));
    }

    #[test]
    fn detects_updater_noise() {
        let line = "[2026-05-08][13:07:39][tauri_plugin_updater::updater][ERROR] update endpoint did not respond with a successful status code";
        assert!(is_support_bundle_log_noise(line));
    }

    #[test]
    fn keeps_cursor_probe_errors() {
        let line = "[2026-05-13][03:57:25][crossusage_core::plugin_engine::host_api][ERROR] [plugin:cursor:work] refresh response indicates shouldLogout=true";
        assert!(!is_support_bundle_log_noise(line));
    }

    #[test]
    fn collapses_runs() {
        let v = vec![
            "a".to_string(),
            "a".to_string(),
            "a".to_string(),
            "b".to_string(),
        ];
        let out = collapse_consecutive_identical_runs(v);
        assert_eq!(out, vec!["a  (×3)".to_string(), "b".to_string()]);
    }

    #[test]
    fn filters_crossusage_startup_chatter() {
        let line = "[2026-05-08][13:38:51][crossusage_lib][INFO] CrossUsage v1.0.8 starting";
        assert!(is_support_bundle_log_noise(line));
        assert!(is_support_bundle_log_noise(
            "[x][crossusage_lib][DEBUG] app_data_dir: \"/home/u/.local/share/com.barramee27.crossusage\""
        ));
        assert!(is_support_bundle_log_noise(
            "[x][crossusage_lib::local_http_api::server][INFO] local HTTP API listening on 127.0.0.1:6736"
        ));
    }

    #[test]
    fn process_tail_drops_updater_and_collapses() {
        let raw = "\
line-keep\n\
[up][tauri_plugin_updater::updater][ERROR] update endpoint did not respond with a successful status code\n\
[up][tauri_plugin_updater::updater][ERROR] update endpoint did not respond with a successful status code\n\
same\n\
same\n\
same\n\
cursor-error\n\
";
        let out = process_log_tail_for_bundle(raw, None);
        assert!(out.contains("line-keep"));
        assert!(!out.contains("update endpoint did not respond"));
        assert!(out.contains("same  (×3)"));
        assert!(out.contains("cursor-error"));
    }

    #[test]
    fn process_tail_drops_lines_for_disabled_plugin_instances() {
        let enabled: HashSet<String> = std::iter::once("cursor".to_string()).collect();
        let raw = "\
[x][crossusage_core::plugin_engine::host_api][ERROR] [plugin:claude] probe failed: not logged in\n\
[x][crossusage_core::plugin_engine::host_api][ERROR] [plugin:cursor] probe failed: no token\n\
";
        let out = process_log_tail_for_bundle(raw, Some(&enabled));
        assert!(!out.contains("claude"));
        assert!(out.contains("cursor"));
    }

    #[test]
    fn process_tail_keeps_all_plugin_lines_when_enabled_set_empty() {
        let enabled: HashSet<String> = HashSet::new();
        let raw = "[x][host][ERROR] [plugin:claude] probe failed\n";
        let out = process_log_tail_for_bundle(raw, Some(&enabled));
        assert!(out.contains("claude"));
    }
}
