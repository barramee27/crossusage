//! Daily token rows ingested from ccusage (Claude/Codex local logs). Same SQLite DB as usage history.

use std::path::Path;

use rusqlite::{params, Connection};
use serde::Deserialize;

use crate::usage_history::{init_schema, persist_usage_history_enabled, usage_history_db_path};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDailyRow {
    pub instance_id: String,
    pub day_key: String,
    pub display_name: String,
    pub total_tokens: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub source: String,
    pub ingested_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IngestPayload {
    display_name: Option<String>,
    source: Option<String>,
    daily: Vec<DailyEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyEntry {
    date: String,
    total_tokens: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cost_usd: Option<f64>,
    total_cost: Option<f64>,
}

fn normalize_day_key(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.len() >= 10 && s.as_bytes().get(4) == Some(&b'-') {
        return Some(s[..10].to_string());
    }
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        return Some(format!(
            "{}-{}-{}",
            &digits[0..4],
            &digits[4..6],
            &digits[6..8]
        ));
    }
    None
}

fn entry_cost(entry: &DailyEntry) -> Option<f64> {
    entry
        .cost_usd
        .or(entry.total_cost)
        .filter(|v| v.is_finite())
}

/// Plugins call via `host.usageDaily.ingest` after a successful ccusage query.
pub fn ingest_json(app_data_dir: &Path, instance_id: &str, payload_json: &str) -> rusqlite::Result<()> {
    if !persist_usage_history_enabled(app_data_dir) {
        return Ok(());
    }

    let payload: IngestPayload = match serde_json::from_str(payload_json) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "[plugin:{}] usageDaily.ingest invalid JSON: {}",
                instance_id,
                e
            );
            return Ok(());
        }
    };

    if payload.daily.is_empty() {
        return Ok(());
    }

    let display_name = payload
        .display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| instance_id.to_string());
    let source = payload
        .source
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "ccusage".to_string());

    let path = usage_history_db_path(app_data_dir);
    let conn = Connection::open(&path)?;
    init_schema(&conn)?;

    let now_ms: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0);

    for entry in &payload.daily {
        let Some(day_key) = normalize_day_key(&entry.date) else {
            continue;
        };
        conn.execute(
            r"INSERT INTO usage_daily (
                instance_id, day_key, display_name, total_tokens, input_tokens,
                output_tokens, cost_usd, source, ingested_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(instance_id, day_key) DO UPDATE SET
                display_name = excluded.display_name,
                total_tokens = excluded.total_tokens,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                cost_usd = excluded.cost_usd,
                source = excluded.source,
                ingested_at_ms = excluded.ingested_at_ms",
            params![
                instance_id,
                day_key,
                display_name,
                entry.total_tokens,
                entry.input_tokens,
                entry.output_tokens,
                entry_cost(entry),
                source,
                now_ms,
            ],
        )?;
    }

    Ok(())
}

pub fn list_recent(
    app_data_dir: &Path,
    limit: u32,
    instance_id: Option<&str>,
) -> rusqlite::Result<Vec<UsageDailyRow>> {
    let path = usage_history_db_path(app_data_dir);
    if !path.exists() {
        return Ok(vec![]);
    }
    let conn = Connection::open(&path)?;
    init_schema(&conn)?;
    let lim = i64::from(limit).max(1).min(500);

    let mut out = Vec::new();
    if let Some(id) = instance_id {
        let mut stmt = conn.prepare_cached(
            "SELECT instance_id, day_key, display_name, total_tokens, input_tokens,
                    output_tokens, cost_usd, source, ingested_at_ms
             FROM usage_daily WHERE instance_id = ?1
             ORDER BY day_key DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![id, lim], map_daily_row)?;
        for row in rows {
            out.push(row?);
        }
    } else {
        let mut stmt = conn.prepare_cached(
            "SELECT instance_id, day_key, display_name, total_tokens, input_tokens,
                    output_tokens, cost_usd, source, ingested_at_ms
             FROM usage_daily ORDER BY day_key DESC, instance_id ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map([lim], map_daily_row)?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

fn map_daily_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<UsageDailyRow> {
    Ok(UsageDailyRow {
        instance_id: r.get(0)?,
        day_key: r.get(1)?,
        display_name: r.get(2)?,
        total_tokens: r.get(3)?,
        input_tokens: r.get(4)?,
        output_tokens: r.get(5)?,
        cost_usd: r.get(6)?,
        source: r.get(7)?,
        ingested_at_ms: r.get(8)?,
    })
}

pub fn clear_all(app_data_dir: &Path) -> rusqlite::Result<()> {
    let path = usage_history_db_path(app_data_dir);
    if !path.exists() {
        return Ok(());
    }
    let conn = Connection::open(&path)?;
    conn.execute("DELETE FROM usage_daily", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_settings(dir: &Path, persist: bool) {
        let json = format!(r#"{{"persistUsageHistory":{persist}}}"#);
        std::fs::write(dir.join("settings.json"), json).unwrap();
    }

    #[test]
    fn ingest_skipped_when_persist_disabled() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_settings(dir.path(), false);
        let payload = r#"{"displayName":"Claude","daily":[{"date":"2026-05-01","totalTokens":100}]}"#;
        ingest_json(dir.path(), "claude", payload).unwrap();
        let rows = list_recent(dir.path(), 10, None).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn ingest_upserts_daily_rows() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_settings(dir.path(), true);
        let payload = r#"{
            "displayName":"Claude",
            "daily":[
                {"date":"2026-05-01","totalTokens":100,"inputTokens":40,"outputTokens":60,"totalCost":1.5},
                {"date":"20260502","totalTokens":200,"costUSD":2.0}
            ]
        }"#;
        ingest_json(dir.path(), "claude", payload).unwrap();
        let rows = list_recent(dir.path(), 10, None).unwrap();
        assert_eq!(rows.len(), 2);
        let may1 = rows.iter().find(|r| r.day_key == "2026-05-01").expect("may1");
        assert_eq!(may1.total_tokens, Some(100));
        assert!((may1.cost_usd.unwrap() - 1.5).abs() < f64::EPSILON);

        let payload2 = r#"{"daily":[{"date":"2026-05-01","totalTokens":150}]}"#;
        ingest_json(dir.path(), "claude", payload2).unwrap();
        let rows2 = list_recent(dir.path(), 10, Some("claude")).unwrap();
        assert_eq!(rows2.len(), 2);
        let updated = rows2.iter().find(|r| r.day_key == "2026-05-01").expect("updated");
        assert_eq!(updated.total_tokens, Some(150));
    }
}
