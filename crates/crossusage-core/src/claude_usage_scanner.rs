//! Native Claude Code session log scanner (ports upstream ClaudeLogUsageScanner).

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
    entries: Vec<ClaudeEntry>,
}

#[derive(Clone)]
struct ClaudeEntry {
    timestamp: OffsetDateTime,
    tokens: TokenBreakdown,
    message_id: Option<String>,
    request_id: Option<String>,
    is_sidechain: bool,
    has_speed: bool,
    cost_usd: Option<f64>,
    model: Option<String>,
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
    let pi = crate::pi_usage_scanner::query_daily_for_card("claude", since_compact);
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
    let roots = claude_roots(home_path);
    if roots.is_empty() {
        return None;
    }
    let files = usage_files(&roots);
    if files.is_empty() {
        return None;
    }
    let since = since_local_midnight(days_back);
    let mut entries = Vec::new();
    if let Ok(mut guard) = FILE_CACHE.lock() {
        let cache = guard.get_or_insert_with(HashMap::new);
        let mut next_cache = HashMap::new();
        for file in &files {
            if file_mtime_before(&file.mtime, since) {
                continue;
            }
            let key = file.path.to_string_lossy().to_string();
            let file_entries = if let Some(cached) = cache.get(&key) {
                if cached.size == file.size && cached.mtime == file.mtime {
                    cached.entries.clone()
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
                    entries: file_entries.clone(),
                },
            );
            entries.extend(file_entries);
        }
        *cache = next_cache;
    }
    Some(aggregate(&dedup(entries), since, pricing))
}

fn claude_roots(home_path: Option<&str>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    fn push_root(roots: &mut Vec<PathBuf>, seen: &mut HashSet<String>, url: PathBuf) {
        if url.join("projects").is_dir() {
            let key = url.to_string_lossy().to_string();
            if seen.insert(key) {
                roots.push(url);
            }
        }
    }

    let env_or_arg = home_path
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| std::env::var("CLAUDE_CONFIG_DIR").ok());

    if let Some(raw) = env_or_arg.filter(|s| !s.trim().is_empty()) {
        for part in raw.split(',') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            let mut url = expand_tilde(part);
            if url.file_name().is_some_and(|n| n == "projects") && url.is_dir() {
                if let Some(parent) = url.parent() {
                    url = parent.to_path_buf();
                }
            }
            push_root(&mut roots, &mut seen, url);
        }
    }

    if roots.is_empty() {
        if let Some(home) = dirs::home_dir() {
            let xdg = std::env::var("XDG_CONFIG_HOME")
                .ok()
                .filter(|s| !s.is_empty())
                .map(|s| expand_tilde(&s))
                .unwrap_or_else(|| home.join(".config"));
            push_root(&mut roots, &mut seen, xdg.join("claude"));
            push_root(&mut roots, &mut seen, home.join(".claude"));
            for sandbox in cowork_claude_dirs(&home) {
                push_root(&mut roots, &mut seen, sandbox);
            }
        }
    }

    roots
}

fn cowork_claude_dirs(home: &Path) -> Vec<PathBuf> {
    let base = home.join("Library/Application Support/Claude/local-agent-mode-sessions");
    if !base.is_dir() {
        return vec![];
    }
    let mut dirs = Vec::new();
    let Ok(groups) = fs::read_dir(&base) else {
        return vec![];
    };
    for group in groups.flatten() {
        let Ok(subs) = fs::read_dir(group.path()) else {
            continue;
        };
        for sub in subs.flatten() {
            let mut sessions: Vec<PathBuf> = fs::read_dir(sub.path())
                .ok()
                .map(|rd| rd.flatten().map(|e| e.path()).collect())
                .unwrap_or_default();
            for holder in sessions.clone() {
                if holder.file_name().is_some_and(|n| n == "agent") {
                    if let Ok(agent_children) = fs::read_dir(&holder) {
                        sessions.extend(agent_children.flatten().map(|e| e.path()));
                    }
                }
            }
            for session in sessions {
                dirs.push(session.join(".claude"));
            }
        }
    }
    dirs.sort();
    dirs
}

fn usage_files(roots: &[PathBuf]) -> Vec<DiscoveredFile> {
    let mut files = Vec::new();
    for root in roots {
        walk_jsonl(&root.join("projects"), &mut files);
    }
    cap_log_files_by_mtime(&mut files, |f| f.mtime, |f| f.size);
    // Stable path order for keep-first dedup after the newest-N / byte cap.
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

fn parse_file(path: &Path) -> Vec<ClaudeEntry> {
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
        if !line.windows(marker.len()).any(|w| w == marker) {
            continue;
        }
        if has_unsupported_null_field(line) {
            continue;
        }
        entries.extend(parse_entries(line));
    }
    entries
}

/// Parent entry from top-level usage; advisor_message iterations become extra entries.
fn parse_entries(line: &[u8]) -> Vec<ClaudeEntry> {
    let Ok(v) = serde_json::from_slice::<Value>(line) else {
        return vec![];
    };
    let Some(timestamp_raw) = v.get("timestamp").and_then(|t| t.as_str()) else {
        return vec![];
    };
    let Some(timestamp) = parse_iso_timestamp(timestamp_raw) else {
        return vec![];
    };
    let Some(message) = v.get("message") else {
        return vec![];
    };
    let Some(usage) = message.get("usage") else {
        return vec![];
    };
    let Some((tokens, has_speed)) = token_breakdown(usage) else {
        return vec![];
    };
    if !is_valid_entry(&v, message) {
        return vec![];
    }
    let model = message
        .get("model")
        .and_then(|m| m.as_str())
        .filter(|m| *m != "<synthetic>")
        .map(str::to_string);
    let message_id = message
        .get("id")
        .and_then(|id| id.as_str())
        .map(str::to_string);
    let request_id = v
        .get("requestId")
        .and_then(|id| id.as_str())
        .map(str::to_string);
    let is_sidechain = v
        .get("isSidechain")
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    let cost_usd = v.get("costUSD").and_then(|c| c.as_f64());

    let parent = ClaudeEntry {
        timestamp,
        tokens,
        message_id: message_id.clone(),
        request_id: request_id.clone(),
        is_sidechain,
        has_speed,
        cost_usd,
        model,
    };

    let Some(iterations) = usage.get("iterations").and_then(|i| i.as_array()) else {
        return vec![parent];
    };

    let mut entries = vec![parent];
    let mut advisor_index = 0usize;
    for iteration in iterations {
        if iteration.get("type").and_then(|t| t.as_str()) != Some("advisor_message") {
            continue;
        }
        let Some(advisor_model) = iteration
            .get("model")
            .and_then(|m| m.as_str())
            .filter(|m| !m.is_empty())
        else {
            continue;
        };
        let Some((advisor_tokens, advisor_has_speed)) = token_breakdown(iteration) else {
            continue;
        };
        entries.push(ClaudeEntry {
            timestamp,
            tokens: advisor_tokens,
            message_id: message_id
                .as_ref()
                .map(|id| format!("{id}:advisor:{advisor_index}")),
            request_id: request_id.clone(),
            is_sidechain,
            has_speed: advisor_has_speed,
            cost_usd: None,
            model: Some(advisor_model.to_string()),
        });
        advisor_index += 1;
    }
    entries
}

fn token_breakdown(usage: &Value) -> Option<(TokenBreakdown, bool)> {
    let input = usage.get("input_tokens")?.as_i64()? as i32;
    let output = usage.get("output_tokens")?.as_i64()? as i32;
    let speed = usage.get("speed").and_then(|s| s.as_str());
    if let Some(s) = speed {
        if s != "fast" && s != "standard" {
            return None;
        }
    }
    let (cache_write5m, cache_write1h) = if let Some(cache_creation) = usage.get("cache_creation") {
        (
            cache_creation
                .get("ephemeral_5m_input_tokens")
                .and_then(|n| n.as_i64())
                .unwrap_or(0) as i32,
            cache_creation
                .get("ephemeral_1h_input_tokens")
                .and_then(|n| n.as_i64())
                .unwrap_or(0) as i32,
        )
    } else {
        (
            usage
                .get("cache_creation_input_tokens")
                .and_then(|n| n.as_i64())
                .unwrap_or(0) as i32,
            0,
        )
    };
    Some((
        TokenBreakdown {
            input,
            cache_write5m,
            cache_write1h,
            cache_read: usage
                .get("cache_read_input_tokens")
                .and_then(|n| n.as_i64())
                .unwrap_or(0) as i32,
            output,
            is_fast: speed == Some("fast"),
        },
        speed.is_some(),
    ))
}

fn is_valid_entry(object: &Value, message: &Value) -> bool {
    if let Some(version) = object.get("version").and_then(|v| v.as_str()) {
        if !is_semver_prefix(version) {
            return false;
        }
    }
    for key in ["sessionId", "requestId"] {
        if let Some(text) = object.get(key).and_then(|v| v.as_str()) {
            if text.is_empty() {
                return false;
            }
        }
    }
    for key in ["id", "model"] {
        if let Some(text) = message.get(key).and_then(|v| v.as_str()) {
            if text.is_empty() {
                return false;
            }
        }
    }
    true
}

fn is_semver_prefix(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() >= 3
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].chars().all(|c| c.is_ascii_digit())
        && parts[2]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit())
}

fn has_unsupported_null_field(line: &[u8]) -> bool {
    const FIELDS: &[&str] = &[
        "id", "cwd", "model", "speed", "costUSD", "version", "sessionId", "requestId",
        "isApiErrorMessage", "cache_read_input_tokens", "cache_creation_input_tokens",
    ];
    let text = String::from_utf8_lossy(line);
    FIELDS.iter().any(|field| text.contains(&format!("\"{field}\":null")))
}

pub fn parse_iso_timestamp(raw: &str) -> Option<OffsetDateTime> {
    time::OffsetDateTime::parse(raw, &time::format_description::well_known::Rfc3339).ok()
}

#[derive(Hash, PartialEq, Eq)]
struct ExactKey {
    message_id: String,
    request_id: Option<String>,
}

fn dedup(entries: Vec<ClaudeEntry>) -> Vec<ClaudeEntry> {
    let mut deduped = Vec::new();
    let mut exact_index: HashMap<ExactKey, usize> = HashMap::new();
    let mut message_index: HashMap<String, Vec<usize>> = HashMap::new();

    for entry in entries {
        let Some(message_id) = entry.message_id.clone() else {
            deduped.push(entry);
            continue;
        };
        let key = ExactKey {
            message_id: message_id.clone(),
            request_id: entry.request_id.clone(),
        };
        let collision = exact_index.get(&key).copied().or_else(|| {
            message_index.get(&message_id).and_then(|indices| {
                indices.iter().copied().find(|&idx| {
                    entry.is_sidechain || deduped[idx].is_sidechain
                })
            })
        });

        if let Some(index) = collision {
            if should_replace(&entry, &deduped[index]) {
                let old = &deduped[index];
                if let Some(old_id) = &old.message_id {
                    exact_index.remove(&ExactKey {
                        message_id: old_id.clone(),
                        request_id: old.request_id.clone(),
                    });
                }
                deduped[index] = entry;
                exact_index.insert(key, index);
            }
            continue;
        }

        let index = deduped.len();
        deduped.push(entry);
        exact_index.insert(key, index);
        message_index.entry(message_id).or_default().push(index);
    }
    deduped
}

fn should_replace(candidate: &ClaudeEntry, existing: &ClaudeEntry) -> bool {
    if candidate.is_sidechain != existing.is_sidechain {
        return existing.is_sidechain;
    }
    let ct = candidate.tokens.total_tokens();
    let et = existing.tokens.total_tokens();
    if ct != et {
        return ct > et;
    }
    candidate.has_speed && !existing.has_speed
}

fn aggregate(entries: &[ClaudeEntry], since: OffsetDateTime, pricing: &ModelPricing) -> Vec<DailyUsageRow> {
    let mut tokens_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cost_by_day: BTreeMap<String, f64> = BTreeMap::new();
    let mut priced_days: HashSet<String> = HashSet::new();
    let mut models_by_day: BTreeMap<String, BTreeMap<String, (i32, f64)>> = BTreeMap::new();
    let mut input_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut output_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cache_create_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cache_read_by_day: BTreeMap<String, i32> = BTreeMap::new();

    for entry in entries {
        if entry.timestamp < since {
            continue;
        }
        let day = local_day_key_from_offset(&entry.timestamp);
        let model_name = entry
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or("unattributed");

        let cost = if let Some(carried) = entry.cost_usd {
            carried
        } else if let Some(model) = entry.model.as_deref().filter(|m| !m.trim().is_empty()) {
            match pricing.estimated_cost_dollars(model, &entry.tokens) {
                Some(c) => c,
                None => continue,
            }
        } else {
            continue;
        };

        let total = entry.tokens.total_tokens();
        *tokens_by_day.entry(day.clone()).or_default() += total;
        *cost_by_day.entry(day.clone()).or_default() += cost;
        priced_days.insert(day.clone());
        *input_by_day.entry(day.clone()).or_default() += entry.tokens.input;
        *output_by_day.entry(day.clone()).or_default() += entry.tokens.output;
        *cache_create_by_day.entry(day.clone()).or_default() +=
            entry.tokens.cache_write5m + entry.tokens.cache_write1h;
        *cache_read_by_day.entry(day.clone()).or_default() += entry.tokens.cache_read;

        let slot = models_by_day.entry(day.clone()).or_default();
        let e = slot.entry(model_name.to_string()).or_insert((0, 0.0));
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
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn parses_usage_line_and_aggregates() {
        let tmp = TempDir::new().unwrap();
        let projects = tmp.path().join("projects").join("demo");
        fs::create_dir_all(&projects).unwrap();
        let log = projects.join("sess.jsonl");
        let line = format!(
            r#"{{"timestamp":"{}","message":{{"id":"m1","model":"claude-sonnet-4-20250514","usage":{{"input_tokens":100,"output_tokens":50}}}},"requestId":"r1","version":"1.0.0"}}"#,
            OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap()
        );
        let mut f = fs::File::create(&log).unwrap();
        writeln!(f, "{line}").unwrap();

        let rows = scan(1, Some(&tmp.path().to_string_lossy()), default_pricing()).unwrap();
        assert!(!rows.is_empty());
        assert!(rows[0].total_tokens >= 150);
    }

    #[test]
    fn parse_entries_emits_advisor_iterations() {
        let line = br#"{"timestamp":"2026-07-12T10:00:00.000Z","message":{"id":"m1","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":50,"iterations":[{"type":"advisor_message","model":"claude-opus-4-20250514","input_tokens":10,"output_tokens":5},{"type":"other","model":"x","input_tokens":1,"output_tokens":1}]}},"requestId":"r1","version":"1.0.0"}"#;
        let entries = parse_entries(line);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message_id.as_deref(), Some("m1"));
        assert_eq!(entries[0].tokens.input, 100);
        assert_eq!(entries[1].message_id.as_deref(), Some("m1:advisor:0"));
        assert_eq!(entries[1].model.as_deref(), Some("claude-opus-4-20250514"));
        assert_eq!(entries[1].tokens.input, 10);
        assert_eq!(entries[1].tokens.output, 5);
        assert!(entries[1].cost_usd.is_none());
    }
}
