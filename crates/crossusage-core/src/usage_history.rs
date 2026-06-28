//! Local SQLite snapshots after successful probes (desktop app). CLI uses separate JSONL.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::plugin_engine::runtime::PluginOutput;
use crate::usage_metrics::{NormalizedMetrics, NormalizedMetricsMapper};

const DEBOUNCE_PER_INSTANCE: Duration = Duration::from_secs(32);
const MAX_ROWS: i64 = 12_000;

static DEBOUNCE_LAST: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

fn debounce_map() -> std::sync::MutexGuard<'static, Option<HashMap<String, Instant>>> {
    DEBOUNCE_LAST.lock().expect("usage history debounce mutex poisoned")
}

/// Returns `true` if we should record (debounce window elapsed for this instance).
fn debounce_allow(instance_id: &str) -> bool {
    let mut guard = debounce_map();
    let map = guard.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    if let Some(prev) = map.get(instance_id) {
        if now.duration_since(*prev) < DEBOUNCE_PER_INSTANCE {
            return false;
        }
    }
    map.insert(instance_id.to_string(), now);
    true
}

pub fn usage_history_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("usage_history.sqlite3")
}

fn read_settings_json(app_data_dir: &Path) -> Option<serde_json::Value> {
    let path = app_data_dir.join("settings.json");
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Reads Tauri `settings.json` in app data (same file as the desktop settings store).
pub fn persist_usage_history_enabled(app_data_dir: &Path) -> bool {
    read_settings_json(app_data_dir)
        .and_then(|v| v.get("persistUsageHistory").and_then(|x| x.as_bool()))
        .unwrap_or(false)
}

/// Days to keep history rows (`0` = no age-based prune; row cap still applies).
pub fn usage_history_retention_days(app_data_dir: &Path) -> u32 {
    read_settings_json(app_data_dir)
        .and_then(|v| v.get("usageHistoryRetentionDays").and_then(|x| x.as_u64()))
        .map(|n| n.min(3650) as u32)
        .unwrap_or(90)
}

pub fn prune_by_retention(app_data_dir: &Path) -> rusqlite::Result<()> {
    let days = usage_history_retention_days(app_data_dir);
    if days == 0 {
        return Ok(());
    }
    let path = usage_history_db_path(app_data_dir);
    if !path.exists() {
        return Ok(());
    }
    let cutoff_ms = chrono::Utc::now().timestamp_millis() - i64::from(days) * 86_400_000;
    let conn = Connection::open(&path)?;
    init_schema(&conn)?;
    conn.execute(
        "DELETE FROM usage_history WHERE captured_at_ms < ?1",
        [cutoff_ms],
    )?;
    let cutoff_day = chrono::DateTime::from_timestamp_millis(cutoff_ms)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default();
    if !cutoff_day.is_empty() {
        let _ = conn.execute(
            "DELETE FROM usage_daily WHERE day_key < ?1",
            [cutoff_day.as_str()],
        );
    }
    Ok(())
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS usage_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            instance_id TEXT NOT NULL,
            captured_at_ms INTEGER NOT NULL,
            display_name TEXT NOT NULL,
            plan TEXT,
            primary_percent REAL NOT NULL,
            input_tokens INTEGER,
            output_tokens INTEGER,
            cost REAL,
            reset_time TEXT,
            quota_summary TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_usage_hist_instance_time
            ON usage_history(instance_id, captured_at_ms DESC);
        CREATE TABLE IF NOT EXISTS usage_daily (
            instance_id TEXT NOT NULL,
            day_key TEXT NOT NULL,
            display_name TEXT NOT NULL,
            total_tokens INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            cost_usd REAL,
            source TEXT NOT NULL DEFAULT 'ccusage',
            ingested_at_ms INTEGER NOT NULL,
            PRIMARY KEY (instance_id, day_key)
        );
        CREATE INDEX IF NOT EXISTS idx_usage_daily_instance_day
            ON usage_daily(instance_id, day_key DESC);
        ",
    )?;
    let _ = conn.execute(
        "ALTER TABLE usage_daily ADD COLUMN source TEXT NOT NULL DEFAULT 'ccusage'",
        [],
    );
    Ok(())
}

/// Append one normalized row after a successful probe. Skips if debounce window not elapsed.
pub fn append_probe_snapshot(app_data_dir: &Path, output: &PluginOutput) -> rusqlite::Result<()> {
    if !persist_usage_history_enabled(app_data_dir) {
        return Ok(());
    }
    if !debounce_allow(output.provider_id.as_str()) {
        return Ok(());
    }

    let path = usage_history_db_path(app_data_dir);
    let conn = Connection::open(&path)?;
    init_schema(&conn)?;

    let m = NormalizedMetricsMapper::from_output(output);
    let now_ms: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0);

    insert_row(&conn, output, &m, now_ms)?;
    trim_old_rows(&conn)?;
    drop(conn);
    let _ = prune_by_retention(app_data_dir);
    Ok(())
}

fn insert_row(
    conn: &Connection,
    output: &PluginOutput,
    m: &NormalizedMetrics,
    captured_at_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        r"INSERT INTO usage_history (
            instance_id, captured_at_ms, display_name, plan, primary_percent,
            input_tokens, output_tokens, cost, reset_time, quota_summary
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            output.provider_id.as_str(),
            captured_at_ms,
            output.display_name.as_str(),
            output.plan.as_deref(),
            m.primary_percent,
            m.input_tokens.map(|n| n as i64),
            m.output_tokens.map(|n| n as i64),
            m.cost,
            m.reset_time.as_deref(),
            m.list_quota_summary.as_deref(),
        ],
    )?;
    Ok(())
}

fn trim_old_rows(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM usage_history", [], |r| r.get(0))?;
    if n <= MAX_ROWS {
        return Ok(());
    }
    let delete_n = n - MAX_ROWS;
    conn.execute(
        "DELETE FROM usage_history WHERE id IN (
            SELECT id FROM usage_history ORDER BY captured_at_ms ASC LIMIT ?1
        )",
        [delete_n],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistoryRow {
    pub id: i64,
    pub instance_id: String,
    pub captured_at_ms: i64,
    pub display_name: String,
    pub plan: Option<String>,
    pub primary_percent: f64,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost: Option<f64>,
    pub reset_time: Option<String>,
    pub quota_summary: Option<String>,
}

pub fn list_recent(app_data_dir: &Path, limit: u32) -> rusqlite::Result<Vec<UsageHistoryRow>> {
    let path = usage_history_db_path(app_data_dir);
    if !path.exists() {
        return Ok(vec![]);
    }
    let conn = Connection::open(&path)?;
    init_schema(&conn)?;
    let lim = i64::from(limit).max(1).min(500);
    let mut stmt = conn.prepare_cached(
        "SELECT id, instance_id, captured_at_ms, display_name, plan, primary_percent,
                input_tokens, output_tokens, cost, reset_time, quota_summary
         FROM usage_history ORDER BY captured_at_ms DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([lim], |r| {
        Ok(UsageHistoryRow {
            id: r.get(0)?,
            instance_id: r.get(1)?,
            captured_at_ms: r.get(2)?,
            display_name: r.get(3)?,
            plan: r.get(4)?,
            primary_percent: r.get(5)?,
            input_tokens: r.get(6)?,
            output_tokens: r.get(7)?,
            cost: r.get(8)?,
            reset_time: r.get(9)?,
            quota_summary: r.get(10)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInsightTightest {
    pub instance_id: String,
    pub display_name: String,
    /// Usage percent on primary line (0–100).
    pub primary_percent: f64,
    pub remaining_percent: f64,
    pub captured_at_ms: i64,
    pub reset_time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInsightsSummary {
    pub generated_at_ms: i64,
    pub retention_days: u32,
    pub tightest: Vec<HistoryInsightTightest>,
}

pub fn insights_summary(app_data_dir: &Path, limit: u32) -> rusqlite::Result<HistoryInsightsSummary> {
    let generated_at_ms = chrono::Utc::now().timestamp_millis();
    let retention_days = usage_history_retention_days(app_data_dir);
    if !persist_usage_history_enabled(app_data_dir) {
        return Ok(HistoryInsightsSummary {
            generated_at_ms,
            retention_days,
            tightest: vec![],
        });
    }
    let rows = list_recent(app_data_dir, 500)?;
    let mut latest_by_instance: std::collections::HashMap<String, UsageHistoryRow> =
        std::collections::HashMap::new();
    for row in rows {
        latest_by_instance
            .entry(row.instance_id.clone())
            .and_modify(|prev| {
                if row.captured_at_ms > prev.captured_at_ms {
                    *prev = row.clone();
                }
            })
            .or_insert(row);
    }
    let mut tightest: Vec<HistoryInsightTightest> = latest_by_instance
        .into_values()
        .map(|r| HistoryInsightTightest {
            remaining_percent: (100.0 - r.primary_percent).clamp(0.0, 100.0),
            instance_id: r.instance_id,
            display_name: r.display_name,
            primary_percent: r.primary_percent,
            captured_at_ms: r.captured_at_ms,
            reset_time: r.reset_time,
        })
        .collect();
    tightest.sort_by(|a, b| {
        a.primary_percent
            .partial_cmp(&b.primary_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
            .reverse()
    });
    tightest.truncate(limit.max(1).min(20) as usize);
    Ok(HistoryInsightsSummary {
        generated_at_ms,
        retention_days,
        tightest,
    })
}

pub fn clear_all(app_data_dir: &Path) -> rusqlite::Result<()> {
    let path = usage_history_db_path(app_data_dir);
    if !path.exists() {
        return Ok(());
    }
    let conn = Connection::open(&path)?;
    conn.execute("DELETE FROM usage_history", [])?;
    let _ = conn.execute("DELETE FROM usage_daily", []);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_engine::runtime::{MetricLine, ProgressFormat};

    fn write_settings(dir: &Path, persist: bool) {
        let json = format!(r#"{{"persistUsageHistory":{persist}}}"#);
        std::fs::write(dir.join("settings.json"), json).unwrap();
    }

    fn sample_output(id: &str) -> PluginOutput {
        PluginOutput {
            provider_id: id.into(),
            display_name: "Test".into(),
            plan: Some("pro".into()),
            icon_url: String::new(),
            lines: vec![MetricLine::Progress {
                label: "Usage".into(),
                used: 40.0,
                limit: 100.0,
                format: ProgressFormat::Percent,
                resets_at: None,
                period_duration_ms: None,
                color: None,
            }],
        }
    }

    #[test]
    fn append_list_clear_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_settings(dir.path(), true);
        let out = sample_output("cursor");
        append_probe_snapshot(dir.path(), &out).unwrap();
        let rows = list_recent(dir.path(), 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].instance_id, "cursor");

        clear_all(dir.path()).unwrap();
        let rows2 = list_recent(dir.path(), 10).unwrap();
        assert!(rows2.is_empty());
    }

    #[test]
    fn debounce_skips_second_write_immediately() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_settings(dir.path(), true);
        let out = sample_output("debounce_test_instance");
        append_probe_snapshot(dir.path(), &out).unwrap();
        append_probe_snapshot(dir.path(), &out).unwrap();
        let rows = list_recent(dir.path(), 10).unwrap();
        assert_eq!(rows.len(), 1, "second append within debounce window should skip");
    }

    fn write_settings_with_retention(dir: &Path, persist: bool, retention_days: u32) {
        let json = format!(
            r#"{{"persistUsageHistory":{persist},"usageHistoryRetentionDays":{retention_days}}}"#
        );
        std::fs::write(dir.join("settings.json"), json).unwrap();
    }

    #[test]
    fn prune_by_retention_drops_old_rows() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_settings_with_retention(dir.path(), true, 7);
        let path = usage_history_db_path(dir.path());
        let conn = Connection::open(&path).unwrap();
        init_schema(&conn).unwrap();
        let old_ms = chrono::Utc::now().timestamp_millis() - 10 * 86_400_000;
        conn.execute(
            "INSERT INTO usage_history (instance_id, captured_at_ms, display_name, primary_percent)
             VALUES ('cursor', ?1, 'Cursor', 50.0)",
            [old_ms],
        )
        .unwrap();
        prune_by_retention(dir.path()).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
