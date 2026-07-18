//! Native Codex CLI session log scanner (ports upstream CodexLogUsageScanner).

use crate::claude_usage_scanner;
use crate::codex_pricing::{self, CodexCostInput};
use crate::log_usage_types::{
    DailyUsageRow, LogScanStatus, ModelDayUsage, TokenBreakdown, cap_log_files_by_mtime,
    expand_tilde, host_query_response, local_day_key_from_offset, merge_daily_rows,
    since_local_midnight, warn_unreadable_usage_file,
};
use crate::model_pricing::{ModelPricing, default_pricing};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;
use time::OffsetDateTime;

static FILE_CACHE: Mutex<Option<HashMap<String, CachedFile>>> = Mutex::new(None);

struct CachedFile {
    size: u64,
    mtime: SystemTime,
    events: Vec<CodexEvent>,
}

#[derive(Clone)]
struct CodexEvent {
    timestamp: OffsetDateTime,
    model: String,
    input: i32,
    cached: i32,
    output: i32,
    reasoning: i32,
    total: i32,
    is_fast: bool,
}

struct DiscoveredFile {
    path: PathBuf,
    size: u64,
    mtime: SystemTime,
}

pub fn query_daily_since(since_compact: &str, home_path: Option<&str>) -> (LogScanStatus, Vec<DailyUsageRow>) {
    let since = parse_since(since_compact);
    let pricing = default_pricing();
    let native = scan(days_back_from_since(since), home_path, pricing).unwrap_or_default();
    let pi = crate::pi_usage_scanner::query_daily_for_card("codex", since_compact);
    let rows = merge_daily_rows(native, pi);
    if rows.is_empty() {
        (LogScanStatus::NoData, vec![])
    } else {
        (LogScanStatus::Ok, rows)
    }
}

pub fn query_daily_host_json(opts_json: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(opts_json).unwrap_or(serde_json::json!({}));
    let since = v.get("since").and_then(|s| s.as_str()).unwrap_or("");
    let home_path = v.get("homePath").and_then(|s| s.as_str());
    let (status, daily) = query_daily_since(since, home_path);
    host_query_response(status, daily)
}

fn parse_since(since: &str) -> OffsetDateTime {
    let digits: String = since.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        if let (Ok(y), Ok(m), Ok(d)) = (
            digits[0..4].parse::<i32>(),
            digits[4..6].parse::<u8>(),
            digits[6..8].parse::<u8>(),
        ) {
            if let Ok(month) = time::Month::try_from(m) {
                if let Ok(date) = time::Date::from_calendar_date(y, month, d) {
                    return date
                        .with_hms(0, 0, 0)
                        .expect("midnight")
                        .assume_utc();
                }
            }
        }
    }
    since_local_midnight(30)
}

fn days_back_from_since(since: OffsetDateTime) -> i32 {
    let now = OffsetDateTime::now_utc();
    ((now.date() - since.date()).whole_days().max(0) + 1) as i32
}

fn scan(days_back: i32, home_path: Option<&str>, pricing: &ModelPricing) -> Option<Vec<DailyUsageRow>> {
    let homes = codex_homes(home_path);
    let files = session_files(&homes);
    if files.is_empty() {
        return None;
    }
    let since = since_local_midnight(days_back);
    let mut events = Vec::new();
    if let Ok(mut guard) = FILE_CACHE.lock() {
        let cache = guard.get_or_insert_with(HashMap::new);
        let mut next_cache = HashMap::new();
        for file in &files {
            if file_mtime_before(&file.mtime, since) {
                continue;
            }
            let key = file.path.to_string_lossy().to_string();
            let file_events = if let Some(cached) = cache.get(&key) {
                if cached.size == file.size && cached.mtime == file.mtime {
                    cached.events.clone()
                } else {
                    parse_file(&file.path)
                }
            } else {
                parse_file(&file.path)
            };
            next_cache.insert(
                key,
                CachedFile {
                    size: file.size,
                    mtime: file.mtime,
                    events: file_events.clone(),
                },
            );
            events.extend(file_events);
        }
        *cache = next_cache;
    }
    Some(aggregate(&dedup_events(events), since, pricing))
}

fn codex_homes(home_path: Option<&str>) -> Vec<PathBuf> {
    let raw = home_path
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| std::env::var("CODEX_HOME").ok());
    if let Some(raw) = raw.filter(|s| !s.trim().is_empty()) {
        return raw
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(expand_tilde)
            .collect();
    }
    dirs::home_dir()
        .map(|h| vec![h.join(".codex")])
        .unwrap_or_default()
}

fn session_files(homes: &[PathBuf]) -> Vec<DiscoveredFile> {
    let mut files = Vec::new();
    let mut seen_relative: HashSet<(String, String)> = HashSet::new();
    for home in homes {
        let home_resolved = fs::canonicalize(home).unwrap_or_else(|_| home.clone());
        for sub in ["sessions", "archived_sessions"] {
            let dir = home_resolved.join(sub);
            let dir = fs::canonicalize(&dir).unwrap_or(dir);
            if !dir.is_dir() {
                continue;
            }
            let home_key = home_resolved.to_string_lossy().to_string();
            collect_session_files(&dir, &dir, &home_key, sub, &mut files, &mut seen_relative);
        }
        if !home_resolved.join("sessions").is_dir() && !home_resolved.join("archived_sessions").is_dir() {
            let home_key = home_resolved.to_string_lossy().to_string();
            collect_session_files(
                &home_resolved,
                &home_resolved,
                &home_key,
                "",
                &mut files,
                &mut seen_relative,
            );
        }
    }
    cap_log_files_by_mtime(&mut files, |f| f.mtime, |f| f.size);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

fn collect_session_files(
    root: &Path,
    dir: &Path,
    home_key: &str,
    source: &str,
    out: &mut Vec<DiscoveredFile>,
    seen: &mut HashSet<(String, String)>,
) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_session_files(root, &path, home_key, source, out, seen);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            // Dedup by home + path relative to resolved sessions root (symlink-safe).
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());
            let key = (home_key.to_string(), rel);
            if source == "archived_sessions" && seen.contains(&key) {
                continue;
            }
            if !seen.insert(key) {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                out.push(DiscoveredFile {
                    path,
                    size: meta.len(),
                    mtime: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                });
            }
        }
    }
}

fn file_mtime_before(mtime: &SystemTime, since: OffsetDateTime) -> bool {
    let Ok(duration) = mtime.duration_since(SystemTime::UNIX_EPOCH) else {
        return false;
    };
    let Ok(file_dt) = OffsetDateTime::from_unix_timestamp(duration.as_secs() as i64) else {
        return false;
    };
    file_dt < since
}

#[derive(Clone, Default)]
struct RawUsage {
    input: i32,
    cached: i32,
    output: i32,
    reasoning: i32,
    total: i32,
}

impl RawUsage {
    fn from_json(json: &serde_json::Map<String, Value>) -> Self {
        fn int(json: &serde_json::Map<String, Value>, keys: &[&str]) -> i32 {
            for key in keys {
                if let Some(n) = json.get(*key).and_then(|v| v.as_i64()) {
                    return n as i32;
                }
            }
            0
        }
        let input = int(json, &["input_tokens", "prompt_tokens", "input"]);
        let cached = int(json, &["cached_input_tokens", "cache_read_input_tokens", "cached_tokens"]);
        let output = int(json, &["output_tokens", "completion_tokens", "output"]);
        let reasoning = int(json, &["reasoning_output_tokens", "reasoning_tokens"]);
        let reported = int(json, &["total_tokens"]);
        let recomputed = input + output + reasoning;
        let total = if reported > 0 || recomputed == 0 {
            reported
        } else {
            recomputed
        };
        Self {
            input,
            cached,
            output,
            reasoning,
            total,
        }
    }

    fn equal_counts(&self, other: &RawUsage) -> bool {
        self.input == other.input
            && self.cached == other.cached
            && self.output == other.output
            && self.reasoning == other.reasoning
            && self.total == other.total
    }

    fn subtracting(&self, previous: Option<&RawUsage>) -> RawUsage {
        let p = previous.cloned().unwrap_or_default();
        RawUsage {
            input: (self.input - p.input).max(0),
            cached: (self.cached - p.cached).max(0),
            output: (self.output - p.output).max(0),
            reasoning: (self.reasoning - p.reasoning).max(0),
            total: (self.total - p.total).max(0),
        }
    }
}

/// Child-session replay gate (upstream OpenUsage 0.7.6 #1001).
#[derive(Clone, Copy)]
enum ChildReplayGate {
    UntilStartedAt(i64),
    UntilSelfTimedTaskStarted,
}

impl ChildReplayGate {
    fn is_cleared(self, started_at: f64, line_timestamp: Option<&str>) -> bool {
        match self {
            ChildReplayGate::UntilStartedAt(gate) => started_at >= gate as f64,
            ChildReplayGate::UntilSelfTimedTaskStarted => {
                let Some(raw) = line_timestamp.map(str::trim).filter(|s| !s.is_empty()) else {
                    return false;
                };
                let Some(line_dt) = claude_usage_scanner::parse_iso_timestamp(raw) else {
                    return false;
                };
                started_at >= line_dt.unix_timestamp() as f64
            }
        }
    }
}

fn has_non_null_value(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.trim().is_empty(),
        Some(_) => true,
    }
}

fn is_child_session_meta(payload: &serde_json::Map<String, Value>) -> bool {
    if has_non_null_value(payload.get("forked_from_id")) {
        return true;
    }
    if has_non_null_value(payload.get("parent_thread_id")) {
        return true;
    }
    if payload.get("thread_source").and_then(|t| t.as_str()) == Some("subagent") {
        return true;
    }
    if let Some(source) = payload.get("source").and_then(|s| s.as_object()) {
        if has_non_null_value(source.get("subagent")) {
            return true;
        }
    }
    false
}

fn service_tier_in_payload(payload: &serde_json::Map<String, Value>) -> Option<String> {
    let settings = payload.get("thread_settings").and_then(|s| s.as_object());
    for value in [
        settings.and_then(|s| s.get("service_tier")),
        payload.get("service_tier"),
    ] {
        if let Some(text) = value.and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
            return Some(text.to_string());
        }
    }
    None
}

fn parse_file(path: &Path) -> Vec<CodexEvent> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(_) => {
            warn_unreadable_usage_file(path);
            return vec![];
        }
    };
    let turn_marker = br#""type":"turn_context""#;
    let token_marker = br#""type":"token_count""#;
    let session_meta_marker = br#""type":"session_meta""#;
    let task_started_marker = br#""type":"task_started""#;
    let thread_settings_marker = br#""type":"thread_settings_applied""#;

    let mut events = Vec::new();
    let mut previous_totals: Option<RawUsage> = None;
    let mut current_model: Option<String> = None;
    let mut current_tier_is_fast = false;
    let mut saw_session_meta = false;
    let mut replay_gate: Option<ChildReplayGate> = None;

    for line in data.split(|&b| b == b'\n') {
        let is_turn = line.windows(turn_marker.len()).any(|w| w == turn_marker);
        let is_session_meta =
            !saw_session_meta && line.windows(session_meta_marker.len()).any(|w| w == session_meta_marker);
        let is_task_started =
            replay_gate.is_some() && line.windows(task_started_marker.len()).any(|w| w == task_started_marker);
        let is_thread_settings = line
            .windows(thread_settings_marker.len())
            .any(|w| w == thread_settings_marker);
        if !is_turn
            && !is_session_meta
            && !is_task_started
            && !is_thread_settings
            && !line.windows(token_marker.len()).any(|w| w == token_marker)
        {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        let Some(obj) = v.as_object() else {
            continue;
        };
        let typ = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let payload = obj.get("payload").and_then(|p| p.as_object());

        if typ == "turn_context" {
            if let Some(p) = payload {
                if let Some(model) = model_name_in_map(p) {
                    current_model = Some(model);
                }
            }
            continue;
        }
        if typ == "session_meta" && !saw_session_meta {
            saw_session_meta = true;
            if let Some(p) = payload {
                if is_child_session_meta(p) {
                    if let Some(timestamp_raw) = obj.get("timestamp").and_then(|t| t.as_str()) {
                        if let Some(created) =
                            claude_usage_scanner::parse_iso_timestamp(timestamp_raw.trim())
                        {
                            replay_gate = Some(ChildReplayGate::UntilStartedAt(created.unix_timestamp()));
                        } else {
                            replay_gate = Some(ChildReplayGate::UntilSelfTimedTaskStarted);
                        }
                    } else {
                        replay_gate = Some(ChildReplayGate::UntilSelfTimedTaskStarted);
                    }
                }
            }
            continue;
        }
        if is_thread_settings
            && typ == "event_msg"
            && payload
                .and_then(|p| p.get("type"))
                .and_then(|t| t.as_str())
                == Some("thread_settings_applied")
        {
            if let Some(p) = payload {
                if let Some(tier) = service_tier_in_payload(p) {
                    current_tier_is_fast = tier == "fast" || tier == "priority";
                }
            }
            continue;
        }
        if typ != "event_msg" {
            continue;
        }
        let Some(p) = payload else {
            continue;
        };
        let payload_type = p.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if payload_type == "task_started" {
            if let Some(gate) = replay_gate {
                if let Some(started_at) = p
                    .get("started_at")
                    .and_then(|n| n.as_f64().or_else(|| n.as_i64().map(|i| i as f64)))
                {
                    let line_ts = obj.get("timestamp").and_then(|t| t.as_str());
                    if gate.is_cleared(started_at, line_ts) {
                        replay_gate = None;
                    }
                }
            }
            continue;
        }
        if payload_type != "token_count" {
            continue;
        }
        let Some(timestamp_raw) = obj.get("timestamp").and_then(|t| t.as_str()) else {
            continue;
        };
        let Some(timestamp) = claude_usage_scanner::parse_iso_timestamp(timestamp_raw.trim()) else {
            continue;
        };
        let info = p.get("info").and_then(|i| i.as_object());
        let totals = info
            .and_then(|i| i.get("total_token_usage"))
            .and_then(|u| u.as_object())
            .map(RawUsage::from_json);

        if replay_gate.is_some() {
            if let Some(t) = totals {
                previous_totals = Some(t);
            }
            continue;
        }

        if let (Some(t), Some(prev)) = (&totals, &previous_totals) {
            if t.equal_counts(prev) {
                continue;
            }
        }

        let usage = if let Some(info) = info {
            if let Some(last) = info.get("last_token_usage").and_then(|u| u.as_object()) {
                RawUsage::from_json(last)
            } else if let Some(ref t) = totals {
                t.subtracting(previous_totals.as_ref())
            } else {
                continue;
            }
        } else {
            continue;
        };
        if let Some(ref t) = totals {
            previous_totals = Some(t.clone());
        }
        if usage.input <= 0 && usage.cached <= 0 && usage.output <= 0 && usage.reasoning <= 0 {
            continue;
        }
        let parsed_model = model_name_in_map(p).or_else(|| info.and_then(model_name_in_map));
        let model = resolve_model(parsed_model, &mut current_model);
        let cached = usage.cached.min(usage.input);
        events.push(CodexEvent {
            timestamp,
            model,
            input: usage.input,
            cached,
            output: usage.output,
            reasoning: usage.reasoning,
            total: usage.total,
            is_fast: current_tier_is_fast,
        });
    }
    events
}

fn model_name_in_map(json: &serde_json::Map<String, Value>) -> Option<String> {
    for key in ["model", "model_name"] {
        if let Some(text) = json.get(key).and_then(|v| v.as_str()) {
            let t = text.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    json.get("metadata")
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn resolve_model(parsed: Option<String>, current_model: &mut Option<String>) -> String {
    if let Some(parsed) = parsed {
        *current_model = Some(parsed.clone());
        if parsed == "codex-auto-review" {
            return "gpt-5.3-codex".to_string();
        }
        return parsed;
    }
    current_model.clone().unwrap_or_else(|| {
        let fallback = "gpt-5".to_string();
        *current_model = Some(fallback.clone());
        fallback
    })
}

fn dedup_events(events: Vec<CodexEvent>) -> Vec<CodexEvent> {
    let mut seen: HashSet<(i128, String, i32, i32, i32, i32)> = HashSet::new();
    let mut out = Vec::new();
    for e in events {
        let key = (
            e.timestamp.unix_timestamp_nanos(),
            e.model.clone(),
            e.input,
            e.cached,
            e.output,
            e.reasoning,
        );
        if seen.insert(key) {
            out.push(e);
        }
    }
    out
}

fn aggregate(events: &[CodexEvent], since: OffsetDateTime, pricing: &ModelPricing) -> Vec<DailyUsageRow> {
    let mut tokens_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cost_by_day: BTreeMap<String, f64> = BTreeMap::new();
    let mut priced_days: HashSet<String> = HashSet::new();
    let mut models_by_day: BTreeMap<String, BTreeMap<String, (i32, f64)>> = BTreeMap::new();
    let mut input_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut output_by_day: BTreeMap<String, i32> = BTreeMap::new();

    for event in events {
        if event.timestamp < since {
            continue;
        }
        let day = local_day_key_from_offset(&event.timestamp);
        let Some(cost) = codex_pricing::estimated_cost_dollars(
            pricing,
            &CodexCostInput {
                model: &event.model,
                input: event.input,
                cached: event.cached,
                output: event.output,
                reasoning: event.reasoning,
                is_fast: event.is_fast,
            },
        ) else {
            continue;
        };
        let total = if event.total > 0 {
            event.total
        } else {
            (event.input - event.cached).max(0) + event.cached + event.output + event.reasoning
        };
        *tokens_by_day.entry(day.clone()).or_default() += total;
        *cost_by_day.entry(day.clone()).or_default() += cost;
        priced_days.insert(day.clone());
        *input_by_day.entry(day.clone()).or_default() += event.input;
        *output_by_day.entry(day.clone()).or_default() += event.output + event.reasoning;
        let slot = models_by_day.entry(day.clone()).or_default();
        let e = slot.entry(event.model.clone()).or_insert((0, 0.0));
        e.0 += total;
        e.1 += cost;
    }

    tokens_by_day
        .keys()
        .rev()
        .cloned()
        .map(|day| {
            let total_cost = if priced_days.contains(&day) {
                cost_by_day.get(&day).copied()
            } else {
                None
            };
            let models: BTreeMap<String, ModelDayUsage> = models_by_day
                .get(&day)
                .map(|m| {
                    m.iter()
                        .map(|(name, (tokens, cost))| {
                            (
                                name.clone(),
                                ModelDayUsage {
                                    input_tokens: 0,
                                    output_tokens: *tokens,
                                    cache_creation_tokens: 0,
                                    cache_read_tokens: 0,
                                    total_tokens: *tokens,
                                    total_cost: Some(*cost),
                                },
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            DailyUsageRow {
                date: day.clone(),
                input_tokens: *input_by_day.get(&day).unwrap_or(&0),
                output_tokens: *output_by_day.get(&day).unwrap_or(&0),
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
                total_tokens: *tokens_by_day.get(&day).unwrap_or(&0),
                total_cost,
                cost_usd: total_cost,
                models,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn child_session_meta_null_parents_are_root() {
        let payload = json!({
            "forked_from_id": null,
            "parent_thread_id": null,
            "thread_source": "cli"
        });
        let obj = payload.as_object().unwrap();
        assert!(!is_child_session_meta(obj));
    }

    #[test]
    fn child_session_meta_detects_subagent_and_fork() {
        let fork = json!({"forked_from_id": "abc"}).as_object().cloned().unwrap();
        assert!(is_child_session_meta(&fork));
        let sub = json!({"thread_source": "subagent"}).as_object().cloned().unwrap();
        assert!(is_child_session_meta(&sub));
        let nested = json!({"source": {"subagent": "worker"}})
            .as_object()
            .cloned()
            .unwrap();
        assert!(is_child_session_meta(&nested));
    }

    #[test]
    fn equal_counts_detects_stale_snapshot() {
        let a = RawUsage {
            input: 10,
            cached: 2,
            output: 3,
            reasoning: 1,
            total: 16,
        };
        let b = a.clone();
        assert!(a.equal_counts(&b));
        let mut c = a.clone();
        c.output = 4;
        assert!(!a.equal_counts(&c));
    }

    #[test]
    fn session_files_include_sessions_and_skip_archived_dupes() {
        let root = std::env::temp_dir().join(format!(
            "crossusage-codex-sessions-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let sessions = root.join("sessions");
        let archived = root.join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();
        fs::write(sessions.join("a.jsonl"), "{}\n").unwrap();
        fs::write(archived.join("a.jsonl"), "{}\n").unwrap();
        fs::write(archived.join("b.jsonl"), "{}\n").unwrap();

        let files = session_files(&[root.clone()]);
        let names: HashSet<_> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains("a.jsonl"));
        assert!(names.contains("b.jsonl"));
        assert_eq!(files.len(), 2, "archived duplicate of sessions/a.jsonl skipped");
        let _ = fs::remove_dir_all(&root);
    }
}
