//! Cursor token-level usage from the dashboard CSV export (same source as cstats).

use anyhow::{bail, Context, Result};
use base64::Engine;
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const REFRESH_URL: &str = "https://api2.cursor.sh/oauth/token";
const CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const EXPORT_URL: &str = "https://cursor.com/api/dashboard/export-usage-events-csv";
const ACCESS_KEY: &str = "cursorAuth/accessToken";
const REFRESH_KEY: &str = "cursorAuth/refreshToken";
const REFRESH_BUFFER_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Default)]
pub struct RowAgg {
    pub input_no_cache: u64,
    pub input_cache_write: u64,
    pub cache_read: u64,
    pub output: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone)]
pub struct CsvUsageRow {
    /// Local calendar day `YYYY-MM-DD`.
    day_key: String,
    model: String,
    input_cache_write: u64,
    input_no_cache: u64,
    cache_read: u64,
    output_tokens: u64,
    total_tokens: u64,
    cost_usd: f64,
}

fn parse_int_cell(s: &str) -> u64 {
    let t = s.trim();
    if t.is_empty() {
        return 0;
    }
    let digits: String = t.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse().unwrap_or(0)
}

fn parse_cost_cell(s: &str) -> f64 {
    let t = s.trim().trim_start_matches('$').replace(',', "");
    t.parse().unwrap_or(0.0)
}

fn csv_date_to_yyyymmdd(raw: &str) -> Result<String> {
    let raw = raw.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        let local = dt.with_timezone(&Local);
        return Ok(format!(
            "{:04}{:02}{:02}",
            local.year(),
            local.month(),
            local.day()
        ));
    }
    if let Ok(nd) = NaiveDate::parse_from_str(
        raw.split('T').next().unwrap_or(raw),
        "%Y-%m-%d",
    ) {
        return Ok(format!(
            "{:04}{:02}{:02}",
            nd.year(),
            nd.month(),
            nd.day()
        ));
    }
    if raw.len() >= 10 && raw.as_bytes()[4] == b'-' && raw.as_bytes()[7] == b'-' {
        if let Ok(nd) = NaiveDate::parse_from_str(&raw[..10], "%Y-%m-%d") {
            return Ok(format!(
                "{:04}{:02}{:02}",
                nd.year(),
                nd.month(),
                nd.day()
            ));
        }
    }
    bail!("Unrecognized CSV date: {raw:?}")
}

fn row_in_range(date_yyyymmdd: &str, since: &str, until: &str) -> bool {
    date_yyyymmdd >= since && date_yyyymmdd <= until
}

pub fn parse_usage_csv(text: &str, since: &str, until: &str) -> Result<Vec<CsvUsageRow>> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(text.as_bytes());

    let headers = rdr.headers()?.clone();
    let required = [
        "Date",
        "Model",
        "Input (w/ Cache Write)",
        "Input (w/o Cache Write)",
        "Cache Read",
        "Output Tokens",
        "Total Tokens",
        "Cost",
    ];
    for h in required {
        if !headers.iter().any(|x| x == h) {
            bail!("Cursor CSV missing column {h:?}. Export format may have changed.");
        }
    }

    let col = |name: &str| -> Result<usize> {
        headers
            .iter()
            .position(|h| h == name)
            .with_context(|| format!("missing column {name}"))
    };
    let i_date = col("Date")?;
    let i_model = col("Model")?;

    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        let date_raw = rec.get(i_date).unwrap_or("");
        let date_yyyymmdd = csv_date_to_yyyymmdd(date_raw)?;
        if !row_in_range(&date_yyyymmdd, since, until) {
            continue;
        }
        let get = |name: &str| -> Result<&str> {
            let i = headers
                .iter()
                .position(|h| h == name)
                .with_context(|| format!("missing column {name}"))?;
            Ok(rec.get(i).unwrap_or(""))
        };
        let model = rec.get(i_model).unwrap_or("").trim().to_string();
        if model.is_empty() {
            continue;
        }
        let input_cache_write = parse_int_cell(get("Input (w/ Cache Write)")?);
        let input_no_cache = parse_int_cell(get("Input (w/o Cache Write)")?);
        let cache_read = parse_int_cell(get("Cache Read")?);
        let output_tokens = parse_int_cell(get("Output Tokens")?);
        let total_tokens = parse_int_cell(get("Total Tokens")?);
        let cost_usd = parse_cost_cell(get("Cost")?);

        let sum_tokens = input_cache_write + input_no_cache + cache_read + output_tokens;
        if input_no_cache == 0
            && output_tokens == 0
            && input_cache_write == 0
            && cache_read == 0
            && total_tokens == 0
            && cost_usd == 0.0
        {
            continue;
        }

        let day_key = format!(
            "{}-{}-{}",
            &date_yyyymmdd[0..4],
            &date_yyyymmdd[4..6],
            &date_yyyymmdd[6..8]
        );
        out.push(CsvUsageRow {
            day_key,
            model,
            input_cache_write,
            input_no_cache,
            cache_read,
            output_tokens,
            total_tokens: if total_tokens > 0 {
                total_tokens
            } else {
                sum_tokens
            },
            cost_usd,
        });
    }
    Ok(out)
}

pub fn aggregate_by_day(rows: &[CsvUsageRow]) -> HashMap<String, RowAgg> {
    let mut m: HashMap<String, RowAgg> = HashMap::new();
    for row in rows {
        let e = m.entry(row.day_key.clone()).or_default();
        e.input_no_cache += row.input_no_cache;
        e.input_cache_write += row.input_cache_write;
        e.cache_read += row.cache_read;
        e.output += row.output_tokens;
        e.total_tokens += row.total_tokens;
        e.cost_usd += row.cost_usd;
    }
    m
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBillingRow {
    pub date: String,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

/// Per-day totals from the Cursor dashboard billing CSV (includes cost USD).
pub fn query_daily_billing(
    plugin_id: &str,
    since: Option<&str>,
    until: Option<&str>,
) -> Result<Vec<DailyBillingRow>> {
    let (since, until) = if since.is_none() && until.is_none() {
        let (s, u) = month_to_date_range_local()?;
        (s, u)
    } else {
        resolve_date_range(since, until)?
    };
    let csv_text = fetch_csv_cached(plugin_id, &since, &until)?;
    let rows = parse_usage_csv(&csv_text, &since, &until)?;
    let by_day = aggregate_by_day(&rows);
    let mut out: Vec<DailyBillingRow> = by_day
        .into_iter()
        .map(|(date, agg)| DailyBillingRow {
            date,
            total_tokens: agg.total_tokens,
            input_tokens: agg.input_no_cache + agg.input_cache_write + agg.cache_read,
            output_tokens: agg.output,
            cost_usd: agg.cost_usd,
        })
        .collect();
    out.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(out)
}

pub fn query_daily_billing_host_json(opts_json: &str) -> String {
    let since = serde_json::from_str::<serde_json::Value>(opts_json)
        .ok()
        .and_then(|v| v.get("since").and_then(|s| s.as_str()).map(str::to_string));
    let until = serde_json::from_str::<serde_json::Value>(opts_json)
        .ok()
        .and_then(|v| v.get("until").and_then(|s| s.as_str()).map(str::to_string));
    let plugin_id = plugin_id_from_opts_json(opts_json);
    match query_daily_billing(&plugin_id, since.as_deref(), until.as_deref()) {
        Ok(daily) => serde_json::json!({ "status": "ok", "data": { "daily": daily } }).to_string(),
        Err(e) => serde_json::json!({
            "status": "error",
            "message": e.to_string()
        })
        .to_string(),
    }
}

pub fn aggregate_by_model(rows: &[CsvUsageRow]) -> HashMap<String, RowAgg> {
    let mut m: HashMap<String, RowAgg> = HashMap::new();
    for row in rows {
        let e = m.entry(row.model.clone()).or_default();
        e.input_no_cache += row.input_no_cache;
        e.input_cache_write += row.input_cache_write;
        e.cache_read += row.cache_read;
        e.output += row.output_tokens;
        e.total_tokens += row.total_tokens;
        e.cost_usd += row.cost_usd;
    }
    m
}

fn infer_provider(model: &str) -> String {
    let s = model.to_lowercase();
    if s.contains("claude") {
        return "anthropic".into();
    }
    if s.contains("gemini") || s.contains("google") {
        return "google".into();
    }
    if s.contains("gpt") || s.contains("openai") {
        return "openai".into();
    }
    if s.contains("composer") || s.contains("cursor") || s.contains("kimi") {
        return "cursor".into();
    }
    if s.contains("deepseek") {
        return "deepseek".into();
    }
    "other".into()
}

pub fn aggregate_by_provider(rows: &[CsvUsageRow]) -> HashMap<String, RowAgg> {
    let mut m: HashMap<String, RowAgg> = HashMap::new();
    for row in rows {
        let p = infer_provider(&row.model);
        let e = m.entry(p).or_default();
        e.input_no_cache += row.input_no_cache;
        e.input_cache_write += row.input_cache_write;
        e.cache_read += row.cache_read;
        e.output += row.output_tokens;
        e.total_tokens += row.total_tokens;
        e.cost_usd += row.cost_usd;
    }
    m
}

fn fmt_num(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out.chars().rev().collect()
}

/// Comma-separated token counts (used by `list` and `usage-stats`).
pub fn format_token_count(n: u64) -> String {
    fmt_num(n)
}

fn sum_csv_rows(rows: &[CsvUsageRow]) -> RowAgg {
    let mut a = RowAgg::default();
    for r in rows {
        a.input_no_cache += r.input_no_cache;
        a.input_cache_write += r.input_cache_write;
        a.cache_read += r.cache_read;
        a.output += r.output_tokens;
        a.total_tokens += r.total_tokens;
        a.cost_usd += r.cost_usd;
    }
    a
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorMtdTotals {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub since: String,
    pub until: String,
}

static MTD_CACHE: Mutex<Option<(String, Instant, CursorMtdTotals)>> = Mutex::new(None);
static CSV_RANGE_CACHE: Mutex<Option<(String, Instant, String)>> = Mutex::new(None);
const MTD_CACHE_TTL: Duration = Duration::from_secs(45 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatsRowJson {
    pub key: String,
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_hit: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatsPayload {
    pub since: String,
    pub until: String,
    pub group: String,
    pub rows: Vec<UsageStatsRowJson>,
    pub totals: UsageStatsRowJson,
}

fn fetch_cursor_month_to_date_totals_uncached(plugin_id: &str) -> Option<CursorMtdTotals> {
    if resolve_state_db_for_plugin(plugin_id).is_none() {
        return None;
    }
    let (since, until) = month_to_date_range_local().ok()?;
    let (start_ms, end_ms) = to_epoch_range_ms(&since, &until).ok()?;
    let csv_text = download_cursor_usage_csv_for_plugin(plugin_id, start_ms, end_ms).ok()?;
    let rows = parse_usage_csv(&csv_text, &since, &until).ok()?;
    let agg = sum_csv_rows(&rows);
    Some(CursorMtdTotals {
        total_tokens: agg.total_tokens,
        input_tokens: agg.input_no_cache,
        output_tokens: agg.output,
        cost_usd: agg.cost_usd,
        since,
        until,
    })
}

/// Month-to-date totals from Cursor's dashboard CSV (cached ~45m per month).
pub fn fetch_cursor_month_to_date_totals_for_plugin(plugin_id: &str) -> Option<CursorMtdTotals> {
    let (since, until) = month_to_date_range_local().ok()?;
    let cache_key = format!("{plugin_id}:{since}-{until}");
    if let Ok(guard) = MTD_CACHE.lock() {
        if let Some((key, at, totals)) = guard.as_ref() {
            if key == &cache_key && at.elapsed() < MTD_CACHE_TTL {
                return Some(totals.clone());
            }
        }
    }
    let totals = fetch_cursor_month_to_date_totals_uncached(plugin_id)?;
    if let Ok(mut guard) = MTD_CACHE.lock() {
        *guard = Some((cache_key, Instant::now(), totals.clone()));
    }
    Some(totals)
}

/// JSON for plugin host API (`cursorUsageExport.queryMtd`).
pub fn query_mtd_host_json(opts_json: &str) -> String {
    let plugin_id = plugin_id_from_opts_json(opts_json);
    match fetch_cursor_month_to_date_totals_for_plugin(&plugin_id) {
        Some(data) => serde_json::json!({ "status": "ok", "data": data }).to_string(),
        None => serde_json::json!({
            "status": "error",
            "message": "Cursor MTD export unavailable (sign in via Cursor or try again later)"
        })
        .to_string(),
    }
}

pub fn month_to_date_range_local() -> Result<(String, String)> {
    let now = Local::now().date_naive();
    let first = NaiveDate::from_ymd_opt(now.year(), now.month(), 1).context("invalid month start")?;
    let since = first.format("%Y%m%d").to_string();
    let until = now.format("%Y%m%d").to_string();
    Ok((since, until))
}

pub fn resolve_date_range(since: Option<&str>, until: Option<&str>) -> Result<(String, String)> {
    let default_until = Local::now().date_naive();
    let default_since = default_until - chrono::Duration::days(30);
    let def_since = default_since.format("%Y%m%d").to_string();
    let def_until = default_until.format("%Y%m%d").to_string();

    let since = since.map(|s| s.to_string()).unwrap_or(def_since);
    let until = until.map(|s| s.to_string()).unwrap_or(def_until);
    validate_yyyymmdd(&since)?;
    validate_yyyymmdd(&until)?;
    if since > until {
        bail!("--since must be on or before --until");
    }
    Ok((since, until))
}

fn validate_yyyymmdd(s: &str) -> Result<()> {
    if s.len() != 8 || !s.chars().all(|c| c.is_ascii_digit()) {
        bail!("Invalid date {s:?}: expected YYYYMMDD");
    }
    let y: i32 = s[0..4].parse()?;
    let m: u32 = s[4..6].parse()?;
    let d: u32 = s[6..8].parse()?;
    NaiveDate::from_ymd_opt(y, m, d).with_context(|| format!("invalid calendar date {s}"))?;
    Ok(())
}

pub fn to_epoch_range_ms(since: &str, until: &str) -> Result<(i64, i64)> {
    let y1: i32 = since[0..4].parse()?;
    let m1: u32 = since[4..6].parse()?;
    let d1: u32 = since[6..8].parse()?;
    let y2: i32 = until[0..4].parse()?;
    let m2: u32 = until[4..6].parse()?;
    let d2: u32 = until[6..8].parse()?;
    let nd1 = NaiveDate::from_ymd_opt(y1, m1, d1).unwrap();
    let nd2 = NaiveDate::from_ymd_opt(y2, m2, d2).unwrap();
    let start = Local
        .from_local_datetime(&nd1.and_hms_opt(0, 0, 0).unwrap())
        .unwrap()
        .timestamp_millis();
    let end = Local
        .from_local_datetime(&nd2.and_hms_opt(23, 59, 59).unwrap())
        .unwrap()
        .timestamp_millis();
    Ok((start, end))
}

fn plugin_id_from_opts_json(opts_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(opts_json)
        .ok()
        .and_then(|v| {
            v.get("pluginId")
                .or_else(|| v.get("baseProviderId"))
                .and_then(|s| s.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "cursor".into())
}

fn resolve_state_db_for_plugin(plugin_id: &str) -> Option<PathBuf> {
    crate::cursor_paths::resolve_cursor_state_db_for_plugin_id(plugin_id)
}

fn read_sqlite_value(db_path: &PathBuf, key: &str) -> Result<Option<String>> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut stmt = conn.prepare("SELECT value FROM ItemTable WHERE key = ?1 LIMIT 1")?;
    let mut rows = stmt.query_map([key], |row| row.get::<_, String>(0))?;
    if let Some(r) = rows.next() {
        let v = r?;
        if v.trim().is_empty() {
            return Ok(None);
        }
        return Ok(Some(v));
    }
    Ok(None)
}

fn write_sqlite_value(db_path: &PathBuf, key: &str, value: &str) -> Result<()> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        [key, value],
    )?;
    Ok(())
}

#[derive(Deserialize)]
struct JwtPayload {
    sub: Option<String>,
    exp: Option<i64>,
}

fn decode_jwt_payload(token: &str) -> Option<JwtPayload> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let mut b64 = parts[1].replace('-', "+").replace('_', "/");
    let pad = (4 - b64.len() % 4) % 4;
    b64.extend(std::iter::repeat('=').take(pad));
    let bytes = base64::engine::general_purpose::STANDARD.decode(&b64).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn user_id_from_sub(sub: &str) -> String {
    let parts: Vec<&str> = sub.split('|').collect();
    if parts.len() >= 2 {
        parts[parts.len() - 1].trim().to_string()
    } else {
        parts[0].trim().to_string()
    }
}

fn build_session_cookie(access_token: &str) -> Result<String> {
    let payload = decode_jwt_payload(access_token).context("invalid JWT access token")?;
    let sub = payload.sub.as_deref().context("JWT missing sub")?;
    let user_id = user_id_from_sub(sub);
    let session = format!("{}%3A%3A{}", user_id, access_token);
    Ok(format!("WorkosCursorSessionToken={session}"))
}

fn needs_refresh(access_token: Option<&str>) -> bool {
    let Some(t) = access_token else {
        return true;
    };
    let Some(p) = decode_jwt_payload(t) else {
        return true;
    };
    let Some(exp) = p.exp else {
        return true;
    };
    let now_ms = Utc::now().timestamp_millis();
    exp * 1000 <= now_ms + REFRESH_BUFFER_MS
}

#[derive(Deserialize)]
struct RefreshBody {
    access_token: Option<String>,
    should_logout: Option<bool>,
}

fn refresh_access_token(refresh_token: &str, db_path: &PathBuf) -> Result<Option<String>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .post(REFRESH_URL)
        .header("Content-Type", "application/json")
        .json(&json!({
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()?;

    let status = resp.status();
    let body_text = resp.text()?;
    if status == 400 || status == 401 {
        let j: serde_json::Value = serde_json::from_str(&body_text).unwrap_or(json!({}));
        if j.get("shouldLogout").and_then(|v| v.as_bool()) == Some(true) {
            bail!("Cursor session expired. Open Cursor and sign in again.");
        }
        bail!("Token refresh failed ({status}). Open Cursor and sign in again.");
    }
    if !status.is_success() {
        return Ok(None);
    }
    let body: RefreshBody = serde_json::from_str(&body_text).unwrap_or(RefreshBody {
        access_token: None,
        should_logout: None,
    });
    if body.should_logout == Some(true) {
        bail!("Cursor session expired. Open Cursor and sign in again.");
    }
    let Some(at) = body.access_token.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let _ = write_sqlite_value(db_path, ACCESS_KEY, &at);
    Ok(Some(at))
}

fn resolve_cursor_access_token(db_path: &PathBuf) -> Result<String> {
    let mut access = read_sqlite_value(db_path, ACCESS_KEY)?;
    let refresh = read_sqlite_value(db_path, REFRESH_KEY)?;

    if access.is_none() && refresh.is_none() {
        bail!(
            "No Cursor auth in {}. Sign in via the Cursor app (tokens stored in state.vscdb).",
            db_path.display()
        );
    }

    if needs_refresh(access.as_deref()) {
        if let Some(ref rt) = refresh {
            if let Some(new_a) = refresh_access_token(rt, db_path)? {
                access = Some(new_a);
            }
        }
    }

    access.context("No usable Cursor access token. Open Cursor and sign in again.")
}

pub fn download_cursor_usage_csv(start_ms: i64, end_ms: i64) -> Result<String> {
    download_cursor_usage_csv_for_plugin("cursor", start_ms, end_ms)
}

pub fn download_cursor_usage_csv_for_plugin(
    plugin_id: &str,
    start_ms: i64,
    end_ms: i64,
) -> Result<String> {
    let db_path = resolve_state_db_for_plugin(plugin_id).with_context(|| {
        format!(
            "Cursor state.vscdb not found for {plugin_id}. Install Cursor or Cursor Nightly and sign in."
        )
    })?;

    let access = resolve_cursor_access_token(&db_path)?;
    let cookie = build_session_cookie(&access)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()?;

    let url = format!(
        "{EXPORT_URL}?startDate={}&endDate={}&strategy=tokens",
        start_ms, end_ms
    );
    let resp = client
        .get(&url)
        .header("Cookie", cookie)
        .header("Accept", "text/csv")
        .header(
            "User-Agent",
            "Mozilla/5.0 (compatible; crossusage-cli usage-stats)",
        )
        .send()?;

    if resp.status() == 401 || resp.status() == 403 {
        bail!("Cursor export returned {} — auth may have expired. Open Cursor and retry.", resp.status());
    }
    if !resp.status().is_success() {
        bail!("Cursor export failed: HTTP {}", resp.status());
    }
    Ok(resp.text()?)
}

fn fetch_csv_cached(plugin_id: &str, since: &str, until: &str) -> Result<String> {
    let cache_key = format!("{plugin_id}:{since}-{until}");
    if let Ok(guard) = CSV_RANGE_CACHE.lock() {
        if let Some((key, at, text)) = guard.as_ref() {
            if key == &cache_key && at.elapsed() < MTD_CACHE_TTL {
                return Ok(text.clone());
            }
        }
    }
    let (start_ms, end_ms) = to_epoch_range_ms(since, until)?;
    let text = download_cursor_usage_csv_for_plugin(plugin_id, start_ms, end_ms)?;
    if let Ok(mut guard) = CSV_RANGE_CACHE.lock() {
        *guard = Some((cache_key, Instant::now(), text.clone()));
    }
    Ok(text)
}

fn row_agg_to_json(key: String, a: &RowAgg) -> UsageStatsRowJson {
    UsageStatsRowJson {
        key,
        input: a.input_no_cache,
        output: a.output,
        cache_write: a.input_cache_write,
        cache_hit: a.cache_read,
        total_tokens: a.total_tokens,
        cost_usd: a.cost_usd,
    }
}

fn sorted_stats_rows(m: &HashMap<String, RowAgg>) -> Vec<UsageStatsRowJson> {
    let mut entries: Vec<_> = m
        .iter()
        .map(|(k, a)| row_agg_to_json(k.clone(), a))
        .collect();
    entries.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    entries
}

/// Usage stats for a date range (same data as CLI `usage-stats`).
pub fn query_usage_stats(
    plugin_id: &str,
    since: Option<&str>,
    until: Option<&str>,
    group: &str,
) -> Result<UsageStatsPayload> {
    let (since, until) = if since.is_none() && until.is_none() {
        month_to_date_range_local()?
    } else {
        resolve_date_range(since, until)?
    };
    let group = group.to_lowercase();
    if group != "model" && group != "provider" {
        bail!("group must be 'model' or 'provider'");
    }

    let csv_text = fetch_csv_cached(plugin_id, &since, &until)?;
    let rows = parse_usage_csv(&csv_text, &since, &until)?;
    let map = if group == "model" {
        aggregate_by_model(&rows)
    } else {
        aggregate_by_provider(&rows)
    };
    let stats_rows = sorted_stats_rows(&map);
    let totals_agg = sum_csv_rows(&rows);
    let totals = row_agg_to_json("total".into(), &totals_agg);

    Ok(UsageStatsPayload {
        since,
        until,
        group,
        rows: stats_rows,
        totals,
    })
}

/// JSON for plugin host API (`cursorUsageExport.queryStats`).
pub fn query_usage_stats_host_json(opts_json: &str) -> String {
    let plugin_id = plugin_id_from_opts_json(opts_json);
    let since = serde_json::from_str::<serde_json::Value>(opts_json)
        .ok()
        .and_then(|v| v.get("since").and_then(|s| s.as_str()).map(str::to_string));
    let until = serde_json::from_str::<serde_json::Value>(opts_json)
        .ok()
        .and_then(|v| v.get("until").and_then(|s| s.as_str()).map(str::to_string));
    let group = serde_json::from_str::<serde_json::Value>(opts_json)
        .ok()
        .and_then(|v| v.get("group").and_then(|s| s.as_str()).map(str::to_string))
        .unwrap_or_else(|| "model".into());

    match query_usage_stats(&plugin_id, since.as_deref(), until.as_deref(), &group) {
        Ok(data) => serde_json::json!({ "status": "ok", "data": data }).to_string(),
        Err(e) => serde_json::json!({
            "status": "error",
            "message": e.to_string()
        })
        .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tiny_csv() {
        let csv = r#"Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-03-01T12:00:00Z,Usage,gpt-5,No,100,200,300,400,1000,$1.50
"#;
        let rows = parse_usage_csv(csv, "20260301", "20260331").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].model, "gpt-5");
        assert_eq!(rows[0].input_no_cache, 200);
        assert_eq!(rows[0].input_cache_write, 100);
        assert_eq!(rows[0].cache_read, 300);
        assert_eq!(rows[0].output_tokens, 400);
        assert!((rows[0].cost_usd - 1.5).abs() < 0.001);
    }

    #[test]
    fn aggregate_by_day_sums_cost() {
        let csv = r#"Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-03-01,Usage,gpt-5,No,100,200,300,400,1000,$1.50
2026-03-01,Usage,claude-4,No,0,50,0,50,100,$0.25
2026-03-02,Usage,gpt-5,No,0,10,0,10,20,$0.10
"#;
        let rows = parse_usage_csv(csv, "20260301", "20260331").unwrap();
        let by_day = aggregate_by_day(&rows);
        assert_eq!(by_day.len(), 2);
        let mar1 = by_day.get("2026-03-01").unwrap();
        assert!((mar1.cost_usd - 1.75).abs() < 0.001);
        assert_eq!(mar1.total_tokens, 1100);
    }

    #[test]
    fn usage_stats_sorts_by_cost() {
        let csv = r#"Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-03-01T12:00:00Z,Usage,cheap,No,0,100,0,100,200,$0.50
2026-03-01T12:00:00Z,Usage,pricey,No,0,100,0,100,200,$2.00
"#;
        let rows = parse_usage_csv(csv, "20260301", "20260331").unwrap();
        let by_model = aggregate_by_model(&rows);
        let stats = sorted_stats_rows(&by_model);
        assert_eq!(stats[0].key, "pricey");
        assert!(stats[0].cost_usd > stats[1].cost_usd);
    }
}
