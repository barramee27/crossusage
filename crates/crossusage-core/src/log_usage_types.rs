//! Shared types for native Claude/Codex log scanners (ccusage-compatible daily output).

use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

/// Newest-N file cap per scan pass (upstream #888 bound for large log trees).
pub const LOG_SCAN_MAX_FILES: usize = 500;
/// Soft byte budget for files considered in one pass (always keeps ≥1 file if any).
pub const LOG_SCAN_MAX_BYTES: u64 = 256 * 1024 * 1024;

/// Cap JSON token counts so malformed values cannot wrap `i32` (#1172).
pub fn bounded_token_count(n: i64) -> i32 {
    if n <= 0 {
        0
    } else if n > i64::from(i32::MAX) {
        i32::MAX
    } else {
        n as i32
    }
}

pub fn bounded_token_json(value: Option<&serde_json::Value>) -> i32 {
    let Some(v) = value else { return 0 };
    let n = v.as_i64().or_else(|| v.as_f64().and_then(|f| {
        if f.is_finite() { Some(f as i64) } else { None }
    }));
    bounded_token_count(n.unwrap_or(0))
}

static WARNED_UNREADABLE: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Keep the newest files by mtime, then apply a soft byte budget.
pub fn cap_log_files_by_mtime<T>(
    files: &mut Vec<T>,
    mtime: impl Fn(&T) -> SystemTime,
    size: impl Fn(&T) -> u64,
) {
    if files.is_empty() {
        return;
    }
    files.sort_by(|a, b| mtime(b).cmp(&mtime(a)).then_with(|| size(b).cmp(&size(a))));
    if files.len() > LOG_SCAN_MAX_FILES {
        files.truncate(LOG_SCAN_MAX_FILES);
    }
    let mut kept = Vec::with_capacity(files.len());
    let mut bytes = 0u64;
    for file in files.drain(..) {
        let sz = size(&file);
        if !kept.is_empty() && bytes.saturating_add(sz) > LOG_SCAN_MAX_BYTES {
            continue;
        }
        bytes = bytes.saturating_add(sz);
        kept.push(file);
    }
    *files = kept;
}

/// Log once per path per process when a usage file cannot be read (#890).
pub fn warn_unreadable_usage_file(path: &Path) {
    let key = path.to_string_lossy().to_string();
    let Ok(mut guard) = WARNED_UNREADABLE.lock() else {
        return;
    };
    let set = guard.get_or_insert_with(HashSet::new);
    if set.insert(key.clone()) {
        log::warn!(
            "Could not read local usage log file (skipping for this process): {}",
            key
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn caps_newest_files_and_byte_budget() {
        let t0 = SystemTime::UNIX_EPOCH;
        let mut files: Vec<(SystemTime, u64, u32)> = (0u32..600)
            .map(|i| (t0 + Duration::from_secs(u64::from(i)), 1024u64, i))
            .collect();
        cap_log_files_by_mtime(&mut files, |f| f.0, |f| f.1);
        assert!(files.len() <= LOG_SCAN_MAX_FILES);
        assert_eq!(files.len(), LOG_SCAN_MAX_FILES);
        // Newest ids survive.
        assert!(files.iter().any(|f| f.2 == 599));
        assert!(!files.iter().any(|f| f.2 == 0));
    }

    #[test]
    fn bounded_token_count_clamps_overflow() {
        assert_eq!(bounded_token_count(0), 0);
        assert_eq!(bounded_token_count(-3), 0);
        assert_eq!(bounded_token_count(12), 12);
        assert_eq!(bounded_token_count(i64::from(i32::MAX) + 1), i32::MAX);
        assert_eq!(bounded_token_json(Some(&serde_json::json!(3_000_000_000i64))), i32::MAX);
    }

    #[test]
    fn merge_daily_rows_sums_by_date_and_models() {
        let a = vec![DailyUsageRow {
            date: "2026-07-12".into(),
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            total_tokens: 15,
            total_cost: Some(1.0),
            cost_usd: Some(1.0),
            models: BTreeMap::from([(
                "m".into(),
                ModelDayUsage {
                    input_tokens: 0,
                    output_tokens: 15,
                    cache_creation_tokens: 0,
                    cache_read_tokens: 0,
                    total_tokens: 15,
                    total_cost: Some(1.0),
                },
            )]),
        }];
        let b = vec![DailyUsageRow {
            date: "2026-07-12".into(),
            input_tokens: 20,
            output_tokens: 10,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            total_tokens: 30,
            total_cost: Some(0.5),
            cost_usd: Some(0.5),
            models: BTreeMap::from([(
                "m".into(),
                ModelDayUsage {
                    input_tokens: 0,
                    output_tokens: 30,
                    cache_creation_tokens: 0,
                    cache_read_tokens: 0,
                    total_tokens: 30,
                    total_cost: Some(0.5),
                },
            )]),
        }];
        let merged = merge_daily_rows(a, b);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].total_tokens, 45);
        assert_eq!(merged[0].total_cost, Some(1.5));
        assert_eq!(merged[0].models["m"].total_tokens, 45);
        assert_eq!(merged[0].models["m"].total_cost, Some(1.5));
    }

    #[test]
    fn day_key_uses_offset_calendar_not_utc() {
        // 2026-08-29 03:00:00 UTC = 2026-08-28 20:00 PDT (west of UTC, evening).
        let west = time::OffsetDateTime::from_unix_timestamp(1_787_972_400).unwrap();
        assert_eq!(
            format!(
                "{:04}-{:02}-{:02}",
                west.year(),
                u8::from(west.month()),
                west.day()
            ),
            "2026-08-29"
        );
        let pacific = time::UtcOffset::from_hms(-7, 0, 0).unwrap();
        assert_eq!(day_key_at_offset(&west, pacific), "2026-08-28");
        // 2026-08-28 16:00:00 UTC = 2026-08-29 01:00 JST (east of UTC, morning).
        let east = time::OffsetDateTime::from_unix_timestamp(1_787_932_800).unwrap();
        assert_eq!(
            format!(
                "{:04}-{:02}-{:02}",
                east.year(),
                u8::from(east.month()),
                east.day()
            ),
            "2026-08-28"
        );
        let tokyo = time::UtcOffset::from_hms(9, 0, 0).unwrap();
        assert_eq!(day_key_at_offset(&east, tokyo), "2026-08-29");
        let expected = chrono::DateTime::<chrono::Utc>::from_timestamp(west.unix_timestamp(), 0)
            .unwrap()
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string();
        assert_eq!(local_day_key_from_offset(&west), expected);
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBreakdown {
    pub input: i32,
    pub cache_write5m: i32,
    pub cache_write1h: i32,
    pub cache_read: i32,
    pub output: i32,
    #[serde(rename = "isFast")]
    pub is_fast: bool,
}

impl TokenBreakdown {
    pub fn total_tokens(&self) -> i32 {
        self.input + self.cache_write5m + self.cache_write1h + self.cache_read + self.output
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDayUsage {
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub cache_creation_tokens: i32,
    pub cache_read_tokens: i32,
    pub total_tokens: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsageRow {
    pub date: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub cache_creation_tokens: i32,
    pub cache_read_tokens: i32,
    pub total_tokens: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub models: BTreeMap<String, ModelDayUsage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogScanStatus {
    Ok,
    NoData,
}

/// Calendar date in `offset` (`YYYY-MM-DD`). Unix/`Z` timestamps are UTC; plugins
/// match Today/Yesterday with local `Date` keys, so callers pass the machine offset.
fn day_key_at_offset(dt: &time::OffsetDateTime, offset: time::UtcOffset) -> String {
    let local = dt.to_offset(offset);
    format!(
        "{:04}-{:02}-{:02}",
        local.year(),
        u8::from(local.month()),
        local.day()
    )
}

pub fn local_day_key_from_offset(dt: &time::OffsetDateTime) -> String {
    let offset_secs = chrono::DateTime::<chrono::Utc>::from_timestamp(dt.unix_timestamp(), 0)
        .map(|utc| utc.with_timezone(&chrono::Local).offset().local_minus_utc())
        .unwrap_or(0);
    let offset = time::UtcOffset::from_whole_seconds(offset_secs).unwrap_or(time::UtcOffset::UTC);
    day_key_at_offset(dt, offset)
}

pub fn since_local_midnight(days_back: i32) -> time::OffsetDateTime {
    let now = time::OffsetDateTime::now_utc();
    let date = now.date() - time::Duration::days(days_back as i64);
    date.with_hms(0, 0, 0)
        .expect("midnight")
        .assume_utc()
}

pub fn expand_tilde(path: &str) -> std::path::PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    std::path::PathBuf::from(trimmed)
}

pub fn host_query_response(status: LogScanStatus, daily: Vec<DailyUsageRow>) -> String {
    let status_str = match status {
        LogScanStatus::Ok => "ok",
        LogScanStatus::NoData => "no_data",
    };
    serde_json::json!({
        "status": status_str,
        "data": { "daily": daily }
    })
    .to_string()
}

fn sum_opt_f64(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
    }
}

/// Sum token/cost fields by date and merge per-model maps (native + pi fold-in).
pub fn merge_daily_rows(a: Vec<DailyUsageRow>, b: Vec<DailyUsageRow>) -> Vec<DailyUsageRow> {
    let mut by_date: BTreeMap<String, DailyUsageRow> = BTreeMap::new();
    for row in a.into_iter().chain(b) {
        if let Some(existing) = by_date.get_mut(&row.date) {
            existing.input_tokens += row.input_tokens;
            existing.output_tokens += row.output_tokens;
            existing.cache_creation_tokens += row.cache_creation_tokens;
            existing.cache_read_tokens += row.cache_read_tokens;
            existing.total_tokens += row.total_tokens;
            existing.total_cost = sum_opt_f64(existing.total_cost, row.total_cost);
            existing.cost_usd = sum_opt_f64(existing.cost_usd, row.cost_usd);
            for (model, usage) in row.models {
                match existing.models.get_mut(&model) {
                    Some(e) => {
                        e.input_tokens += usage.input_tokens;
                        e.output_tokens += usage.output_tokens;
                        e.cache_creation_tokens += usage.cache_creation_tokens;
                        e.cache_read_tokens += usage.cache_read_tokens;
                        e.total_tokens += usage.total_tokens;
                        e.total_cost = sum_opt_f64(e.total_cost, usage.total_cost);
                    }
                    None => {
                        existing.models.insert(model, usage);
                    }
                }
            }
        } else {
            by_date.insert(row.date.clone(), row);
        }
    }
    by_date.into_values().rev().collect()
}
