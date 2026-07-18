//! Pi coding-agent session log scanner (ports upstream PiUsageScanner).
//! Folds pi assistant usage into Claude/Codex cards via provider mapping.

use crate::claude_usage_scanner::parse_iso_timestamp;
use crate::log_usage_types::{
    DailyUsageRow, ModelDayUsage, TokenBreakdown, cap_log_files_by_mtime, expand_tilde,
    local_day_key_from_offset, since_local_midnight, warn_unreadable_usage_file,
};
use crate::model_pricing::{ModelPricing, default_pricing};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use time::OffsetDateTime;

#[derive(Clone)]
struct Entry {
    id: Option<String>,
    timestamp: OffsetDateTime,
    card_id: String,
    model: String,
    carried_cost: Option<f64>,
    tokens: TokenBreakdown,
    reported_total_tokens: i32,
}

struct DiscoveredFile {
    path: PathBuf,
    size: u64,
    mtime: SystemTime,
}

/// pi `provider` → OpenUsage card id.
fn card_id_for_pi_provider(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" | "claude-agent-sdk" => Some("claude"),
        "openai-codex" => Some("codex"),
        "cursor" => Some("cursor"),
        "zai" | "zhipu" => Some("zai"),
        "google-antigravity" => Some("antigravity"),
        "github-copilot" => Some("copilot"),
        _ => None,
    }
}

fn sessions_directory() -> PathBuf {
    if let Ok(v) = std::env::var("PI_CODING_AGENT_SESSION_DIR") {
        let t = v.trim();
        if !t.is_empty() {
            return expand_tilde(t);
        }
    }
    if let Ok(v) = std::env::var("PI_CODING_AGENT_DIR") {
        let t = v.trim();
        if !t.is_empty() {
            return expand_tilde(t).join("sessions");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pi/agent/sessions")
}

/// Daily rows for one card (`claude` / `codex`) from pi session logs since `since_compact`.
pub fn query_daily_for_card(card_id: &str, since_compact: &str) -> Vec<DailyUsageRow> {
    let since = parse_since(since_compact);
    scan(card_id, days_back_from_since(since), default_pricing()).unwrap_or_default()
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

fn scan(card_id: &str, days_back: i32, pricing: &ModelPricing) -> Option<Vec<DailyUsageRow>> {
    let files = jsonl_files(&sessions_directory());
    if files.is_empty() {
        return None;
    }
    let since = since_local_midnight(days_back);
    let mut entries = Vec::new();
    for file in &files {
        if file_mtime_before(&file.mtime, since) {
            continue;
        }
        entries.extend(parse_file(&file.path));
    }
    Some(aggregate(&dedup(entries), card_id, since, pricing))
}

fn jsonl_files(dir: &Path) -> Vec<DiscoveredFile> {
    let mut files = Vec::new();
    walk_jsonl(dir, &mut files);
    cap_log_files_by_mtime(&mut files, |f| f.mtime, |f| f.size);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

fn walk_jsonl(dir: &Path, out: &mut Vec<DiscoveredFile>) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_jsonl(&path, out);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
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

fn parse_file(path: &Path) -> Vec<Entry> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(_) => {
            warn_unreadable_usage_file(path);
            return vec![];
        }
    };
    let marker = br#""usage":{"#;
    let mut entries = Vec::new();
    for line in data.split(|&b| b == b'\n') {
        if line.windows(marker.len()).any(|w| w == marker) {
            if let Some(entry) = parse_line(line) {
                entries.push(entry);
            }
        }
    }
    entries
}

fn parse_line(line: &[u8]) -> Option<Entry> {
    let v: Value = serde_json::from_slice(line).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("message") {
        return None;
    }
    let timestamp = parse_iso_timestamp(v.get("timestamp")?.as_str()?)?;
    let message = v.get("message")?;
    if message.get("role").and_then(|r| r.as_str()) != Some("assistant") {
        return None;
    }
    let card_id = card_id_for_pi_provider(message.get("provider")?.as_str()?)?.to_string();
    let usage = message.get("usage")?;
    let cache_write = json_i32(usage.get("cacheWrite"));
    let cache_write_1h = json_i32(usage.get("cacheWrite1h"));
    Some(Entry {
        id: v.get("id").and_then(|id| id.as_str()).map(str::to_string),
        timestamp,
        card_id,
        model: message
            .get("model")
            .and_then(|m| m.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string(),
        carried_cost: usage.get("cost").and_then(|c| c.get("total")).and_then(json_f64),
        tokens: TokenBreakdown {
            input: json_i32(usage.get("input")),
            cache_write5m: (cache_write - cache_write_1h).max(0),
            cache_write1h: cache_write_1h,
            cache_read: json_i32(usage.get("cacheRead")),
            output: json_i32(usage.get("output")),
            is_fast: false,
        },
        reported_total_tokens: json_i32(usage.get("totalTokens")),
    })
}

fn json_i32(v: Option<&Value>) -> i32 {
    v.and_then(|n| n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)))
        .unwrap_or(0) as i32
}

fn json_f64(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_i64().map(|i| i as f64))
}

fn dedup(entries: Vec<Entry>) -> Vec<Entry> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        if let Some(id) = &entry.id {
            if !seen.insert(id.clone()) {
                continue;
            }
        }
        out.push(entry);
    }
    out
}

fn aggregate(
    entries: &[Entry],
    card_id: &str,
    since: OffsetDateTime,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut tokens_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cost_by_day: BTreeMap<String, f64> = BTreeMap::new();
    let mut models_by_day: BTreeMap<String, BTreeMap<String, (i32, f64)>> = BTreeMap::new();
    let mut input_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut output_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cache_create_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cache_read_by_day: BTreeMap<String, i32> = BTreeMap::new();

    for entry in entries {
        if entry.card_id != card_id || entry.timestamp < since {
            continue;
        }
        let day = local_day_key_from_offset(&entry.timestamp);
        let trimmed = entry.model.trim();
        let model_name = if trimmed.is_empty() {
            "unattributed"
        } else {
            trimmed
        };
        let cost = if let Some(carried) = entry.carried_cost.filter(|c| *c > 0.0) {
            carried
        } else if !trimmed.is_empty() {
            match pricing.estimated_cost_dollars(trimmed, &entry.tokens) {
                Some(c) => c,
                None => continue,
            }
        } else {
            continue;
        };

        let total = entry.reported_total_tokens;
        *tokens_by_day.entry(day.clone()).or_default() += total;
        *cost_by_day.entry(day.clone()).or_default() += cost;
        *input_by_day.entry(day.clone()).or_default() += entry.tokens.input;
        *output_by_day.entry(day.clone()).or_default() += entry.tokens.output;
        *cache_create_by_day.entry(day.clone()).or_default() +=
            entry.tokens.cache_write5m + entry.tokens.cache_write1h;
        *cache_read_by_day.entry(day.clone()).or_default() += entry.tokens.cache_read;
        let e = models_by_day
            .entry(day)
            .or_default()
            .entry(model_name.to_string())
            .or_insert((0, 0.0));
        e.0 += total;
        e.1 += cost;
    }

    tokens_by_day
        .keys()
        .rev()
        .cloned()
        .map(|day| {
            let total_cost = cost_by_day.get(&day).copied();
            let models = models_by_day
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
                cache_creation_tokens: *cache_create_by_day.get(&day).unwrap_or(&0),
                cache_read_tokens: *cache_read_by_day.get(&day).unwrap_or(&0),
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

    fn line(provider: &str, cache_write: i32, cache_write_1h: i32, cost: Option<f64>) -> Vec<u8> {
        let mut usage = serde_json::json!({
            "input": 100,
            "output": 50,
            "cacheRead": 0,
            "cacheWrite": cache_write,
            "cacheWrite1h": cache_write_1h,
            "totalTokens": 150,
        });
        if let Some(c) = cost {
            usage["cost"] = serde_json::json!({ "total": c });
        }
        serde_json::json!({
            "type": "message",
            "id": "m1",
            "timestamp": "2026-07-12T10:00:00.000Z",
            "message": {
                "role": "assistant",
                "provider": provider,
                "model": "claude-opus-4-8",
                "usage": usage,
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn maps_providers() {
        assert_eq!(card_id_for_pi_provider("anthropic"), Some("claude"));
        assert_eq!(card_id_for_pi_provider("claude-agent-sdk"), Some("claude"));
        assert_eq!(card_id_for_pi_provider("openai-codex"), Some("codex"));
        assert_eq!(card_id_for_pi_provider("nvidia-nim"), None);
    }

    #[test]
    fn parses_mapped_anthropic_line() {
        let entry = parse_line(&line("anthropic", 0, 0, Some(0.5))).unwrap();
        assert_eq!(entry.card_id, "claude");
        assert_eq!(entry.model, "claude-opus-4-8");
        assert_eq!(entry.carried_cost, Some(0.5));
        assert_eq!(entry.reported_total_tokens, 150);
        assert_eq!(entry.tokens.input, 100);
        assert_eq!(entry.tokens.output, 50);
    }

    #[test]
    fn splits_cache_write_buckets_by_1h() {
        let entry = parse_line(&line("anthropic", 1000, 400, Some(0.5))).unwrap();
        assert_eq!(entry.tokens.cache_write1h, 400);
        assert_eq!(entry.tokens.cache_write5m, 600);
    }

    #[test]
    fn maps_codex_and_skips_unmapped_and_non_assistant() {
        assert_eq!(
            parse_line(&line("openai-codex", 0, 0, Some(0.5)))
                .unwrap()
                .card_id,
            "codex"
        );
        assert!(parse_line(&line("nvidia-nim", 0, 0, Some(0.5))).is_none());
        let user = br#"{"type":"message","timestamp":"2026-07-12T10:00:00.000Z","message":{"role":"user","provider":"anthropic","usage":{}}}"#;
        assert!(parse_line(user).is_none());
    }
}
