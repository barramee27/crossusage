//! Native local-log usage scanners for CLI agents that do not run a custom JS scanner during probe:
//! OpenCode, Amp, Kimi, and GitHub Copilot.
//!
//! Replaces the external `ccusage` Node/npm/bunx subprocess runner with offline, zero-dependency
//! Rust parsers sharing `log_usage_types` and bundled `model_pricing`.

use crate::claude_usage_scanner::parse_iso_timestamp;
use crate::log_usage_types::{
    DailyUsageRow, LogScanStatus, ModelDayUsage, TokenBreakdown, bounded_token_count,
    cap_log_files_by_mtime, expand_tilde, local_day_key_from_offset, since_local_midnight,
    warn_unreadable_usage_file,
};
use crate::model_pricing::{ModelPricing, default_pricing};
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_LOOKBACK_DAYS: i32 = 31;
const KIMI_DEFAULT_MODEL: &str = "kimi-for-coding";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LocalCliProvider {
    OpenCode,
    Amp,
    Kimi,
    Copilot,
}

impl LocalCliProvider {
    pub fn from_plugin_id(plugin_id: &str) -> Option<Self> {
        let base = plugin_id.split(':').next().unwrap_or(plugin_id);
        match base.trim().to_ascii_lowercase().as_str() {
            "opencode" | "opencode-go" => Some(Self::OpenCode),
            "amp" => Some(Self::Amp),
            "kimi" => Some(Self::Kimi),
            "copilot" => Some(Self::Copilot),
            _ => None,
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::OpenCode => "opencode",
            Self::Amp => "amp",
            Self::Kimi => "kimi",
            Self::Copilot => "copilot",
        }
    }
}

/// True when CrossUsage has a built-in post-probe native log scanner for this plugin id.
pub fn local_cli_scanner_supported(plugin_id: &str) -> bool {
    LocalCliProvider::from_plugin_id(plugin_id).is_some()
}

fn active_scan_registry() -> &'static Mutex<HashSet<String>> {
    static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}

struct ActiveScanGuard {
    key: String,
}

impl ActiveScanGuard {
    fn try_acquire(provider: LocalCliProvider) -> Option<Self> {
        let mut active = active_scan_registry().lock().ok()?;
        let key = provider.key().to_string();
        if !active.insert(key.clone()) {
            return None;
        }
        Some(Self { key })
    }
}

impl Drop for ActiveScanGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = active_scan_registry().lock() {
            active.remove(&self.key);
        }
    }
}

/// After a successful probe, scan local CLI logs natively and ingest daily rows into `usage_daily`.
pub fn post_probe_local_usage_daily(
    app_data_dir: &Path,
    plugin_id: &str,
    display_name: &str,
) {
    if !crate::usage_history::persist_usage_history_enabled(app_data_dir) {
        return;
    }
    let Some(provider) = LocalCliProvider::from_plugin_id(plugin_id) else {
        return;
    };
    let Some(_guard) = ActiveScanGuard::try_acquire(provider) else {
        log::debug!(
            "[plugin:{}] local usage post-probe skipped: scan already running",
            plugin_id
        );
        return;
    };

    let (status, daily) = query_provider_daily(provider, DEFAULT_LOOKBACK_DAYS);
    if status != LogScanStatus::Ok || daily.is_empty() {
        return;
    }

    let payload = serde_json::json!({
        "displayName": display_name,
        "source": "local_logs",
        "daily": daily,
    });
    if let Err(e) = crate::usage_daily::ingest_json(app_data_dir, plugin_id, &payload.to_string()) {
        log::debug!(
            "[plugin:{}] local usage post-probe ingest failed: {}",
            plugin_id,
            e
        );
    }
}

pub fn query_provider_daily(
    provider: LocalCliProvider,
    days_back: i32,
) -> (LogScanStatus, Vec<DailyUsageRow>) {
    let since = since_local_midnight(days_back);
    let pricing = default_pricing();
    let rows = match provider {
        LocalCliProvider::OpenCode => scan_opencode(&opencode_dirs(), since, pricing),
        LocalCliProvider::Amp => scan_amp(&amp_dirs(), since, pricing),
        LocalCliProvider::Kimi => scan_kimi(&kimi_dirs(), since, pricing),
        LocalCliProvider::Copilot => {
            scan_copilot(&copilot_sources(), since, pricing)
        }
    };
    if rows.is_empty() {
        (LogScanStatus::NoData, Vec::new())
    } else {
        (LogScanStatus::Ok, rows)
    }
}

// ---------------------------------------------------------------------------
// Shared entry, timestamp, file discovery, and aggregation helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct UsageEntry {
    dedup_id: Option<String>,
    timestamp: DateTime<Utc>,
    model: String,
    tokens: TokenBreakdown,
    carried_cost: Option<f64>,
}

#[derive(Debug, Clone)]
pub(crate) struct DiscoveredFile {
    path: PathBuf,
    size: u64,
    mtime: SystemTime,
}

fn file_mtime_before(mtime: &SystemTime, since: DateTime<Utc>) -> bool {
    let Ok(dur) = mtime.duration_since(UNIX_EPOCH) else {
        return false;
    };
    let Some(dt) = DateTime::<Utc>::from_timestamp(dur.as_secs() as i64, dur.subsec_nanos()) else {
        return false;
    };
    dt < since
}

fn file_modified_utc(path: &Path) -> DateTime<Utc> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| DateTime::<Utc>::from_timestamp(d.as_secs() as i64, d.subsec_nanos()))
        .unwrap_or_else(Utc::now)
}

fn collect_files_with_extension(dir: &Path, ext: &str, out: &mut Vec<DiscoveredFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            collect_files_with_extension(&path, ext, out);
        } else if ft.is_file()
            && path.extension().and_then(|e| e.to_str()) == Some(ext)
        {
            if let Ok(meta) = entry.metadata() {
                let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
                out.push(DiscoveredFile {
                    path,
                    size: meta.len(),
                    mtime,
                });
            }
        }
    }
}

fn parse_env_dir_list(var: &str) -> Option<Vec<PathBuf>> {
    let raw = std::env::var(var).ok()?;
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    for item in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let p = expand_tilde(item);
        if p.is_dir() && seen.insert(p.clone()) {
            dirs.push(p);
        }
    }
    Some(dirs)
}

fn epoch_number_to_utc(raw: f64) -> Option<DateTime<Utc>> {
    if !raw.is_finite() || raw <= 0.0 {
        return None;
    }
    // Nanoseconds (>= 1e17), microseconds (>= 1e14), milliseconds (>= 1e11), otherwise seconds.
    let (secs, nanos) = if raw >= 1e17 {
        let ns = raw as i128;
        ((ns / 1_000_000_000) as i64, (ns % 1_000_000_000).unsigned_abs() as u32)
    } else if raw >= 1e14 {
        let us = raw as i128;
        ((us / 1_000_000) as i64, ((us % 1_000_000).unsigned_abs() * 1000) as u32)
    } else if raw >= 1e11 {
        let ms = raw as i64;
        (ms / 1000, ((ms % 1000).unsigned_abs() * 1_000_000) as u32)
    } else {
        let secs = raw.trunc() as i64;
        let nanos = ((raw.fract().abs()) * 1_000_000_000.0) as u32;
        (secs, nanos.min(999_999_999))
    };
    DateTime::<Utc>::from_timestamp(secs, nanos)
}

fn parse_timestamp_value(v: Option<&Value>) -> Option<DateTime<Utc>> {
    let v = v?;
    if let Some(s) = v.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Some(dt) = parse_iso_timestamp(trimmed) {
            return Some(dt);
        }
        if let Ok(num) = trimmed.parse::<f64>() {
            return epoch_number_to_utc(num);
        }
        if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
            return date.and_hms_opt(0, 0, 0).map(|ndt| ndt.and_utc());
        }
        return None;
    }
    if let Some(n) = v.as_i64() {
        return epoch_number_to_utc(n as f64);
    }
    if let Some(f) = v.as_f64() {
        return epoch_number_to_utc(f);
    }
    // OpenTelemetry hrTime `[seconds, nanos]` tuple
    if let Some(arr) = v.as_array() {
        if arr.len() >= 2 {
            let secs = arr[0].as_i64().or_else(|| arr[0].as_f64().map(|f| f as i64))?;
            let nanos = arr[1]
                .as_u64()
                .or_else(|| arr[1].as_f64().map(|f| f.max(0.0) as u64))
                .unwrap_or(0)
                .min(999_999_999) as u32;
            return DateTime::<Utc>::from_timestamp(secs, nanos);
        }
    }
    None
}

fn json_u64(v: Option<&Value>) -> u64 {
    let Some(v) = v else { return 0 };
    if let Some(n) = v.as_u64() {
        return n;
    }
    if let Some(n) = v.as_i64() {
        return n.max(0) as u64;
    }
    if let Some(f) = v.as_f64() {
        if f.is_finite() && f > 0.0 {
            return f.min(u64::MAX as f64) as u64;
        }
    }
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.trim().parse::<u64>() {
            return n;
        }
    }
    0
}

fn json_non_empty_str(v: Option<&Value>) -> Option<String> {
    v.and_then(|val| val.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn json_positive_f64(v: Option<&Value>) -> Option<f64> {
    let val = v?.as_f64()?;
    if val.is_finite() && val > 0.0 {
        Some(val)
    } else {
        None
    }
}

fn build_tokens(
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
    reasoning: u64,
    total: u64,
) -> Option<TokenBreakdown> {
    let mut out = output.saturating_add(reasoning);
    let known = input
        .saturating_add(out)
        .saturating_add(cache_write)
        .saturating_add(cache_read);
    if total > known {
        out = out.saturating_add(total - known);
    }
    let breakdown = TokenBreakdown {
        input: bounded_token_count(input.min(i64::MAX as u64) as i64),
        cache_write5m: bounded_token_count(cache_write.min(i64::MAX as u64) as i64),
        cache_write1h: 0,
        cache_read: bounded_token_count(cache_read.min(i64::MAX as u64) as i64),
        output: bounded_token_count(out.min(i64::MAX as u64) as i64),
        is_fast: false,
    };
    (breakdown.total_tokens() > 0).then_some(breakdown)
}

fn aggregate_entries(
    entries: &[UsageEntry],
    since: DateTime<Utc>,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    #[derive(Default)]
    struct DayAcc {
        input: i64,
        output: i64,
        cache_write: i64,
        cache_read: i64,
        cost: f64,
        has_cost: bool,
        models: BTreeMap<String, ModelAcc>,
    }

    #[derive(Default)]
    struct ModelAcc {
        input: i64,
        output: i64,
        cache_write: i64,
        cache_read: i64,
        cost: f64,
        has_cost: bool,
    }

    let mut by_day: BTreeMap<String, DayAcc> = BTreeMap::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for entry in entries {
        if entry.timestamp < since {
            continue;
        }
        if let Some(ref id) = entry.dedup_id {
            if !seen_ids.insert(id.clone()) {
                continue;
            }
        }
        let day_key = local_day_key_from_offset(&entry.timestamp);
        let model_key = pricing
            .canonical_name(&entry.model)
            .unwrap_or_else(|| entry.model.clone());
        let entry_cost = entry
            .carried_cost
            .or_else(|| pricing.estimated_cost_dollars(&entry.model, &entry.tokens));

        let day = by_day.entry(day_key).or_default();
        let cache_w = i64::from(entry.tokens.cache_write5m) + i64::from(entry.tokens.cache_write1h);
        day.input += i64::from(entry.tokens.input);
        day.output += i64::from(entry.tokens.output);
        day.cache_write += cache_w;
        day.cache_read += i64::from(entry.tokens.cache_read);
        if let Some(c) = entry_cost.filter(|v| v.is_finite() && *v >= 0.0) {
            day.cost += c;
            day.has_cost = true;
        }

        let m = day.models.entry(model_key).or_default();
        m.input += i64::from(entry.tokens.input);
        m.output += i64::from(entry.tokens.output);
        m.cache_write += cache_w;
        m.cache_read += i64::from(entry.tokens.cache_read);
        if let Some(c) = entry_cost.filter(|v| v.is_finite() && *v >= 0.0) {
            m.cost += c;
            m.has_cost = true;
        }
    }

    by_day
        .into_iter()
        .rev()
        .map(|(date, day)| {
            let input_tokens = bounded_token_count(day.input);
            let output_tokens = bounded_token_count(day.output);
            let cache_creation_tokens = bounded_token_count(day.cache_write);
            let cache_read_tokens = bounded_token_count(day.cache_read);
            let total_tokens = bounded_token_count(
                day.input + day.output + day.cache_write + day.cache_read,
            );
            let total_cost = day.has_cost.then_some(day.cost);
            let models = day
                .models
                .into_iter()
                .map(|(name, m)| {
                    let mt = bounded_token_count(
                        m.input + m.output + m.cache_write + m.cache_read,
                    );
                    (
                        name,
                        ModelDayUsage {
                            input_tokens: bounded_token_count(m.input),
                            output_tokens: bounded_token_count(m.output),
                            cache_creation_tokens: bounded_token_count(m.cache_write),
                            cache_read_tokens: bounded_token_count(m.cache_read),
                            total_tokens: mt,
                            total_cost: m.has_cost.then_some(m.cost),
                        },
                    )
                })
                .collect();
            DailyUsageRow {
                date,
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
                total_tokens,
                total_cost,
                cost_usd: total_cost,
                models,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 1. OpenCode scanner (SQLite opencode.db + legacy storage/message/**/*.json)
// ---------------------------------------------------------------------------

fn opencode_dirs() -> Vec<PathBuf> {
    if let Some(dirs) = parse_env_dir_list("OPENCODE_DATA_DIR") {
        return dirs;
    }
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();

    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        let p = xdg.join("opencode");
        if p.is_dir() && seen.insert(p.clone()) {
            dirs.push(p);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".local").join("share").join("opencode");
        if p.is_dir() && seen.insert(p.clone()) {
            dirs.push(p);
        }
    }
    if let Some(local_data) = dirs::data_local_dir() {
        let p = local_data.join("opencode");
        if p.is_dir() && seen.insert(p.clone()) {
            dirs.push(p);
        }
    }
    dirs
}

fn find_opencode_db(dir: &Path) -> Option<PathBuf> {
    let default_db = dir.join("opencode.db");
    if default_db.is_file() {
        return Some(default_db);
    }
    let mut candidates: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name().and_then(|n| n.to_str()).is_some_and(|name| {
                    name.starts_with("opencode-")
                        && name.ends_with(".db")
                        && name["opencode-".len()..name.len() - ".db".len()]
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                })
        })
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

fn parse_opencode_message_json(
    data: &Value,
    fallback_id: Option<&str>,
    fallback_ts: Option<DateTime<Utc>>,
) -> Option<UsageEntry> {
    let tokens_obj = data.get("tokens").and_then(Value::as_object)?;
    let input = json_u64(tokens_obj.get("input"));
    let output = json_u64(tokens_obj.get("output"));
    let reasoning = json_u64(tokens_obj.get("reasoning"));
    let total = json_u64(tokens_obj.get("total"));
    let cache = tokens_obj.get("cache").and_then(Value::as_object);
    let cache_read = cache.map(|c| json_u64(c.get("read"))).unwrap_or(0);
    let cache_write = cache.map(|c| json_u64(c.get("write"))).unwrap_or(0);
    let tokens = build_tokens(input, output, cache_write, cache_read, reasoning, total)?;

    let model = json_non_empty_str(data.get("modelID"))
        .or_else(|| {
            data.get("model").and_then(|m| {
                json_non_empty_str(m.get("modelID")).or_else(|| json_non_empty_str(m.get("id")))
            })
        })
        .unwrap_or_else(|| "unknown".to_string());

    let timestamp = parse_timestamp_value(data.get("time").and_then(|t| t.get("created")))
        .or_else(|| parse_timestamp_value(data.get("createdAt")))
        .or(fallback_ts)?;

    let dedup_id = json_non_empty_str(data.get("id"))
        .or_else(|| fallback_id.map(str::to_string));
    let carried_cost = json_positive_f64(data.get("cost"));

    Some(UsageEntry {
        dedup_id,
        timestamp,
        model,
        tokens,
        carried_cost,
    })
}

fn read_opencode_db(db_path: &Path, since: DateTime<Utc>, seen_ids: &mut HashSet<String>) -> Vec<UsageEntry> {
    let Ok(conn) = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        warn_unreadable_usage_file(db_path);
        return Vec::new();
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(500));

    let has_message_table: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='message')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_message_table {
        return Vec::new();
    }

    // Push down `time_created >= ?1` when `time_created` looks millisecond-scaled.
    let since_ms = since.timestamp_millis().saturating_sub(86_400_000);
    let sample_ms: Option<i64> = conn
        .query_row(
            "SELECT time_created FROM message WHERE time_created IS NOT NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();
    let use_pushdown = sample_ms.is_some_and(|v| v >= 100_000_000_000);

    let sql = if use_pushdown {
        "SELECT id, data FROM message WHERE time_created >= ?1"
    } else {
        "SELECT id, data FROM message"
    };

    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    let mut handle_row = |id: String, raw_data: String| {
        if let Ok(val) = serde_json::from_str::<Value>(&raw_data) {
            if let Some(entry) = parse_opencode_message_json(&val, Some(&id), None) {
                if let Some(ref eid) = entry.dedup_id {
                    seen_ids.insert(eid.clone());
                }
                entries.push(entry);
            }
        }
    };

    if use_pushdown {
        if let Ok(rows) = stmt.query_map([since_ms], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for r in rows.flatten() {
                handle_row(r.0, r.1);
            }
        }
    } else if let Ok(rows) = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        for r in rows.flatten() {
            handle_row(r.0, r.1);
        }
    }

    entries
}

pub(crate) fn scan_opencode(
    dirs: &[PathBuf],
    since: DateTime<Utc>,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut entries = Vec::new();
    let mut db_seen_ids = HashSet::new();

    for dir in dirs {
        if let Some(db_path) = find_opencode_db(dir) {
            entries.extend(read_opencode_db(&db_path, since, &mut db_seen_ids));
        }

        let messages_dir = dir.join("storage").join("message");
        let mut files = Vec::new();
        collect_files_with_extension(&messages_dir, "json", &mut files);
        if !db_seen_ids.is_empty() {
            files.retain(|f| {
                f.path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .is_none_or(|stem| !db_seen_ids.contains(stem))
            });
        }
        cap_log_files_by_mtime(&mut files, |f| f.mtime, |f| f.size);

        for file in files {
            if file_mtime_before(&file.mtime, since) {
                continue;
            }
            let Ok(bytes) = fs::read(&file.path) else {
                warn_unreadable_usage_file(&file.path);
                continue;
            };
            let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            let stem = file.path.file_stem().and_then(|s| s.to_str());
            if let Some(entry) =
                parse_opencode_message_json(&val, stem, Some(file_modified_utc(&file.path)))
            {
                entries.push(entry);
            }
        }
    }

    aggregate_entries(&entries, since, pricing)
}

// ---------------------------------------------------------------------------
// 2. Amp scanner (~/.local/share/amp/threads/**/*.json)
// ---------------------------------------------------------------------------

fn amp_dirs() -> Vec<PathBuf> {
    if let Some(dirs) = parse_env_dir_list("AMP_DATA_DIR") {
        return dirs;
    }
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".local").join("share").join("amp");
        if p.is_dir() && seen.insert(p.clone()) {
            dirs.push(p);
        }
    }
    if let Some(local_data) = dirs::data_local_dir() {
        let p = local_data.join("amp");
        if p.is_dir() && seen.insert(p.clone()) {
            dirs.push(p);
        }
    }
    dirs
}

fn parse_amp_thread_file(path: &Path) -> Vec<UsageEntry> {
    let Ok(bytes) = fs::read(path) else {
        warn_unreadable_usage_file(path);
        return Vec::new();
    };
    let Ok(root) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    let Some(thread_id) = json_non_empty_str(root.get("id")) else {
        return Vec::new();
    };

    let messages = root
        .get("messages")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    // Map assistant messageId -> (cacheCreationInputTokens, cacheReadInputTokens)
    let mut cache_by_msg_id: HashMap<i64, (u64, u64)> = HashMap::new();
    for msg in messages {
        if msg.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(msg_id) = msg.get("messageId").and_then(Value::as_i64) else {
            continue;
        };
        let Some(usage) = msg.get("usage") else {
            continue;
        };
        let cw = json_u64(usage.get("cacheCreationInputTokens"));
        let cr = json_u64(usage.get("cacheReadInputTokens"));
        if cw > 0 || cr > 0 {
            cache_by_msg_id.insert(msg_id, (cw, cr));
        }
    }

    if let Some(events) = root
        .get("usageLedger")
        .and_then(|l| l.get("events"))
        .and_then(Value::as_array)
    {
        let mut out = Vec::new();
        for event in events {
            let Some(ts) = parse_timestamp_value(event.get("timestamp")) else {
                continue;
            };
            let Some(model) = json_non_empty_str(event.get("model")) else {
                continue;
            };
            let Some(tokens_val) = event.get("tokens") else {
                continue;
            };
            let (cw, cr) = event
                .get("toMessageId")
                .and_then(Value::as_i64)
                .and_then(|id| cache_by_msg_id.get(&id).copied())
                .unwrap_or((0, 0));
            let input = json_u64(tokens_val.get("input"));
            let output = json_u64(tokens_val.get("output"));
            let total = json_u64(tokens_val.get("total"));
            let Some(tokens) = build_tokens(input, output, cw, cr, 0, total) else {
                continue;
            };
            let dedup_id = json_non_empty_str(event.get("id"))
                .map(|eid| format!("{thread_id}:{eid}"));
            out.push(UsageEntry {
                dedup_id,
                timestamp: ts,
                model,
                tokens,
                carried_cost: None,
            });
        }
        return out;
    }

    // Fallback: assistant message usage blocks
    let mut out = Vec::new();
    for msg in messages {
        if msg.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(usage) = msg.get("usage") else {
            continue;
        };
        let Some(ts) = parse_timestamp_value(usage.get("timestamp"))
            .or_else(|| parse_timestamp_value(msg.get("timestamp")))
        else {
            continue;
        };
        let model = json_non_empty_str(usage.get("model"))
            .or_else(|| json_non_empty_str(msg.get("model")))
            .unwrap_or_else(|| "unknown".to_string());
        let input = json_u64(usage.get("inputTokens"));
        let output = json_u64(usage.get("outputTokens"));
        let cw = json_u64(usage.get("cacheCreationInputTokens"));
        let cr = json_u64(usage.get("cacheReadInputTokens"));
        let total = json_u64(usage.get("totalTokens"));
        let Some(tokens) = build_tokens(input, output, cw, cr, 0, total) else {
            continue;
        };
        let dedup_id = msg
            .get("messageId")
            .and_then(Value::as_i64)
            .map(|id| format!("{thread_id}:msg:{id}"));
        out.push(UsageEntry {
            dedup_id,
            timestamp: ts,
            model,
            tokens,
            carried_cost: None,
        });
    }
    out
}

pub(crate) fn scan_amp(
    dirs: &[PathBuf],
    since: DateTime<Utc>,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut files = Vec::new();
    for dir in dirs {
        collect_files_with_extension(&dir.join("threads"), "json", &mut files);
    }
    cap_log_files_by_mtime(&mut files, |f| f.mtime, |f| f.size);

    let mut entries = Vec::new();
    for file in files {
        if file_mtime_before(&file.mtime, since) {
            continue;
        }
        entries.extend(parse_amp_thread_file(&file.path));
    }
    aggregate_entries(&entries, since, pricing)
}

// ---------------------------------------------------------------------------
// 3. Kimi scanner (~/.kimi or ~/.kimi-code sessions/**/wire.jsonl)
// ---------------------------------------------------------------------------

fn kimi_dirs() -> Vec<PathBuf> {
    if let Some(dirs) = parse_env_dir_list("KIMI_DATA_DIR") {
        return dirs;
    }
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    if let Some(home) = dirs::home_dir() {
        for name in [".kimi", ".kimi-code"] {
            let p = home.join(name);
            if p.is_dir() && seen.insert(p.clone()) {
                dirs.push(p);
            }
        }
    }
    dirs
}

fn is_kimi_wire_file(sessions_dir: &Path, file_path: &Path) -> bool {
    if file_path.file_name().and_then(|n| n.to_str()) != Some("wire.jsonl") {
        return false;
    }
    let Ok(rel) = file_path.strip_prefix(sessions_dir) else {
        return false;
    };
    let count = rel
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count();
    // Old: sessions/<group>/<session>/wire.jsonl (3)
    // New: sessions/<workspace>/<session>/agents/<agent>/wire.jsonl (5)
    matches!(count, 3 | 5)
}

fn read_kimi_config_model(kimi_root: &Path) -> String {
    let Ok(text) = fs::read_to_string(kimi_root.join("config.json")) else {
        return KIMI_DEFAULT_MODEL.to_string();
    };
    let Ok(val) = serde_json::from_str::<Value>(&text) else {
        return KIMI_DEFAULT_MODEL.to_string();
    };
    json_non_empty_str(val.get("model")).unwrap_or_else(|| KIMI_DEFAULT_MODEL.to_string())
}

fn parse_kimi_wire_file(path: &Path, default_model: &str) -> Vec<UsageEntry> {
    let Ok(file) = fs::File::open(path) else {
        warn_unreadable_usage_file(path);
        return Vec::new();
    };
    let fallback_ts = file_modified_utc(path);
    let reader = BufReader::new(file);
    let mut out = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        if !line.contains("\"token_usage\"") && !line.contains("\"usage.record\"") {
            continue;
        }
        let Ok(val) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let line_type = val.get("type").and_then(Value::as_str);

        if line_type == Some("usage.record") {
            // New Kimi Code format: only aggregate turn-level records (session records are cumulative).
            if val.get("usageScope").and_then(Value::as_str) != Some("turn") {
                continue;
            }
            let Some(usage) = val.get("usage") else {
                continue;
            };
            let input = json_u64(usage.get("inputOther"));
            let output = json_u64(usage.get("output"));
            let cw = json_u64(usage.get("inputCacheCreation"));
            let cr = json_u64(usage.get("inputCacheRead"));
            let Some(tokens) = build_tokens(input, output, cw, cr, 0, 0) else {
                continue;
            };
            let ts = parse_timestamp_value(val.get("time")).unwrap_or(fallback_ts);
            let raw_model = json_non_empty_str(val.get("model"))
                .unwrap_or_else(|| default_model.to_string());
            let model = raw_model
                .strip_prefix("kimi-code/")
                .unwrap_or(&raw_model)
                .to_string();
            out.push(UsageEntry {
                dedup_id: None,
                timestamp: ts,
                model,
                tokens,
                carried_cost: None,
            });
            continue;
        }

        if line_type == Some("metadata") {
            continue;
        }

        // Old Kimi format: message.payload.token_usage
        let Some(payload) = val.get("message").and_then(|m| m.get("payload")) else {
            continue;
        };
        let Some(usage) = payload.get("token_usage") else {
            continue;
        };
        let input = json_u64(usage.get("input_other"));
        let output = json_u64(usage.get("output"));
        let cw = json_u64(usage.get("input_cache_creation"));
        let cr = json_u64(usage.get("input_cache_read"));
        let total = json_u64(usage.get("total"));
        let Some(tokens) = build_tokens(input, output, cw, cr, 0, total) else {
            continue;
        };
        let ts = parse_timestamp_value(val.get("timestamp")).unwrap_or(fallback_ts);
        let dedup_id = json_non_empty_str(payload.get("message_id"));
        out.push(UsageEntry {
            dedup_id,
            timestamp: ts,
            model: default_model.to_string(),
            tokens,
            carried_cost: None,
        });
    }
    out
}

pub(crate) fn scan_kimi(
    dirs: &[PathBuf],
    since: DateTime<Utc>,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut files_with_model: Vec<(DiscoveredFile, String)> = Vec::new();
    for root in dirs {
        let default_model = read_kimi_config_model(root);
        let sessions_dir = root.join("sessions");
        let mut candidates = Vec::new();
        collect_files_with_extension(&sessions_dir, "jsonl", &mut candidates);
        for f in candidates {
            if is_kimi_wire_file(&sessions_dir, &f.path) {
                files_with_model.push((f, default_model.clone()));
            }
        }
    }
    cap_log_files_by_mtime(&mut files_with_model, |x| x.0.mtime, |x| x.0.size);

    let mut entries = Vec::new();
    for (file, default_model) in files_with_model {
        if file_mtime_before(&file.mtime, since) {
            continue;
        }
        entries.extend(parse_kimi_wire_file(&file.path, &default_model));
    }
    aggregate_entries(&entries, since, pricing)
}

// ---------------------------------------------------------------------------
// 4. GitHub Copilot scanner (~/.copilot/session-state/*/events.jsonl + otel/*.jsonl)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) struct CopilotSources {
    pub session_files: Vec<DiscoveredFile>,
    pub otel_files: Vec<DiscoveredFile>,
}

fn copilot_sources() -> CopilotSources {
    let root = std::env::var("COPILOT_HOME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| expand_tilde(&s))
        .or_else(|| dirs::home_dir().map(|h| h.join(".copilot")));

    let mut session_files = Vec::new();
    let mut otel_files = Vec::new();
    let mut seen_otel = HashSet::new();

    if let Some(root) = root {
        let session_state = root.join("session-state");
        if let Ok(entries) = fs::read_dir(&session_state) {
            for entry in entries.flatten() {
                if !entry.file_type().is_ok_and(|ft| ft.is_dir()) {
                    continue;
                }
                let events = entry.path().join("events.jsonl");
                if events.is_file() {
                    if let Ok(meta) = fs::metadata(&events) {
                        session_files.push(DiscoveredFile {
                            path: events,
                            size: meta.len(),
                            mtime: meta.modified().unwrap_or(UNIX_EPOCH),
                        });
                    }
                }
            }
        }

        let otel_dir = root.join("otel");
        if otel_dir.is_dir() {
            let mut found = Vec::new();
            collect_files_with_extension(&otel_dir, "jsonl", &mut found);
            for f in found {
                if seen_otel.insert(f.path.clone()) {
                    otel_files.push(f);
                }
            }
        }
    }

    if let Ok(raw) = std::env::var("COPILOT_OTEL_FILE_EXPORTER_PATH") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let p = expand_tilde(trimmed);
            if p.is_file() && seen_otel.insert(p.clone()) {
                if let Ok(meta) = fs::metadata(&p) {
                    otel_files.push(DiscoveredFile {
                        path: p,
                        size: meta.len(),
                        mtime: meta.modified().unwrap_or(UNIX_EPOCH),
                    });
                }
            }
        }
    }

    cap_log_files_by_mtime(&mut session_files, |f| f.mtime, |f| f.size);
    cap_log_files_by_mtime(&mut otel_files, |f| f.mtime, |f| f.size);
    CopilotSources {
        session_files,
        otel_files,
    }
}

struct CopilotSessionParsed {
    session_id: String,
    usage_records: Vec<UsageEntry>,
    response_ids: HashSet<String>,
    service_request_ids: HashSet<String>,
    /// Latest `session.shutdown` timestamp and entries (cumulative per model).
    latest_shutdown: Option<(DateTime<Utc>, Vec<UsageEntry>)>,
}

fn parse_copilot_session_file(path: &Path) -> CopilotSessionParsed {
    let default_session_id = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("copilot-session")
        .to_string();

    let mut parsed = CopilotSessionParsed {
        session_id: default_session_id,
        usage_records: Vec::new(),
        response_ids: HashSet::new(),
        service_request_ids: HashSet::new(),
        latest_shutdown: None,
    };

    let Ok(file) = fs::File::open(path) else {
        warn_unreadable_usage_file(path);
        return parsed;
    };
    let reader = BufReader::new(file);

    for line in reader.lines().map_while(Result::ok) {
        if !line.contains("\"session.") {
            continue;
        }
        let Ok(val) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(event_type) = val.get("type").and_then(Value::as_str) else {
            continue;
        };
        let data = val.get("data");

        match event_type {
            "session.start" => {
                if let Some(sid) = json_non_empty_str(data.and_then(|d| d.get("sessionId"))) {
                    parsed.session_id = sid;
                }
            }
            "session.usage_record" => {
                let Some(ts) = parse_timestamp_value(val.get("timestamp")) else {
                    continue;
                };
                let Some(usage) = data.and_then(|d| d.get("usage")) else {
                    continue;
                };
                let model = json_non_empty_str(usage.get("model"))
                    .unwrap_or_else(|| "unknown".to_string());
                let input = json_u64(usage.get("inputTokens"));
                let output = json_u64(usage.get("outputTokens"));
                let cr = json_u64(usage.get("cacheReadTokens"));
                let cw = json_u64(usage.get("cacheWriteTokens"));
                let reasoning = json_u64(usage.get("reasoningTokens"));
                let Some(tokens) = build_tokens(input, output, cw, cr, reasoning, 0) else {
                    continue;
                };

                if let Some(rid) = json_non_empty_str(usage.get("apiCallId")) {
                    parsed.response_ids.insert(rid);
                }
                if let Some(srid) = json_non_empty_str(usage.get("serviceRequestId")) {
                    parsed.service_request_ids.insert(srid);
                }

                let dedup_id = json_non_empty_str(
                    usage.get("accounting").and_then(|a| a.get("usageId")),
                )
                .or_else(|| json_non_empty_str(usage.get("apiCallId")))
                .or_else(|| json_non_empty_str(val.get("id")));

                parsed.usage_records.push(UsageEntry {
                    dedup_id: dedup_id.map(|id| format!("copilot:rec:{id}")),
                    timestamp: ts,
                    model,
                    tokens,
                    carried_cost: None,
                });
            }
            "session.shutdown" => {
                let Some(ts) = parse_timestamp_value(val.get("timestamp")) else {
                    continue;
                };
                let Some(metrics) = data
                    .and_then(|d| d.get("modelMetrics"))
                    .and_then(Value::as_object)
                else {
                    continue;
                };
                let mut shutdown_entries = Vec::new();
                for (model_name, metric_val) in metrics {
                    let Some(usage) = metric_val.get("usage") else {
                        continue;
                    };
                    let input = json_u64(usage.get("inputTokens"));
                    let output = json_u64(usage.get("outputTokens"));
                    let cr = json_u64(usage.get("cacheReadTokens"));
                    let cw = json_u64(usage.get("cacheWriteTokens"));
                    let reasoning = json_u64(usage.get("reasoningTokens"));
                    let Some(tokens) = build_tokens(input, output, cw, cr, reasoning, 0) else {
                        continue;
                    };
                    shutdown_entries.push(UsageEntry {
                        dedup_id: None,
                        timestamp: ts,
                        model: model_name.clone(),
                        tokens,
                        carried_cost: None,
                    });
                }
                if !shutdown_entries.is_empty() {
                    let replace = parsed
                        .latest_shutdown
                        .as_ref()
                        .is_none_or(|(prev_ts, _)| ts >= *prev_ts);
                    if replace {
                        parsed.latest_shutdown = Some((ts, shutdown_entries));
                    }
                }
            }
            _ => {}
        }
    }

    parsed
}

fn parse_copilot_otel_file(
    path: &Path,
    covered_response_ids: &HashSet<String>,
    covered_service_request_ids: &HashSet<String>,
    shutdown_cutoffs: &HashMap<String, DateTime<Utc>>,
) -> Vec<UsageEntry> {
    let Ok(file) = fs::File::open(path) else {
        warn_unreadable_usage_file(path);
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut out = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        if !line.contains("gen_ai.usage.") {
            continue;
        }
        let Ok(val) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(attrs) = val.get("attributes").and_then(Value::as_object) else {
            continue;
        };
        if attrs
            .get("gen_ai.operation.name")
            .and_then(Value::as_str)
            .is_some_and(|op| op != "chat")
        {
            continue;
        }

        // Skip spans already recorded by `session.usage_record`
        if let Some(rid) = json_non_empty_str(attrs.get("gen_ai.response.id")) {
            if covered_response_ids.contains(&rid) {
                continue;
            }
        }
        if let Some(srid) = json_non_empty_str(attrs.get("github.copilot.service_request_id")) {
            if covered_service_request_ids.contains(&srid) {
                continue;
            }
        }

        let Some(ts) = parse_timestamp_value(val.get("endTime"))
            .or_else(|| parse_timestamp_value(val.get("startTime")))
            .or_else(|| parse_timestamp_value(val.get("timestamp")))
            .or_else(|| parse_timestamp_value(val.get("time")))
            .or_else(|| parse_timestamp_value(val.get("hrTime")))
            .or_else(|| parse_timestamp_value(val.get("_hrTime")))
            .or_else(|| parse_timestamp_value(val.get("timeUnixNano")))
        else {
            continue;
        };

        // Skip spans already covered by an earlier/equal `session.shutdown` snapshot for the same session.
        if let Some(conv_id) = json_non_empty_str(attrs.get("gen_ai.conversation.id")) {
            if let Some(cutoff) = shutdown_cutoffs.get(&conv_id) {
                if ts <= *cutoff {
                    continue;
                }
            }
        }

        let model = json_non_empty_str(attrs.get("gen_ai.response.model"))
            .or_else(|| json_non_empty_str(attrs.get("gen_ai.request.model")))
            .unwrap_or_else(|| "unknown".to_string());
        let input = json_u64(attrs.get("gen_ai.usage.input_tokens"));
        let output = json_u64(attrs.get("gen_ai.usage.output_tokens"));
        let cr = json_u64(attrs.get("gen_ai.usage.cache_read.input_tokens"))
            .max(json_u64(attrs.get("gen_ai.usage.cache_read_input_tokens")));
        let cw = json_u64(attrs.get("gen_ai.usage.cache_creation.input_tokens"))
            .max(json_u64(attrs.get("gen_ai.usage.cache_creation_input_tokens")));
        let reasoning = json_u64(attrs.get("gen_ai.usage.reasoning_tokens"));
        let Some(tokens) = build_tokens(input, output, cw, cr, reasoning, 0) else {
            continue;
        };

        let dedup_id = json_non_empty_str(attrs.get("gen_ai.response.id"))
            .or_else(|| json_non_empty_str(val.get("spanId")))
            .map(|id| format!("copilot:otel:{id}"));

        out.push(UsageEntry {
            dedup_id,
            timestamp: ts,
            model,
            tokens,
            carried_cost: None,
        });
    }
    out
}

pub(crate) fn scan_copilot(
    sources: &CopilotSources,
    since: DateTime<Utc>,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut entries = Vec::new();
    let mut covered_response_ids = HashSet::new();
    let mut covered_service_request_ids = HashSet::new();
    let mut shutdown_cutoffs: HashMap<String, DateTime<Utc>> = HashMap::new();

    for file in &sources.session_files {
        if file_mtime_before(&file.mtime, since) {
            continue;
        }
        let parsed = parse_copilot_session_file(&file.path);
        covered_response_ids.extend(parsed.response_ids);
        covered_service_request_ids.extend(parsed.service_request_ids);

        if !parsed.usage_records.is_empty() {
            entries.extend(parsed.usage_records);
        } else if let Some((shutdown_ts, shutdown_entries)) = parsed.latest_shutdown {
            shutdown_cutoffs
                .entry(parsed.session_id)
                .and_modify(|prev| {
                    if shutdown_ts > *prev {
                        *prev = shutdown_ts;
                    }
                })
                .or_insert(shutdown_ts);
            entries.extend(shutdown_entries);
        }
    }

    for file in &sources.otel_files {
        if file_mtime_before(&file.mtime, since) {
            continue;
        }
        entries.extend(parse_copilot_otel_file(
            &file.path,
            &covered_response_ids,
            &covered_service_request_ids,
            &shutdown_cutoffs,
        ));
    }

    aggregate_entries(&entries, since, pricing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "crossusage-cli-scanner-{label}-{}-{n}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn maps_supported_plugin_ids_including_multi_account_instances() {
        assert_eq!(
            LocalCliProvider::from_plugin_id("opencode"),
            Some(LocalCliProvider::OpenCode)
        );
        assert_eq!(
            LocalCliProvider::from_plugin_id("opencode-go"),
            Some(LocalCliProvider::OpenCode)
        );
        assert_eq!(
            LocalCliProvider::from_plugin_id("opencode-go:work"),
            Some(LocalCliProvider::OpenCode)
        );
        assert_eq!(
            LocalCliProvider::from_plugin_id("amp"),
            Some(LocalCliProvider::Amp)
        );
        assert_eq!(
            LocalCliProvider::from_plugin_id("kimi:personal"),
            Some(LocalCliProvider::Kimi)
        );
        assert_eq!(
            LocalCliProvider::from_plugin_id("copilot"),
            Some(LocalCliProvider::Copilot)
        );
        assert_eq!(LocalCliProvider::from_plugin_id("claude"), None);
        assert_eq!(LocalCliProvider::from_plugin_id("codex"), None);
        assert_eq!(LocalCliProvider::from_plugin_id("cursor"), None);
    }

    #[test]
    fn opencode_scans_sqlite_and_legacy_json_with_id_dedup() {
        let dir = temp_dir("opencode");
        let db_path = dir.join("opencode.db");
        let now_ms = Utc::now().timestamp_millis();

        let conn = Connection::open(&db_path).expect("open sqlite");
        conn.execute(
            "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)",
            [],
        )
        .expect("create table");
        let db_msg = serde_json::json!({
            "id": "msg-1",
            "modelID": "claude-sonnet-4-20250514",
            "time": { "created": now_ms },
            "tokens": { "input": 1000, "output": 200, "reasoning": 50, "cache": { "read": 300, "write": 100 } },
            "cost": 0.05
        });
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["msg-1", "sess-1", now_ms, db_msg.to_string()],
        )
        .expect("insert");
        drop(conn);

        // Legacy storage/message/<session>/<id>.json with one duplicate (msg-1) and one new (msg-2)
        let msg_dir = dir.join("storage").join("message").join("sess-1");
        fs::create_dir_all(&msg_dir).unwrap();
        fs::write(msg_dir.join("msg-1.json"), db_msg.to_string()).unwrap();
        let legacy_msg = serde_json::json!({
            "id": "msg-2",
            "model": { "modelID": "gpt-5" },
            "time": { "created": now_ms },
            "tokens": { "input": 500, "output": 100 }
        });
        fs::write(msg_dir.join("msg-2.json"), legacy_msg.to_string()).unwrap();

        let rows = scan_opencode(&[dir.clone()], since_local_midnight(7), default_pricing());
        assert_eq!(rows.len(), 1);
        // msg-1 (1000+250+300+100 = 1650) + msg-2 (500+100 = 600) = 2250 (no duplicate!)
        assert_eq!(rows[0].total_tokens, 2250);
        assert_eq!(rows[0].input_tokens, 1500);
        assert_eq!(rows[0].output_tokens, 350);
        assert_eq!(rows[0].cache_read_tokens, 300);
        assert_eq!(rows[0].cache_creation_tokens, 100);
        assert!(rows[0].total_cost.unwrap_or(0.0) >= 0.05);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn amp_scans_usage_ledger_with_cache_join_and_message_fallback() {
        let dir = temp_dir("amp");
        let threads = dir.join("threads");
        fs::create_dir_all(&threads).unwrap();
        let now_iso = Utc::now().to_rfc3339();

        // Thread 1: usageLedger + cache tokens joined from assistant message
        let ledger_thread = serde_json::json!({
            "id": "thread-ledger",
            "messages": [
                {
                    "role": "assistant",
                    "messageId": 7,
                    "usage": {
                        "cacheCreationInputTokens": 40,
                        "cacheReadInputTokens": 60
                    }
                }
            ],
            "usageLedger": {
                "events": [
                    {
                        "id": "ev-1",
                        "timestamp": now_iso,
                        "model": "claude-sonnet-4-20250514",
                        "toMessageId": 7,
                        "tokens": { "input": 200, "output": 100 }
                    }
                ]
            }
        });
        fs::write(threads.join("t1.json"), ledger_thread.to_string()).unwrap();

        // Thread 2: legacy message usage fallback (no usageLedger)
        let fallback_thread = serde_json::json!({
            "id": "thread-fallback",
            "messages": [
                {
                    "role": "assistant",
                    "messageId": 1,
                    "model": "gpt-5",
                    "timestamp": now_iso,
                    "usage": {
                        "inputTokens": 300,
                        "outputTokens": 50
                    }
                }
            ]
        });
        fs::write(threads.join("t2.json"), fallback_thread.to_string()).unwrap();

        let rows = scan_amp(&[dir.clone()], since_local_midnight(7), default_pricing());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].input_tokens, 500);
        assert_eq!(rows[0].output_tokens, 150);
        assert_eq!(rows[0].cache_creation_tokens, 40);
        assert_eq!(rows[0].cache_read_tokens, 60);
        assert_eq!(rows[0].total_tokens, 750);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn kimi_scans_old_and_new_wire_jsonl_formats() {
        let dir = temp_dir("kimi");
        fs::write(
            dir.join("config.json"),
            r#"{"model":"kimi-k2-0905-preview"}"#,
        )
        .unwrap();

        let now_sec = Utc::now().timestamp() as f64;
        let now_ms = Utc::now().timestamp_millis();

        // Old layout: sessions/<group>/<session>/wire.jsonl
        let old_dir = dir.join("sessions").join("grp").join("sess1");
        fs::create_dir_all(&old_dir).unwrap();
        let old_line = serde_json::json!({
            "timestamp": now_sec,
            "message": {
                "payload": {
                    "message_id": "m-old-1",
                    "token_usage": {
                        "input_other": 100,
                        "output": 40,
                        "input_cache_creation": 10,
                        "input_cache_read": 20
                    }
                }
            }
        });
        fs::write(
            old_dir.join("wire.jsonl"),
            format!("{old_line}\n{old_line}\n"), // duplicate message_id should dedup
        )
        .unwrap();

        // New layout: sessions/<ws>/<session>/agents/<agent>/wire.jsonl
        let new_dir = dir
            .join("sessions")
            .join("ws")
            .join("sess2")
            .join("agents")
            .join("main");
        fs::create_dir_all(&new_dir).unwrap();
        let turn_line = serde_json::json!({
            "type": "usage.record",
            "usageScope": "turn",
            "model": "kimi-code/kimi-k2.5",
            "time": now_ms,
            "usage": {
                "inputOther": 200,
                "output": 80,
                "inputCacheCreation": 5,
                "inputCacheRead": 15
            }
        });
        let session_cumulative = serde_json::json!({
            "type": "usage.record",
            "usageScope": "session",
            "model": "kimi-code/kimi-k2.5",
            "time": now_ms,
            "usage": { "inputOther": 99999, "output": 99999 }
        });
        fs::write(
            new_dir.join("wire.jsonl"),
            format!("{turn_line}\n{session_cumulative}\n"),
        )
        .unwrap();

        let rows = scan_kimi(&[dir.clone()], since_local_midnight(7), default_pricing());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].input_tokens, 300);
        assert_eq!(rows[0].output_tokens, 120);
        assert_eq!(rows[0].cache_creation_tokens, 15);
        assert_eq!(rows[0].cache_read_tokens, 35);
        assert_eq!(rows[0].total_tokens, 470);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copilot_scans_usage_records_shutdown_fallback_and_dedups_otel() {
        let dir = temp_dir("copilot");
        let now = Utc::now();
        let now_iso = now.to_rfc3339();
        let now_sec = now.timestamp();

        // Session A: shutdown snapshots only (should take latest only)
        let sess_a = dir.join("session-state").join("session-a");
        fs::create_dir_all(&sess_a).unwrap();
        let shutdown_old = serde_json::json!({
            "type": "session.shutdown",
            "timestamp": (now - chrono::Duration::seconds(60)).to_rfc3339(),
            "data": { "modelMetrics": { "claude-sonnet-4.6": { "usage": { "inputTokens": 50, "outputTokens": 10 } } } }
        });
        let shutdown_latest = serde_json::json!({
            "type": "session.shutdown",
            "timestamp": now_iso,
            "data": { "modelMetrics": { "claude-sonnet-4.6": { "usage": { "inputTokens": 200, "outputTokens": 80, "cacheReadTokens": 20, "cacheWriteTokens": 30, "reasoningTokens": 10 } } } }
        });
        fs::write(
            sess_a.join("events.jsonl"),
            format!("{shutdown_old}\n{shutdown_latest}\n"),
        )
        .unwrap();

        // Session B: per-call usage_record with apiCallId
        let sess_b = dir.join("session-state").join("session-b");
        fs::create_dir_all(&sess_b).unwrap();
        let usage_rec = serde_json::json!({
            "type": "session.usage_record",
            "id": "rec-1",
            "timestamp": now_iso,
            "data": {
                "usage": {
                    "model": "gpt-5.4",
                    "inputTokens": 300,
                    "outputTokens": 40,
                    "apiCallId": "chatcmpl-1",
                    "accounting": { "usageId": "call-1" }
                }
            }
        });
        fs::write(sess_b.join("events.jsonl"), format!("{usage_rec}\n")).unwrap();

        // OTel file: 1 duplicate of session-b apiCallId, 1 duplicate before session-a shutdown, 1 unique span
        let otel_dir = dir.join("otel");
        fs::create_dir_all(&otel_dir).unwrap();
        let otel_dup_rec = serde_json::json!({
            "type": "span",
            "spanId": "sp-1",
            "endTime": [now_sec, 0],
            "attributes": {
                "gen_ai.operation.name": "chat",
                "gen_ai.response.model": "gpt-5.4",
                "gen_ai.response.id": "chatcmpl-1",
                "gen_ai.usage.input_tokens": 999,
                "gen_ai.usage.output_tokens": 999
            }
        });
        let otel_dup_shutdown = serde_json::json!({
            "type": "span",
            "spanId": "sp-2",
            "endTime": [now_sec - 10, 0],
            "attributes": {
                "gen_ai.operation.name": "chat",
                "gen_ai.response.model": "claude-sonnet-4.6",
                "gen_ai.conversation.id": "session-a",
                "gen_ai.usage.input_tokens": 888,
                "gen_ai.usage.output_tokens": 888
            }
        });
        let otel_unique = serde_json::json!({
            "type": "span",
            "spanId": "sp-3",
            "endTime": [now_sec + 5, 0],
            "attributes": {
                "gen_ai.operation.name": "chat",
                "gen_ai.response.model": "gpt-5.4",
                "gen_ai.conversation.id": "session-c",
                "gen_ai.usage.input_tokens": 100,
                "gen_ai.usage.output_tokens": 25
            }
        });
        fs::write(
            otel_dir.join("trace.jsonl"),
            format!("{otel_dup_rec}\n{otel_dup_shutdown}\n{otel_unique}\n"),
        )
        .unwrap();

        let sources = CopilotSources {
            session_files: vec![
                DiscoveredFile {
                    path: sess_a.join("events.jsonl"),
                    size: 100,
                    mtime: SystemTime::now(),
                },
                DiscoveredFile {
                    path: sess_b.join("events.jsonl"),
                    size: 100,
                    mtime: SystemTime::now(),
                },
            ],
            otel_files: vec![DiscoveredFile {
                path: otel_dir.join("trace.jsonl"),
                size: 100,
                mtime: SystemTime::now(),
            }],
        };

        let rows = scan_copilot(&sources, since_local_midnight(7), default_pricing());
        assert_eq!(rows.len(), 1);
        // session-a shutdown (200 in, 90 out+reasoning, 20 cr, 30 cw = 340)
        // + session-b rec (300 in, 40 out = 340)
        // + otel unique (100 in, 25 out = 125)
        // Total = 805 (duplicates excluded!)
        assert_eq!(rows[0].input_tokens, 600);
        assert_eq!(rows[0].output_tokens, 155);
        assert_eq!(rows[0].cache_read_tokens, 20);
        assert_eq!(rows[0].cache_creation_tokens, 30);
        assert_eq!(rows[0].total_tokens, 805);

        let _ = fs::remove_dir_all(&dir);
    }
}
