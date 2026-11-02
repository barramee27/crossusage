//! Cursor token-level usage from the dashboard CSV export (same source as cstats).

use anyhow::{bail, Context, Result};
use base64::Engine;
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::log_usage_types::TokenBreakdown;
use crate::model_pricing::default_pricing;

const REFRESH_URL: &str = "https://api2.cursor.sh/oauth/token";
const CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const EXPORT_URL: &str = "https://cursor.com/api/dashboard/export-usage-events-csv";
const USAGE_EVENTS_URL: &str = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const USAGE_EVENTS_PAGE_SIZE: usize = 1000;
const SPEND_HISTORY_BUDGET: Duration = Duration::from_secs(20);
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

/// Per-day rows plus where they came from, so callers can tell billed from estimated.
#[derive(Debug, Clone, Serialize)]
pub struct DailyBilling {
    pub daily: Vec<DailyBillingRow>,
    pub source: UsageSource,
}

/// Per-day totals (includes cost USD). See [`UsageSource`] for what the cost means.
pub fn query_daily_billing(
    plugin_id: &str,
    since: Option<&str>,
    until: Option<&str>,
) -> Result<DailyBilling> {
    let (since, until) = if since.is_none() && until.is_none() {
        let (s, u) = month_to_date_range_local()?;
        (s, u)
    } else {
        resolve_date_range(since, until)?
    };
    let (rows, source) =
        load_cursor_usage_rows_with_events_fallback(plugin_id, &since, &until, None)?;
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
    Ok(DailyBilling { daily: out, source })
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
        Ok(billing) => serde_json::json!({ "status": "ok", "data": billing }).to_string(),
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
    pub source: UsageSource,
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
    let has_cli_auth = crate::cursor_paths::CursorInstall::from_plugin_id(plugin_id)
        == Some(crate::cursor_paths::CursorInstall::Stable)
        && crate::cursor_paths::resolve_cursor_cli_auth_file().is_some();
    if resolve_state_db_for_plugin(plugin_id).is_none() && !has_cli_auth {
        return None;
    }
    let (since, until) = month_to_date_range_local().ok()?;
    let (rows, source) =
        load_cursor_usage_rows_with_events_fallback(plugin_id, &since, &until, None).ok()?;
    let agg = sum_csv_rows(&rows);
    Some(CursorMtdTotals {
        total_tokens: agg.total_tokens,
        input_tokens: agg.input_no_cache,
        output_tokens: agg.output,
        cost_usd: agg.cost_usd,
        since,
        until,
        source,
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

/// `persist_to` is the state DB to write a refreshed access token back into, or `None`
/// to keep it in memory only (the tokens did not come from that DB).
fn refresh_access_token(refresh_token: &str, persist_to: Option<&PathBuf>) -> Result<Option<String>> {
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
    if let Some(db_path) = persist_to {
        let _ = write_sqlite_value(db_path, ACCESS_KEY, &at);
    }
    Ok(Some(at))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthSource {
    /// The desktop app's `state.vscdb`.
    StateDb,
    /// The plaintext `auth.json` written by `agent login` (Cursor CLI).
    CliFile,
}

#[derive(Debug, PartialEq, Eq)]
struct AuthTokens {
    access: Option<String>,
    refresh: Option<String>,
    source: AuthSource,
}

/// Tokens from the Cursor CLI's `auth.json`.
#[derive(Debug, PartialEq, Eq)]
struct CliAuth {
    access: Option<String>,
    refresh: Option<String>,
}

fn parse_cli_auth(text: &str) -> Option<CliAuth> {
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let pick = |key: &str| {
        v.get(key)
            .and_then(|s| s.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let (access, refresh) = (pick("accessToken"), pick("refreshToken"));
    if access.is_none() && refresh.is_none() {
        return None;
    }
    Some(CliAuth { access, refresh })
}

fn read_cli_auth_file() -> Option<CliAuth> {
    let path = crate::cursor_paths::resolve_cursor_cli_auth_file()?;
    parse_cli_auth(&std::fs::read_to_string(path).ok()?)
}

/// Pick which tokens to use. The desktop app's own tokens win when they are readable.
/// Cursor 3.2x+ keeps them encrypted in `state.vscdb`; ciphertext is not a token, so it
/// is ignored and the CLI file is used instead.
fn choose_auth_tokens(
    db_access: Option<String>,
    db_refresh: Option<String>,
    cli: Option<CliAuth>,
) -> Option<AuthTokens> {
    let readable = |v: Option<String>| v.filter(|s| !crate::cursor_paths::is_encrypted_auth_value(s));
    let (access, refresh) = (readable(db_access), readable(db_refresh));
    if access.is_some() || refresh.is_some() {
        return Some(AuthTokens { access, refresh, source: AuthSource::StateDb });
    }
    cli.map(|c| AuthTokens { access: c.access, refresh: c.refresh, source: AuthSource::CliFile })
}

const ENCRYPTED_AUTH_MESSAGE: &str = "Cursor keeps its sign-in encrypted, which CrossUsage cannot read. Run `agent login` (Cursor CLI), then try again.";

fn resolve_cursor_access_token(plugin_id: &str, db_path: Option<&PathBuf>) -> Result<String> {
    let (db_access, db_refresh) = match db_path {
        Some(p) => (read_sqlite_value(p, ACCESS_KEY)?, read_sqlite_value(p, REFRESH_KEY)?),
        None => (None, None),
    };
    let db_has_ciphertext = [&db_access, &db_refresh]
        .iter()
        .any(|v| v.as_deref().is_some_and(crate::cursor_paths::is_encrypted_auth_value));
    // The CLI login is the stable app's; Nightly keeps using its own state DB only.
    let cli = (crate::cursor_paths::CursorInstall::from_plugin_id(plugin_id)
        == Some(crate::cursor_paths::CursorInstall::Stable))
    .then(read_cli_auth_file)
    .flatten();

    let Some(auth) = choose_auth_tokens(db_access, db_refresh, cli) else {
        if db_has_ciphertext {
            bail!("{ENCRYPTED_AUTH_MESSAGE}");
        }
        if let Some(p) = db_path {
            bail!(
                "No Cursor auth in {}. Sign in via the Cursor app (tokens stored in state.vscdb).",
                p.display()
            );
        }
        bail!(
            "Cursor state.vscdb not found for {plugin_id}. Install Cursor or Cursor Nightly and sign in."
        );
    };
    let AuthTokens { mut access, refresh, source } = auth;

    if needs_refresh(access.as_deref()) {
        if let Some(ref rt) = refresh {
            // Only write a refreshed token back into the DB it came from; never into
            // Cursor's encrypted store, and never over the CLI's own file.
            let persist_to = (source == AuthSource::StateDb).then_some(db_path).flatten();
            if let Some(new_a) = refresh_access_token(rt, persist_to)? {
                access = Some(new_a);
            }
        }
    }

    access.context("No usable Cursor access token. Open Cursor and sign in again.")
}

#[cfg(test)]
mod auth_selection_tests {
    use super::*;

    const CIPHERTEXT: &str = "cursor-safe-storage:v1:AAAA";

    fn s(v: &str) -> Option<String> {
        Some(v.to_string())
    }

    fn cli(access: &str, refresh: &str) -> Option<CliAuth> {
        Some(CliAuth { access: s(access), refresh: s(refresh) })
    }

    #[test]
    fn readable_state_db_tokens_win_over_cli_file() {
        let got = choose_auth_tokens(s("db-access"), s("db-refresh"), cli("cli-a", "cli-r")).unwrap();
        assert_eq!(got.source, AuthSource::StateDb);
        assert_eq!(got.access.as_deref(), Some("db-access"));
    }

    #[test]
    fn encrypted_state_db_tokens_are_ignored_in_favor_of_cli_file() {
        let got = choose_auth_tokens(s(CIPHERTEXT), s(CIPHERTEXT), cli("cli-a", "cli-r")).unwrap();
        assert_eq!(got.source, AuthSource::CliFile);
        assert_eq!(got.access.as_deref(), Some("cli-a"));
        assert_eq!(got.refresh.as_deref(), Some("cli-r"));
    }

    #[test]
    fn ciphertext_is_never_returned_as_a_token() {
        // Nothing readable anywhere: no tokens at all, rather than ciphertext sent as a token.
        assert_eq!(choose_auth_tokens(s(CIPHERTEXT), s(CIPHERTEXT), None), None);
        // A readable refresh token survives next to an encrypted access token.
        let got = choose_auth_tokens(s(CIPHERTEXT), s("db-refresh"), None).unwrap();
        assert_eq!((got.access, got.refresh.as_deref()), (None, Some("db-refresh")));
    }

    #[test]
    fn no_state_db_tokens_falls_back_to_cli_file() {
        let got = choose_auth_tokens(None, None, cli("cli-a", "cli-r")).unwrap();
        assert_eq!(got.source, AuthSource::CliFile);
        assert_eq!(choose_auth_tokens(None, None, None), None);
    }

    #[test]
    fn parses_cli_auth_file() {
        let ok = parse_cli_auth(r#"{"accessToken":" a ","refreshToken":"r"}"#).unwrap();
        assert_eq!((ok.access.as_deref(), ok.refresh.as_deref()), (Some("a"), Some("r")));
        // A BOM from some editors must not break parsing.
        assert!(parse_cli_auth("\u{feff}{\"accessToken\":\"a\"}").is_some());
        assert!(parse_cli_auth(r#"{"accessToken":"","refreshToken":"  "}"#).is_none());
        assert!(parse_cli_auth(r#"{"other":1}"#).is_none());
        assert!(parse_cli_auth("not json").is_none());
    }
}

pub fn download_cursor_usage_csv(start_ms: i64, end_ms: i64) -> Result<String> {
    download_cursor_usage_csv_for_plugin("cursor", start_ms, end_ms)
}

pub fn download_cursor_usage_csv_for_plugin(
    plugin_id: &str,
    start_ms: i64,
    end_ms: i64,
) -> Result<String> {
    let db_path = resolve_state_db_for_plugin(plugin_id);
    let access = resolve_cursor_access_token(plugin_id, db_path.as_ref())?;
    let cookie = build_session_cookie(&access)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct CursorHistoryTokens {
    #[serde(default)]
    input: u64,
    #[serde(default)]
    cache_write: u64,
    #[serde(default)]
    cache_read: u64,
    #[serde(default)]
    output: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorHistoryDay {
    models: HashMap<String, CursorHistoryTokens>,
    #[serde(default)]
    is_complete: bool,
}

impl CursorHistoryDay {
    fn add(&mut self, model: String, t: CursorHistoryTokens) {
        let entry = self.models.entry(model).or_default();
        entry.input += t.input;
        entry.cache_write += t.cache_write;
        entry.cache_read += t.cache_read;
        entry.output += t.output;
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorHistoryStoreFile {
    schema_version: u32,
    user_id: String,
    days: HashMap<String, CursorHistoryDay>,
}

const HISTORY_STORE_SCHEMA_VERSION: u32 = 2;

fn cursor_history_store_path(user_id: &str) -> Option<PathBuf> {
    let base = dirs::data_local_dir().or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))?;
    let safe_id: String = user_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    Some(
        base.join("com.barramee27.crossusage")
            .join("cursor-usage-history")
            .join(format!("{safe_id}.json")),
    )
}

fn load_cursor_history_store(user_id: &str) -> HashMap<String, CursorHistoryDay> {
    let Some(path) = cursor_history_store_path(user_id) else {
        return HashMap::new();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return HashMap::new();
    };
    let Ok(file) = serde_json::from_slice::<CursorHistoryStoreFile>(&bytes) else {
        return HashMap::new();
    };
    if file.schema_version != HISTORY_STORE_SCHEMA_VERSION || file.user_id != user_id {
        return HashMap::new();
    }
    file.days
}

fn save_cursor_history_store(user_id: &str, days: &HashMap<String, CursorHistoryDay>) {
    let Some(path) = cursor_history_store_path(user_id) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file = CursorHistoryStoreFile {
        schema_version: HISTORY_STORE_SCHEMA_VERSION,
        user_id: user_id.to_string(),
        days: days.clone(),
    };
    if let Ok(bytes) = serde_json::to_vec(&file) {
        let _ = std::fs::write(&path, bytes);
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedUsageEvent {
    pub timestamp_ms: i64,
    pub model: String,
    pub input_no_cache: u64,
    pub input_cache_write: u64,
    pub cache_read: u64,
    pub output_tokens: u64,
}

pub(crate) struct ParsedUsageEventsPage {
    pub events: Vec<ParsedUsageEvent>,
    pub total_count: usize,
    pub rejected_count: usize,
}

fn parse_non_neg_u64(v: Option<&Value>) -> Option<u64> {
    match v {
        None | Some(Value::Null) => Some(0),
        Some(Value::Number(n)) => n.as_u64(),
        _ => None,
    }
}

fn parse_timestamp_ms(v: Option<&Value>) -> Option<i64> {
    match v {
        Some(Value::String(s)) => s.trim().parse::<i64>().ok().filter(|&ms| ms >= 0),
        Some(Value::Number(n)) => n.as_i64().filter(|&ms| ms >= 0),
        _ => None,
    }
}

pub(crate) fn parse_usage_events_page(body: &[u8]) -> Result<ParsedUsageEventsPage> {
    let v: Value = serde_json::from_slice(body).context("invalid usage events JSON")?;
    let obj = v.as_object().context("usage events root not object")?;
    let total_count = obj
        .get("totalUsageEventsCount")
        .and_then(|n| n.as_u64())
        .context("missing totalUsageEventsCount")? as usize;
    let raw_events = obj
        .get("usageEventsDisplay")
        .and_then(|a| a.as_array())
        .context("missing usageEventsDisplay")?;

    let mut events = Vec::with_capacity(raw_events.len());
    let mut rejected_count = 0usize;
    for raw in raw_events {
        let Some(ev) = raw.as_object() else {
            rejected_count += 1;
            continue;
        };
        let Some(timestamp_ms) = parse_timestamp_ms(ev.get("timestamp")) else {
            rejected_count += 1;
            continue;
        };
        let Some(model) = ev.get("model").and_then(|m| m.as_str()).map(str::trim) else {
            rejected_count += 1;
            continue;
        };
        let (input_no_cache, input_cache_write, cache_read, output_tokens) = match ev.get("tokenUsage") {
            None | Some(Value::Null) => (0, 0, 0, 0),
            Some(Value::Object(tu)) => {
                let (Some(inp), Some(out), Some(cw), Some(cr)) = (
                    parse_non_neg_u64(tu.get("inputTokens")),
                    parse_non_neg_u64(tu.get("outputTokens")),
                    parse_non_neg_u64(tu.get("cacheWriteTokens")),
                    parse_non_neg_u64(tu.get("cacheReadTokens")),
                ) else {
                    rejected_count += 1;
                    continue;
                };
                (inp, cw, cr, out)
            }
            _ => {
                rejected_count += 1;
                continue;
            }
        };
        events.push(ParsedUsageEvent {
            timestamp_ms,
            model: model.to_string(),
            input_no_cache,
            input_cache_write,
            cache_read,
            output_tokens,
        });
    }
    Ok(ParsedUsageEventsPage {
        events,
        total_count,
        rejected_count,
    })
}

fn fetch_usage_events_day(
    client: &reqwest::blocking::Client,
    cookie: &str,
    day_key: &str,
    start_ms: i64,
    end_ms: i64,
    is_complete: bool,
) -> Result<CursorHistoryDay> {
    let mut page = 1usize;
    let mut expected_total: Option<usize> = None;
    let mut received_count = 0usize;
    let mut day = CursorHistoryDay {
        models: HashMap::new(),
        is_complete,
    };

    loop {
        let resp = client
            .post(USAGE_EVENTS_URL)
            .header("Cookie", cookie)
            .header("Content-Type", "application/json")
            .header("Origin", "https://cursor.com")
            .json(&json!({
                "startDate": start_ms.to_string(),
                "endDate": end_ms.to_string(),
                "page": page,
                "pageSize": USAGE_EVENTS_PAGE_SIZE,
            }))
            .send()?;

        if !resp.status().is_success() {
            bail!("usage events HTTP {}", resp.status());
        }
        let bytes = resp.bytes()?;
        let parsed = parse_usage_events_page(&bytes)?;
        if let Some(exp) = expected_total {
            if parsed.total_count != exp {
                bail!("incomplete pages: totalCount changed mid-day");
            }
        }
        expected_total = Some(parsed.total_count);
        let page_count = parsed.events.len() + parsed.rejected_count;
        received_count += page_count;

        if parsed.total_count == 0 {
            if page_count == 0 {
                return Ok(day);
            }
            bail!("incomplete pages: non-empty page when totalCount == 0");
        }
        if page_count == 0 && received_count < parsed.total_count {
            bail!("incomplete pages: empty page before totalCount");
        }
        for ev in parsed.events {
            let Some(dt) = DateTime::<Utc>::from_timestamp_millis(ev.timestamp_ms) else {
                bail!("invalid event timestamp");
            };
            let local = dt.with_timezone(&Local);
            let ev_day = format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day());
            if ev_day != day_key {
                bail!("event outside requested day window");
            }
            if ev.model.is_empty() {
                continue;
            }
            day.add(
                ev.model,
                CursorHistoryTokens {
                    input: ev.input_no_cache,
                    cache_write: ev.input_cache_write,
                    cache_read: ev.cache_read,
                    output: ev.output_tokens,
                },
            );
        }
        if received_count == parsed.total_count {
            return Ok(day);
        }
        if received_count > parsed.total_count {
            bail!("incomplete pages: received > totalCount");
        }
        page += 1;
    }
}

fn cursor_history_day_ready_to_publish(
    date: NaiveDate,
    today: NaiveDate,
    day: Option<&CursorHistoryDay>,
) -> bool {
    day.is_some_and(|d| date >= today || d.is_complete)
}

fn fetch_cursor_usage_rows_via_events(
    plugin_id: &str,
    since: &str,
    until: &str,
) -> Result<Vec<CsvUsageRow>> {
    let db_path = resolve_state_db_for_plugin(plugin_id);
    let access = resolve_cursor_access_token(plugin_id, db_path.as_ref())?;
    let payload = decode_jwt_payload(&access).context("invalid JWT access token")?;
    let sub = payload.sub.as_deref().context("JWT missing sub")?;
    let user_id = user_id_from_sub(sub);
    let cookie = build_session_cookie(&access)?;

    let y1: i32 = since[0..4].parse()?;
    let m1: u32 = since[4..6].parse()?;
    let d1: u32 = since[6..8].parse()?;
    let y2: i32 = until[0..4].parse()?;
    let m2: u32 = until[4..6].parse()?;
    let d2: u32 = until[6..8].parse()?;
    let start_date = NaiveDate::from_ymd_opt(y1, m1, d1).context("invalid since date")?;
    let end_date = NaiveDate::from_ymd_opt(y2, m2, d2).context("invalid until date")?;

    let now_local = Local::now();
    let today_date = now_local.date_naive();
    let yesterday_date = today_date - chrono::Duration::days(1);

    let mut cached = load_cursor_history_store(&user_id);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let mut dates = Vec::new();
    let mut cur = end_date;
    while cur >= start_date {
        dates.push(cur);
        let Some(prev) = cur.pred_opt() else { break };
        cur = prev;
    }

    let deadline = Instant::now() + SPEND_HISTORY_BUDGET;
    let mut updated = false;

    for date in &dates {
        let day_key = date.format("%Y-%m-%d").to_string();
        let force_refresh = *date >= yesterday_date;
        let needs_fetch = force_refresh
            || cached
                .get(&day_key)
                .map(|d| !d.is_complete)
                .unwrap_or(true);
        if !needs_fetch {
            continue;
        }
        if Instant::now() >= deadline {
            break;
        }
        let day_start = Local
            .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .single()
            .or_else(|| Local.from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap()).earliest())
            .context("invalid local start")?;
        let next_date = date.succ_opt().unwrap_or(*date);
        let next_start = Local
            .from_local_datetime(&next_date.and_hms_opt(0, 0, 0).unwrap())
            .single()
            .or_else(|| Local.from_local_datetime(&next_date.and_hms_opt(0, 0, 0).unwrap()).earliest())
            .context("invalid local next start")?;
        let start_ms = day_start.timestamp_millis();
        let next_ms = next_start.timestamp_millis();
        let now_ms = now_local.timestamp_millis();
        let is_complete = next_ms <= now_ms;
        let end_ms = next_ms.min(now_ms) - 1;
        if end_ms < start_ms {
            cached.insert(
                day_key,
                CursorHistoryDay {
                    models: HashMap::new(),
                    is_complete: false,
                },
            );
            continue;
        }
        if let Ok(day_data) =
            fetch_usage_events_day(&client, &cookie, &day_key, start_ms, end_ms, is_complete)
        {
            cached.insert(day_key, day_data);
            updated = true;
        }
    }

    if updated {
        save_cursor_history_store(&user_id, &cached);
    }

    // Upstream #1373: only publish once every requested day is present.
    // Past days must be complete so a failed yesterday refetch falls back to CSV
    // instead of keeping the in-progress snapshot from when that day was still today.
    for date in &dates {
        let day_key = date.format("%Y-%m-%d").to_string();
        if !cursor_history_day_ready_to_publish(*date, today_date, cached.get(&day_key)) {
            bail!("usage history backfill incomplete for window {since}-{until}");
        }
    }

    let pricing = default_pricing();
    let mut rows = Vec::new();
    for date in dates.into_iter().rev() {
        let day_key = date.format("%Y-%m-%d").to_string();
        let Some(day) = cached.get(&day_key) else {
            continue;
        };
        for (model, tok) in &day.models {
            let sum_tokens = tok.input + tok.cache_write + tok.cache_read + tok.output;
            if sum_tokens == 0 {
                continue;
            }
            let tb = TokenBreakdown {
                input: tok.input.min(i32::MAX as u64) as i32,
                cache_write5m: tok.cache_write.min(i32::MAX as u64) as i32,
                cache_write1h: 0,
                cache_read: tok.cache_read.min(i32::MAX as u64) as i32,
                output: tok.output.min(i32::MAX as u64) as i32,
                is_fast: false,
            };
            let cost_usd = pricing
                .resolve(model)
                .map(|r| r.cost_dollars_with_options(&tb, false))
                .unwrap_or(0.0);
            rows.push(CsvUsageRow {
                day_key: day_key.clone(),
                model: model.clone(),
                input_cache_write: tok.cache_write,
                input_no_cache: tok.input,
                cache_read: tok.cache_read,
                output_tokens: tok.output,
                total_tokens: sum_tokens,
                cost_usd,
            });
        }
    }
    Ok(rows)
}

/// Where a set of Cursor usage rows came from. Callers that show a dollar figure
/// need this: only `Csv` carries what Cursor actually billed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageSource {
    /// Dashboard billing CSV: the `Cost` column is the amount Cursor charged.
    Csv,
    /// Per-event token counts priced locally from the bundled price table: a
    /// list-price estimate, which can be non-zero for usage the plan covers.
    Events,
}

/// Events win when they load; any failure falls back to the CSV.
fn pick_usage_rows(
    events: Result<Vec<CsvUsageRow>>,
    csv: impl FnOnce() -> Result<Vec<CsvUsageRow>>,
) -> Result<(Vec<CsvUsageRow>, UsageSource)> {
    if let Ok(rows) = events {
        return Ok((rows, UsageSource::Events));
    }
    csv().map(|rows| (rows, UsageSource::Csv))
}

fn load_cursor_usage_rows_with_events_fallback(
    plugin_id: &str,
    since: &str,
    until: &str,
    preloaded_csv: Option<String>,
) -> Result<(Vec<CsvUsageRow>, UsageSource)> {
    pick_usage_rows(
        fetch_cursor_usage_rows_via_events(plugin_id, since, until),
        || {
            let csv_text = match preloaded_csv {
                Some(t) => t,
                None => fetch_csv_cached(plugin_id, since, until)?,
            };
            parse_usage_csv(&csv_text, since, until)
        },
    )
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

    let (rows, _source) =
        load_cursor_usage_rows_with_events_fallback(plugin_id, &since, &until, None)?;
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

    #[test]
    fn parses_usage_events_page_and_counts_rejected_rows() {
        let payload = serde_json::json!({
            "totalUsageEventsCount": 3,
            "usageEventsDisplay": [
                {
                    "timestamp": "1774947200000",
                    "model": "claude-opus-4-8",
                    "tokenUsage": {
                        "inputTokens": 1000,
                        "outputTokens": 200,
                        "cacheWriteTokens": 500,
                        "cacheReadTokens": 300
                    }
                },
                {
                    "timestamp": 1774947205000i64,
                    "model": "default",
                    "tokenUsage": null
                },
                {
                    "timestamp": "bad",
                    "model": "claude-opus-4-8"
                }
            ]
        });
        let page = parse_usage_events_page(&serde_json::to_vec(&payload).unwrap()).unwrap();
        assert_eq!(page.total_count, 3);
        assert_eq!(page.events.len(), 2);
        assert_eq!(page.rejected_count, 1);
        assert_eq!(page.events[0].model, "claude-opus-4-8");
        assert_eq!(page.events[0].input_no_cache, 1000);
        assert_eq!(page.events[0].input_cache_write, 500);
        assert_eq!(page.events[0].cache_read, 300);
        assert_eq!(page.events[0].output_tokens, 200);
        assert_eq!(page.events[1].model, "default");
        assert_eq!(page.events[1].input_no_cache, 0);
    }

    #[test]
    fn incomplete_yesterday_is_not_ready_to_publish() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
        let yesterday = today - chrono::Duration::days(1);
        let older = today - chrono::Duration::days(2);
        let incomplete = CursorHistoryDay {
            models: HashMap::new(),
            is_complete: false,
        };
        let complete = CursorHistoryDay {
            models: HashMap::new(),
            is_complete: true,
        };
        assert!(!cursor_history_day_ready_to_publish(
            yesterday,
            today,
            Some(&incomplete)
        ));
        assert!(cursor_history_day_ready_to_publish(
            yesterday,
            today,
            Some(&complete)
        ));
        assert!(!cursor_history_day_ready_to_publish(
            older,
            today,
            Some(&incomplete)
        ));
        assert!(cursor_history_day_ready_to_publish(
            today,
            today,
            Some(&incomplete)
        ));
        assert!(!cursor_history_day_ready_to_publish(yesterday, today, None));
    }

    fn sample_row(cost_usd: f64) -> CsvUsageRow {
        CsvUsageRow {
            day_key: "2026-11-01".into(),
            model: "m".into(),
            input_cache_write: 0,
            input_no_cache: 10,
            cache_read: 0,
            output_tokens: 5,
            total_tokens: 15,
            cost_usd,
        }
    }

    #[test]
    fn events_win_and_are_tagged_as_events() {
        let mut csv_called = false;
        let (rows, source) = pick_usage_rows(Ok(vec![sample_row(1.0)]), || {
            csv_called = true;
            Ok(vec![sample_row(9.0)])
        })
        .unwrap();
        assert_eq!(source, UsageSource::Events);
        assert_eq!(rows.len(), 1);
        assert!((rows[0].cost_usd - 1.0).abs() < f64::EPSILON);
        assert!(!csv_called, "CSV must not be fetched when events loaded");
    }

    #[test]
    fn events_failure_falls_back_to_csv_and_is_tagged_as_csv() {
        let (rows, source) = pick_usage_rows(Err(anyhow::anyhow!("backfill incomplete")), || {
            Ok(vec![sample_row(9.0)])
        })
        .unwrap();
        assert_eq!(source, UsageSource::Csv);
        assert!((rows[0].cost_usd - 9.0).abs() < f64::EPSILON);
    }

    #[test]
    fn both_sources_failing_is_an_error() {
        let res = pick_usage_rows(Err(anyhow::anyhow!("events down")), || {
            Err(anyhow::anyhow!("csv down"))
        });
        assert!(res.is_err());
    }

    #[test]
    fn usage_source_serializes_lowercase_in_host_payloads() {
        assert_eq!(serde_json::to_string(&UsageSource::Csv).unwrap(), "\"csv\"");
        assert_eq!(
            serde_json::to_string(&UsageSource::Events).unwrap(),
            "\"events\""
        );

        let billing = DailyBilling {
            daily: vec![DailyBillingRow {
                date: "20261101".into(),
                total_tokens: 15,
                input_tokens: 10,
                output_tokens: 5,
                cost_usd: 1.0,
            }],
            source: UsageSource::Events,
        };
        let v = serde_json::to_value(&billing).unwrap();
        assert_eq!(v["source"], "events");
        assert_eq!(v["daily"][0]["costUsd"], 1.0);

        let mtd = CursorMtdTotals {
            total_tokens: 15,
            input_tokens: 10,
            output_tokens: 5,
            cost_usd: 1.0,
            since: "20261101".into(),
            until: "20261101".into(),
            source: UsageSource::Csv,
        };
        let v = serde_json::to_value(&mtd).unwrap();
        assert_eq!(v["source"], "csv");
        assert_eq!(v["costUsd"], 1.0);
    }
}
