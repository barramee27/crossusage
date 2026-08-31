//! Reads token accounting from Antigravity local conversation SQLite DBs
//! (`~/.gemini/antigravity-cli/conversations/*.db`).
//! Discovered by FelixIsaac in openusage#1058/#1120. Simple re-scan (no WAL fingerprint cache).

use crate::antigravity_proto::{self, GenerationEvent};
use crate::log_usage_types::{
    DailyUsageRow, LogScanStatus, ModelDayUsage, TokenBreakdown, expand_tilde, host_query_response,
    local_day_key_from_offset, since_local_midnight, warn_unreadable_usage_file,
};
use crate::model_pricing::{ModelPricing, default_pricing};
use rusqlite::{Connection, OpenFlags, params};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use time::OffsetDateTime;

pub const MAXIMUM_BLOB_BYTES: i64 = 1_048_576;
const BATCH_SIZE: i64 = 8;

static WARNED_OVERSIZED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn query_daily_since(
    since_compact: &str,
    home_path: Option<&str>,
) -> (LogScanStatus, Vec<DailyUsageRow>) {
    let since = parse_since(since_compact);
    let pricing = default_pricing();
    let rows = scan(days_back_from_since(since), home_path, pricing).unwrap_or_default();
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

fn conversations_dir(home_path: Option<&str>) -> PathBuf {
    let home = match home_path {
        Some(p) => expand_tilde(p),
        None => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    };
    home.join(".gemini/antigravity-cli/conversations")
}

fn scan(
    days_back: i32,
    home_path: Option<&str>,
    pricing: &ModelPricing,
) -> Option<Vec<DailyUsageRow>> {
    let dir = conversations_dir(home_path);
    let paths = match database_files(&dir) {
        Ok(p) => p,
        Err(_) => {
            warn_unreadable_usage_file(&dir);
            return None;
        }
    };
    if paths.is_empty() {
        return None;
    }
    let since = since_local_midnight(days_back);
    let mut events = Vec::new();
    for path in &paths {
        match read_database(path) {
            Ok((db_events, oversized)) => {
                events.extend(db_events);
                if oversized {
                    warn_oversized(path);
                }
            }
            Err(_) => warn_unreadable_usage_file(path),
        }
    }
    let rows = aggregate(&events, since, pricing);
    if rows.is_empty() { None } else { Some(rows) }
}

fn database_files(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "db") && p.is_file())
        .collect();
    paths.sort();
    Ok(paths)
}

fn open_readonly(path: &Path) -> Result<Connection, rusqlite::Error> {
    match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => Ok(c),
        Err(e) => {
            let encoded = path
                .to_string_lossy()
                .replace('%', "%25")
                .replace(' ', "%20");
            let uri = format!("file:{encoded}?immutable=1");
            Connection::open_with_flags(
                &uri,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
            )
            .map_err(|_| e)
        }
    }
}

/// `CASE` skips blobs larger than 1 MiB before SQLite materializes them into the row.
fn page_sql() -> String {
    format!(
        "SELECT idx, CASE WHEN length(data) <= {MAXIMUM_BLOB_BYTES} THEN data ELSE NULL END AS data \
         FROM gen_metadata WHERE idx > ?1 AND data IS NOT NULL ORDER BY idx LIMIT {BATCH_SIZE}"
    )
}

fn read_database(path: &Path) -> Result<(Vec<GenerationEvent>, bool), rusqlite::Error> {
    let conn = open_readonly(path)?;
    let sql = page_sql();
    let mut last_index: i64 = -1;
    let mut events = Vec::new();
    let mut oversized = false;
    loop {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![last_index], |row| {
            let idx: i64 = row.get(0)?;
            let data: Option<Vec<u8>> = row.get(1)?;
            Ok((idx, data))
        })?;
        let batch: Vec<(i64, Option<Vec<u8>>)> = rows.collect::<Result<_, _>>()?;
        if batch.is_empty() {
            break;
        }
        let count = batch.len();
        let mut stalled = false;
        for (idx, data) in batch {
            if idx <= last_index {
                stalled = true;
                break;
            }
            last_index = idx;
            let Some(blob) = data else {
                oversized = true;
                continue;
            };
            if let Some(event) = antigravity_proto::generation_event(&blob) {
                events.push(event);
            }
        }
        if stalled || count < BATCH_SIZE as usize {
            break;
        }
    }
    Ok((events, oversized))
}

fn warn_oversized(path: &Path) {
    let key = path.to_string_lossy().to_string();
    let Ok(mut guard) = WARNED_OVERSIZED.lock() else {
        return;
    };
    let set = guard.get_or_insert_with(HashSet::new);
    if set.insert(key.clone()) {
        log::warn!("generation records larger than {MAXIMUM_BLOB_BYTES} bytes skipped in {key}");
    }
}

fn i32_tokens(n: i64) -> Option<i32> {
    i32::try_from(n).ok().filter(|&v| v >= 0)
}

fn aggregate(
    events: &[GenerationEvent],
    since: OffsetDateTime,
    pricing: &ModelPricing,
) -> Vec<DailyUsageRow> {
    let mut tokens_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cost_by_day: BTreeMap<String, f64> = BTreeMap::new();
    let mut models_by_day: BTreeMap<String, BTreeMap<String, (i32, f64)>> = BTreeMap::new();
    let mut input_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut output_by_day: BTreeMap<String, i32> = BTreeMap::new();
    let mut cache_read_by_day: BTreeMap<String, i32> = BTreeMap::new();

    for event in events {
        let Ok(ts) = OffsetDateTime::from_unix_timestamp(event.timestamp_seconds) else {
            continue;
        };
        if ts < since {
            continue;
        }
        let Some(input) = i32_tokens(event.input_tokens) else {
            continue;
        };
        let Some(output) = i32_tokens(event.output_tokens) else {
            continue;
        };
        let Some(cache_read) = i32_tokens(event.cache_read_tokens) else {
            continue;
        };
        let Some(total) = input
            .checked_add(cache_read)
            .and_then(|v| v.checked_add(output))
        else {
            continue;
        };
        if total <= 0 {
            continue;
        }
        let tokens = TokenBreakdown {
            input,
            cache_write5m: 0,
            cache_write1h: 0,
            cache_read,
            output,
            is_fast: false,
        };
        let Some(cost) = pricing.estimated_cost_dollars(&event.model, &tokens) else {
            continue;
        };
        let day = local_day_key_from_offset(&ts);
        *tokens_by_day.entry(day.clone()).or_default() += total;
        *cost_by_day.entry(day.clone()).or_default() += cost;
        *input_by_day.entry(day.clone()).or_default() += input;
        *output_by_day.entry(day.clone()).or_default() += output;
        *cache_read_by_day.entry(day.clone()).or_default() += cache_read;
        let slot = models_by_day.entry(day).or_default();
        let e = slot.entry(event.model.clone()).or_insert((0, 0.0));
        e.0 += total;
        e.1 += cost;
    }

    tokens_by_day
        .keys()
        .rev()
        .cloned()
        .map(|day| {
            let total_cost = cost_by_day.get(&day).copied();
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
    use crate::antigravity_proto::encode_generation_blob;
    use rusqlite::Connection;
    use tempfile::TempDir;

    fn seed_db(path: &Path, rows: &[(i64, Option<Vec<u8>>)]) {
        let conn = Connection::open(path).unwrap();
        conn.execute(
            "CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)",
            [],
        )
        .unwrap();
        for (idx, data) in rows {
            conn.execute(
                "INSERT INTO gen_metadata (idx, data) VALUES (?1, ?2)",
                params![idx, data],
            )
            .unwrap();
        }
    }

    #[test]
    fn page_sql_skips_oversized_blobs_in_sql() {
        let sql = page_sql();
        assert!(sql.contains("length(data) <= 1048576"));
        assert!(sql.contains("ELSE NULL"));
        assert!(sql.contains("LIMIT 8"));
    }

    #[test]
    fn scan_tempfile_sqlite_skips_oversized_and_unpriced() {
        let tmp = TempDir::new().unwrap();
        let conv = tmp.path().join(".gemini/antigravity-cli/conversations");
        fs::create_dir_all(&conv).unwrap();
        let db = conv.join("sess.db");
        let now = OffsetDateTime::now_utc().unix_timestamp() as u64;
        let priced = encode_generation_blob("gemini-3.6-flash", 10, 90, 40, 5, now);
        let unknown = encode_generation_blob("___unset_antigravity_model___", 1, 1, 1, 0, now);
        assert!(default_pricing().can_price("gemini-3.6-flash"));
        assert!(!default_pricing().can_price("___unset_antigravity_model___"));
        let oversized = vec![0u8; (MAXIMUM_BLOB_BYTES as usize) + 1];
        seed_db(
            &db,
            &[(1, Some(priced)), (2, Some(unknown)), (3, Some(oversized))],
        );

        let home = tmp.path().to_str().unwrap();
        let (status, rows) = query_daily_since("", Some(home));
        assert_eq!(status, LogScanStatus::Ok);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].input_tokens, 100);
        assert_eq!(rows[0].output_tokens, 40);
        assert_eq!(rows[0].cache_read_tokens, 5);
        assert_eq!(rows[0].total_tokens, 145);
        assert!(rows[0].total_cost.is_some());
        assert!(rows[0].models.contains_key("gemini-3.6-flash"));
        assert!(!rows[0].models.contains_key("___unset_antigravity_model___"));
    }

    #[test]
    fn missing_conversations_dir_is_no_data() {
        let tmp = TempDir::new().unwrap();
        let (status, rows) = query_daily_since("", Some(tmp.path().to_str().unwrap()));
        assert_eq!(status, LogScanStatus::NoData);
        assert!(rows.is_empty());
    }
}
