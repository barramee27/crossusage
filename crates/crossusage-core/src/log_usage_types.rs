//! Shared types for native Claude/Codex log scanners (ccusage-compatible daily output).

use serde::Serialize;
use std::collections::BTreeMap;

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

pub fn local_day_key_from_offset(dt: &time::OffsetDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        dt.year(),
        u8::from(dt.month()),
        dt.day()
    )
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
