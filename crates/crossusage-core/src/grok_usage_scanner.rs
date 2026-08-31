//! Grok CLI session-ledger scanner (ports OpenUsage 0.7.10 GrokLogUsageScanner).
//! Coordinator `updates.jsonl` under `$GROK_HOME/sessions` or `~/.grok/sessions`.

use crate::claude_usage_scanner::parse_iso_timestamp;
use crate::log_usage_types::{
    DailyUsageRow, LogScanStatus, ModelDayUsage, TokenBreakdown, cap_log_files_by_mtime,
    expand_tilde, host_query_response, local_day_key_from_offset, since_local_midnight,
    warn_unreadable_usage_file,
};
use crate::model_pricing::{ModelPricing, default_pricing};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use time::OffsetDateTime;

/// Cap before i32 conversion. Swift uses 1e12; DailyUsageRow tokens are i32.
const MAXIMUM_PLAUSIBLE_TOKENS: i32 = 1_000_000_000;
const COST_TICKS_PER_USD: f64 = 10_000_000_000.0;

#[derive(Clone)]
struct Entry {
    event_id: Option<String>,
    timestamp: OffsetDateTime,
    model: String,
    tokens: TokenBreakdown,
    carried_cost: Option<f64>,
}

struct DiscoveredFile {
    path: PathBuf,
    size: u64,
    mtime: SystemTime,
}

pub fn query_daily_since(
    since_compact: &str,
    home_path: Option<&str>,
) -> (LogScanStatus, Vec<DailyUsageRow>) {
    let since = parse_since(since_compact);
    let rows = scan(days_back_from_since(since), home_path, default_pricing()).unwrap_or_default();
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
                    return date.with_hms(0, 0, 0).expect("midnight").assume_utc();
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

fn scan(
    days_back: i32,
    home_path: Option<&str>,
    pricing: &ModelPricing,
) -> Option<Vec<DailyUsageRow>> {
    let files = session_files(&grok_home(home_path));
    if files.is_empty() {
        return None;
    }
    let since = since_local_midnight(days_back);
    let mut entries = Vec::new();
    for file in &files {
        if !file_mtime_before(&file.mtime, since) {
            entries.extend(parse_file(&file.path));
        }
    }
    Some(aggregate(&dedup(entries), since, pricing))
}

fn grok_home(home_path: Option<&str>) -> PathBuf {
    let raw = home_path
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| std::env::var("GROK_HOME").ok());
    if let Some(raw) = raw.filter(|s| !s.trim().is_empty()) {
        return expand_tilde(raw.trim());
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".grok")
}

fn session_files(home: &Path) -> Vec<DiscoveredFile> {
    let mut files = Vec::new();
    collect_updates(&home.join("sessions"), &mut files);
    cap_log_files_by_mtime(&mut files, |f| f.mtime, |f| f.size);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

fn collect_updates(dir: &Path, out: &mut Vec<DiscoveredFile>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_updates(&path, out);
        } else if path.file_name().and_then(|n| n.to_str()) == Some("updates.jsonl")
            && is_coordinator_session(&path)
        {
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

/// Coordinator turns already include subagents. Missing summary → include; unreadable/non-object → skip.
fn is_coordinator_session(updates: &Path) -> bool {
    let Some(dir) = updates.parent() else {
        return true;
    };
    let summary = dir.join("summary.json");
    if !summary.is_file() {
        return true;
    }
    let Ok(data) = fs::read(&summary) else {
        return false;
    };
    let Ok(v) = serde_json::from_slice::<Value>(&data) else {
        return false;
    };
    let Some(obj) = v.as_object() else {
        return false;
    };
    match obj.get("session_kind").and_then(|k| k.as_str()) {
        None => true,
        Some(kind) => !kind.trim().to_ascii_lowercase().starts_with("subagent"),
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

fn parse_file(path: &Path) -> Vec<Entry> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => {
            warn_unreadable_usage_file(path);
            return vec![];
        }
    };
    let mut entries = Vec::new();
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { continue };
        if !line.contains("turn_completed") {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            entries.extend(parse_completed_turn(&v));
        }
    }
    entries
}

fn parse_completed_turn(object: &Value) -> Vec<Entry> {
    let params = object.get("params");
    let update = params
        .and_then(|p| p.get("update"))
        .or_else(|| object.get("update"));
    let Some(update) = update else { return vec![] };
    if update.get("sessionUpdate").and_then(|s| s.as_str()) != Some("turn_completed") {
        return vec![];
    }
    let Some(usage) = update.get("usage") else {
        return vec![];
    };
    let Some(model_usage) = usage.get("modelUsage").and_then(|m| m.as_object()) else {
        return vec![];
    };
    let Some(timestamp) = timestamp_in(object, params) else {
        return vec![];
    };
    let event_id = params
        .and_then(|p| p.get("_meta"))
        .or_else(|| object.get("_meta"))
        .and_then(|m| m.get("eventId"))
        .and_then(|e| e.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let top_level_ticks = json_number(usage.get("costUsdTicks"));
    let model_count = model_usage.len();
    let mut entries = Vec::new();
    for (raw_model, raw_usage) in model_usage {
        let model = raw_model.trim();
        let Some(values) = raw_usage.as_object() else {
            continue;
        };
        let Some(input_value) = json_number(values.get("inputTokens")) else {
            continue;
        };
        if model.is_empty() || input_value < 0.0 {
            continue;
        }
        let input = bounded_token_count(Some(input_value));
        let cache_read =
            bounded_token_count(json_number(values.get("cachedReadTokens"))).min(input);
        let cache_write = bounded_token_count(json_number(values.get("cacheCreationTokens")))
            .min(input.saturating_sub(cache_read));
        let output = bounded_token_count(json_number(values.get("outputTokens")));
        let ticks = json_number(values.get("costUsdTicks"))
            .or_else(|| (model_count == 1).then_some(top_level_ticks).flatten());
        entries.push(Entry {
            event_id: event_id.clone(),
            timestamp,
            model: model.to_string(),
            tokens: TokenBreakdown {
                input: input.saturating_sub(cache_read).saturating_sub(cache_write),
                cache_write5m: cache_write,
                cache_write1h: 0,
                cache_read,
                output,
                is_fast: false,
            },
            carried_cost: ticks.and_then(|t| (t >= 0.0).then_some(t / COST_TICKS_PER_USD)),
        });
    }
    entries
}

fn bounded_token_count(value: Option<f64>) -> i32 {
    match value {
        Some(n) if n > f64::from(MAXIMUM_PLAUSIBLE_TOKENS) => MAXIMUM_PLAUSIBLE_TOKENS,
        Some(n) if n > 0.0 => n as i32,
        _ => 0,
    }
}

fn json_number(v: Option<&Value>) -> Option<f64> {
    let v = v?;
    v.as_f64()
        .or_else(|| v.as_i64().map(|i| i as f64))
        .or_else(|| v.as_u64().map(|i| i as f64))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}

fn timestamp_in(object: &Value, params: Option<&Value>) -> Option<OffsetDateTime> {
    for meta in [params.and_then(|p| p.get("_meta")), object.get("_meta")] {
        if let Some(ms) =
            json_number(meta.and_then(|m| m.get("agentTimestampMs"))).filter(|n| *n > 0.0)
            && let Ok(dt) = OffsetDateTime::from_unix_timestamp_nanos((ms * 1_000_000.0) as i128)
        {
            return Some(dt);
        }
    }
    match object.get("timestamp") {
        Some(Value::Number(_)) => OffsetDateTime::from_unix_timestamp(
            json_number(object.get("timestamp")).filter(|n| *n > 0.0)? as i64,
        )
        .ok(),
        Some(Value::String(s)) => parse_iso_timestamp(s.trim()),
        _ => None,
    }
}

fn dedup(entries: Vec<Entry>) -> Vec<Entry> {
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|e| match &e.event_id {
            Some(id) => seen.insert(format!("{id}\0{}", e.model)),
            None => true,
        })
        .collect()
}

struct DayAcc {
    tokens: i32,
    cost: f64,
    input: i32,
    output: i32,
    cache_create: i32,
    cache_read: i32,
    models: BTreeMap<String, (i32, f64)>,
}

fn aggregate(
    entries: &[Entry],
    since: OffsetDateTime,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut days: BTreeMap<String, DayAcc> = BTreeMap::new();
    for entry in entries {
        if entry.timestamp < since {
            continue;
        }
        let cost = match entry.carried_cost {
            Some(c) => c,
            None => match pricing.estimated_cost_dollars(&entry.model, &entry.tokens) {
                Some(c) => c,
                None => continue,
            },
        };
        let total = entry.tokens.total_tokens();
        let acc = days
            .entry(local_day_key_from_offset(&entry.timestamp))
            .or_insert(DayAcc {
                tokens: 0,
                cost: 0.0,
                input: 0,
                output: 0,
                cache_create: 0,
                cache_read: 0,
                models: BTreeMap::new(),
            });
        acc.tokens = acc.tokens.saturating_add(total);
        acc.cost += cost;
        acc.input = acc.input.saturating_add(entry.tokens.input);
        acc.output = acc.output.saturating_add(entry.tokens.output);
        acc.cache_create = acc.cache_create.saturating_add(entry.tokens.cache_write5m);
        acc.cache_read = acc.cache_read.saturating_add(entry.tokens.cache_read);
        let m = acc.models.entry(entry.model.clone()).or_insert((0, 0.0));
        m.0 = m.0.saturating_add(total);
        m.1 += cost;
    }
    days.into_iter()
        .rev()
        .map(|(date, acc)| DailyUsageRow {
            date,
            input_tokens: acc.input,
            output_tokens: acc.output,
            cache_creation_tokens: acc.cache_create,
            cache_read_tokens: acc.cache_read,
            total_tokens: acc.tokens,
            total_cost: Some(acc.cost),
            cost_usd: Some(acc.cost),
            models: acc
                .models
                .into_iter()
                .map(|(name, (tokens, cost))| {
                    (
                        name,
                        ModelDayUsage {
                            input_tokens: 0,
                            output_tokens: tokens,
                            cache_creation_tokens: 0,
                            cache_read_tokens: 0,
                            total_tokens: tokens,
                            total_cost: Some(cost),
                        },
                    )
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(
        model: &str,
        input: f64,
        cached: f64,
        output: f64,
        ticks: f64,
        event_id: Option<&str>,
    ) -> Value {
        let mut model_vals = serde_json::json!({
            "inputTokens": input, "cachedReadTokens": cached, "cacheCreationTokens": 0,
            "outputTokens": output, "reasoningTokens": 20_000, "costUsdTicks": ticks,
        });
        if input > 1e18 {
            model_vals["cacheCreationTokens"] = serde_json::json!(input);
        }
        let mut params = serde_json::json!({
            "update": { "sessionUpdate": "turn_completed", "usage": {
                "costUsdTicks": ticks, "modelUsage": { model: model_vals },
            }},
        });
        if let Some(id) = event_id {
            params["_meta"] = serde_json::json!({ "eventId": id });
        }
        serde_json::json!({ "timestamp": "2026-06-10T10:00:00.000Z", "params": params })
    }

    #[test]
    fn parses_completed_turn_without_double_counting_reasoning() {
        let e = &parse_completed_turn(&turn(
            "grok-4.6-build",
            1_000_000.0,
            700_000.0,
            50_000.0,
            2_357_158_800.0,
            Some("turn-1"),
        ))[0];
        assert_eq!(e.tokens.input, 300_000);
        assert_eq!(e.tokens.cache_read, 700_000);
        assert_eq!(e.tokens.output, 50_000);
        assert_eq!(e.tokens.total_tokens(), 1_050_000);
        assert!((e.carried_cost.unwrap() - 0.23571588).abs() < 1e-8);
    }

    #[test]
    fn clamps_implausible_token_counts() {
        let e = &parse_completed_turn(&turn("grok-4.6-build", 1e20, 1e20, 1e20, 0.0, None))[0];
        assert_eq!(e.tokens.cache_read, MAXIMUM_PLAUSIBLE_TOKENS);
        assert_eq!(e.tokens.output, MAXIMUM_PLAUSIBLE_TOKENS);
        assert_eq!(e.tokens.input, 0);
        assert_eq!(e.tokens.cache_write5m, 0);
    }

    #[test]
    fn dedups_by_event_id_and_model() {
        let a = turn("grok-build", 1000.0, 0.0, 0.0, 0.0, Some("dup"));
        let b = turn("grok-other", 200.0, 0.0, 0.0, 0.0, Some("dup"));
        assert_eq!(
            dedup(
                parse_completed_turn(&a)
                    .into_iter()
                    .chain(parse_completed_turn(&a))
                    .collect()
            )
            .len(),
            1
        );
        assert_eq!(
            dedup(
                parse_completed_turn(&a)
                    .into_iter()
                    .chain(parse_completed_turn(&b))
                    .collect()
            )
            .len(),
            2
        );
    }

    #[test]
    fn skips_subagent_sessions_and_malformed_summaries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let sessions = tmp.path().join("sessions");
        let ts = OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        let line = format!(
            r#"{{"timestamp":"{ts}","params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"modelUsage":{{"grok-build":{{"inputTokens":100,"outputTokens":0,"costUsdTicks":1000000000}}}}}}}}}}}}"#
        );
        for (name, summary) in [
            ("coord", Some(r#"{"session_kind":"coordinator"}"#)),
            ("sub", Some(r#"{"session_kind":"subagent"}"#)),
            ("fork", Some(r#"{"session_kind":"subagent_fork"}"#)),
            ("legacy", None),
            ("bad", Some("{invalid")),
        ] {
            let dir = sessions.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("updates.jsonl"), format!("{line}\n")).unwrap();
            if let Some(s) = summary {
                fs::write(dir.join("summary.json"), s).unwrap();
            }
        }
        let rows = scan(1, Some(&tmp.path().to_string_lossy()), default_pricing()).unwrap();
        assert_eq!(
            rows[0].total_tokens, 200,
            "coord + legacy; skip subagent/fork/bad"
        );
    }
}
