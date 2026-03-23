//! Cursor token-level usage from the same CSV export as [cstats](https://github.com/robinebers/cstats).
//! Other providers do not expose this export; use `list` / `probe` for subscription meters.

use crate::cli_width;
use anyhow::{bail, Context, Result};
use base64::Engine;
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tabled::settings::Style;
use tabled::{Table, Tabled};

const REFRESH_URL: &str = "https://api2.cursor.sh/oauth/token";
const CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const EXPORT_URL: &str = "https://cursor.com/api/dashboard/export-usage-events-csv";
const ACCESS_KEY: &str = "cursorAuth/accessToken";
const REFRESH_KEY: &str = "cursorAuth/refreshToken";
const REFRESH_BUFFER_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Default)]
struct RowAgg {
    input_no_cache: u64,
    input_cache_write: u64,
    cache_read: u64,
    output: u64,
    total_tokens: u64,
    cost_usd: f64,
}

#[derive(Debug, Clone, Tabled)]
struct SummaryModelRow {
    model: String,
    #[tabled(rename = "Input")]
    input: String,
    #[tabled(rename = "Output")]
    output: String,
    #[tabled(rename = "Cache Write")]
    cache_write: String,
    #[tabled(rename = "Cache Hit")]
    cache_hit: String,
    #[tabled(rename = "Total Tokens")]
    total_tokens: String,
    #[tabled(rename = "Cost (USD)")]
    cost_usd: String,
}

#[derive(Debug, Clone, Tabled)]
struct SummaryProviderRow {
    provider: String,
    #[tabled(rename = "Input")]
    input: String,
    #[tabled(rename = "Output")]
    output: String,
    #[tabled(rename = "Cache Write")]
    cache_write: String,
    #[tabled(rename = "Cache Hit")]
    cache_hit: String,
    #[tabled(rename = "Total Tokens")]
    total_tokens: String,
    #[tabled(rename = "Cost (USD)")]
    cost_usd: String,
}

/// CLI args mirror [cstats](https://github.com/robinebers/cstats) where possible.
pub struct UsageStatsArgs {
    pub provider: String,
    pub since: Option<String>,
    pub until: Option<String>,
    pub group: String,
    pub output: String,
    pub json: bool,
}

pub fn run_usage_stats(args: UsageStatsArgs) -> Result<()> {
    if args.provider != "cursor" {
        bail!(
            "token-level CSV export is only implemented for Cursor (same source as cstats).\n\
             Provider {:?} has no equivalent per-model export in CrossUsage.\n\
             Use `crossusage-cli list` / `probe {}` for subscription-style meters.",
            args.provider,
            args.provider
        );
    }

    if args.output != "summary" {
        bail!("Only --output summary is implemented (daily mode may be added later).");
    }

    let group = args.group.to_lowercase();
    if group != "model" && group != "provider" {
        bail!("--group must be 'model' or 'provider'.");
    }

    let (since, until) = resolve_date_range(args.since.as_deref(), args.until.as_deref())?;
    let (start_ms, end_ms) = to_epoch_range_ms(&since, &until)?;

    let csv_text = download_cursor_usage_csv(start_ms, end_ms)?;
    let rows = parse_usage_csv(&csv_text, &since, &until)?;

    if rows.is_empty() {
        println!("No Cursor usage rows in range {since}–{until}.");
        return Ok(());
    }

    if group == "model" {
        let by_model = aggregate_by_model(&rows);
        if args.json {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "since": since,
                    "until": until,
                    "group": "model",
                    "rows": by_model.iter().map(|(m, a)| json!({
                        "model": m,
                        "input": a.input_no_cache,
                        "output": a.output,
                        "cacheWrite": a.input_cache_write,
                        "cacheHit": a.cache_read,
                        "totalTokens": a.total_tokens,
                        "costUsd": format!("{:.2}", a.cost_usd),
                    })).collect::<Vec<_>>(),
                    "totals": totals_json(&by_model),
                }))?
            );
            return Ok(());
        }
        print_summary_model_table(&since, &until, &by_model)?;
    } else {
        let by_provider = aggregate_by_provider(&rows);
        if args.json {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "since": since,
                    "until": until,
                    "group": "provider",
                    "rows": by_provider.iter().map(|(p, a)| json!({
                        "provider": p,
                        "input": a.input_no_cache,
                        "output": a.output,
                        "cacheWrite": a.input_cache_write,
                        "cacheHit": a.cache_read,
                        "totalTokens": a.total_tokens,
                        "costUsd": format!("{:.2}", a.cost_usd),
                    })).collect::<Vec<_>>(),
                    "totals": totals_json(&by_provider),
                }))?
            );
            return Ok(());
        }
        print_summary_provider_table(&since, &until, &by_provider)?;
    }

    Ok(())
}

fn totals_json(m: &HashMap<String, RowAgg>) -> serde_json::Value {
    let mut t = RowAgg::default();
    for a in m.values() {
        t.input_no_cache += a.input_no_cache;
        t.input_cache_write += a.input_cache_write;
        t.cache_read += a.cache_read;
        t.output += a.output;
        t.total_tokens += a.total_tokens;
        t.cost_usd += a.cost_usd;
    }
    json!({
        "input": t.input_no_cache,
        "output": t.output,
        "cacheWrite": t.input_cache_write,
        "cacheHit": t.cache_read,
        "totalTokens": t.total_tokens,
        "costUsd": format!("{:.2}", t.cost_usd),
    })
}

#[derive(Debug, Clone)]
struct CsvUsageRow {
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

fn parse_usage_csv(text: &str, since: &str, until: &str) -> Result<Vec<CsvUsageRow>> {
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

        out.push(CsvUsageRow {
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

fn aggregate_by_model(rows: &[CsvUsageRow]) -> HashMap<String, RowAgg> {
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

fn aggregate_by_provider(rows: &[CsvUsageRow]) -> HashMap<String, RowAgg> {
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

#[derive(Debug, Clone)]
pub struct CursorMtdTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

/// Month-to-date totals from Cursor's dashboard CSV (same source as [cstats](https://github.com/robinebers/cstats)).
/// Returns `None` if no local Cursor DB, export fails, or CSV cannot be parsed — fall back to probe metrics.
pub fn fetch_cursor_month_to_date_totals() -> Option<CursorMtdTotals> {
    if find_cursor_state_db().is_none() {
        return None;
    }
    let (since, until) = month_to_date_range_local().ok()?;
    let (start_ms, end_ms) = to_epoch_range_ms(&since, &until).ok()?;
    let csv_text = download_cursor_usage_csv(start_ms, end_ms).ok()?;
    let rows = parse_usage_csv(&csv_text, &since, &until).ok()?;
    let agg = sum_csv_rows(&rows);
    Some(CursorMtdTotals {
        input_tokens: agg.input_no_cache,
        output_tokens: agg.output,
        cost_usd: agg.cost_usd,
    })
}

fn month_to_date_range_local() -> Result<(String, String)> {
    let now = Local::now().date_naive();
    let first = NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
        .context("invalid month start")?;
    let since = first.format("%Y%m%d").to_string();
    let until = now.format("%Y%m%d").to_string();
    Ok((since, until))
}

fn print_summary_model_table(since: &str, until: &str, map: &HashMap<String, RowAgg>) -> Result<()> {
    let mut total = RowAgg::default();
    let mut items: Vec<(String, RowAgg)> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    items.sort_by(|a, b| b.1.cost_usd.partial_cmp(&a.1.cost_usd).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));

    let mut rows: Vec<SummaryModelRow> = Vec::new();
    for (model, a) in &items {
        total.input_no_cache += a.input_no_cache;
        total.input_cache_write += a.input_cache_write;
        total.cache_read += a.cache_read;
        total.output += a.output;
        total.total_tokens += a.total_tokens;
        total.cost_usd += a.cost_usd;
        rows.push(SummaryModelRow {
            model: model.clone(),
            input: fmt_num(a.input_no_cache),
            output: fmt_num(a.output),
            cache_write: fmt_num(a.input_cache_write),
            cache_hit: fmt_num(a.cache_read),
            total_tokens: fmt_num(a.total_tokens),
            cost_usd: format!("${:.2}", a.cost_usd),
        });
    }

    rows.push(SummaryModelRow {
        model: "Total".into(),
        input: fmt_num(total.input_no_cache),
        output: fmt_num(total.output),
        cache_write: fmt_num(total.input_cache_write),
        cache_hit: fmt_num(total.cache_read),
        total_tokens: fmt_num(total.total_tokens),
        cost_usd: format!("${:.2}", total.cost_usd),
    });

    println!(
        "Cursor usage (CSV export) — {} to {} — costs summed from export rows (see cstats).\n",
        fmt_display_date(since),
        fmt_display_date(until)
    );
    render_summary_model_output(&rows)?;
    Ok(())
}

fn render_summary_model_output(rows: &[SummaryModelRow]) -> Result<()> {
    let w = cli_width::terminal_width();
    let tw = (w as usize).saturating_sub(4).max(20);
    if w < cli_width::WIDTH_FULL_TABLE_AT {
        for r in rows {
            if r.model == "Total" {
                println!("---");
                let line = format!(
                    "Total  In: {}  Out: {}  CacheW: {}  CacheR: {}  Total tok: {}  {}",
                    r.input, r.output, r.cache_write, r.cache_hit, r.total_tokens, r.cost_usd
                );
                for line in cli_width::wrap_plain(&line, tw).lines() {
                    println!("{line}");
                }
                continue;
            }
            println!("---");
            println!("Model: {}", r.model);
            let line = format!(
                "In: {}  Out: {}  CacheW: {}  CacheR: {}  Total: {}  {}",
                r.input, r.output, r.cache_write, r.cache_hit, r.total_tokens, r.cost_usd
            );
            for pl in cli_width::wrap_plain(&line, tw).lines() {
                println!("  {pl}");
            }
        }
        println!();
    } else {
        let mut table = Table::new(rows);
        table.with(Style::rounded());
        println!("{table}");
    }
    Ok(())
}

fn print_summary_provider_table(since: &str, until: &str, map: &HashMap<String, RowAgg>) -> Result<()> {
    let mut total = RowAgg::default();
    let mut items: Vec<(String, RowAgg)> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    items.sort_by(|a, b| b.1.cost_usd.partial_cmp(&a.1.cost_usd).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));

    let mut rows: Vec<SummaryProviderRow> = Vec::new();
    for (prov, a) in &items {
        total.input_no_cache += a.input_no_cache;
        total.input_cache_write += a.input_cache_write;
        total.cache_read += a.cache_read;
        total.output += a.output;
        total.total_tokens += a.total_tokens;
        total.cost_usd += a.cost_usd;
        rows.push(SummaryProviderRow {
            provider: prov.clone(),
            input: fmt_num(a.input_no_cache),
            output: fmt_num(a.output),
            cache_write: fmt_num(a.input_cache_write),
            cache_hit: fmt_num(a.cache_read),
            total_tokens: fmt_num(a.total_tokens),
            cost_usd: format!("${:.2}", a.cost_usd),
        });
    }

    rows.push(SummaryProviderRow {
        provider: "Total".into(),
        input: fmt_num(total.input_no_cache),
        output: fmt_num(total.output),
        cache_write: fmt_num(total.input_cache_write),
        cache_hit: fmt_num(total.cache_read),
        total_tokens: fmt_num(total.total_tokens),
        cost_usd: format!("${:.2}", total.cost_usd),
    });

    println!(
        "Cursor usage by inferred provider — {} to {} — model→provider mapping is heuristic.\n",
        fmt_display_date(since),
        fmt_display_date(until)
    );
    render_summary_provider_output(&rows)?;
    Ok(())
}

fn render_summary_provider_output(rows: &[SummaryProviderRow]) -> Result<()> {
    let w = cli_width::terminal_width();
    let tw = (w as usize).saturating_sub(4).max(20);
    if w < cli_width::WIDTH_FULL_TABLE_AT {
        for r in rows {
            if r.provider == "Total" {
                println!("---");
                let line = format!(
                    "Total  In: {}  Out: {}  CacheW: {}  CacheR: {}  Total tok: {}  {}",
                    r.input, r.output, r.cache_write, r.cache_hit, r.total_tokens, r.cost_usd
                );
                for line in cli_width::wrap_plain(&line, tw).lines() {
                    println!("{line}");
                }
                continue;
            }
            println!("---");
            println!("Provider: {}", r.provider);
            let line = format!(
                "In: {}  Out: {}  CacheW: {}  CacheR: {}  Total: {}  {}",
                r.input, r.output, r.cache_write, r.cache_hit, r.total_tokens, r.cost_usd
            );
            for pl in cli_width::wrap_plain(&line, tw).lines() {
                println!("  {pl}");
            }
        }
        println!();
    } else {
        let mut table = Table::new(rows);
        table.with(Style::rounded());
        println!("{table}");
    }
    Ok(())
}

fn fmt_display_date(yyyymmdd: &str) -> String {
    if yyyymmdd.len() == 8 {
        format!(
            "{}-{}-{}",
            &yyyymmdd[0..4],
            &yyyymmdd[4..6],
            &yyyymmdd[6..8]
        )
    } else {
        yyyymmdd.to_string()
    }
}

fn resolve_date_range(since: Option<&str>, until: Option<&str>) -> Result<(String, String)> {
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

fn to_epoch_range_ms(since: &str, until: &str) -> Result<(i64, i64)> {
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

fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(h) = dirs::home_dir() {
            return h.join(rest);
        }
    }
    PathBuf::from(p)
}

fn find_cursor_state_db() -> Option<PathBuf> {
    let mac = expand_home("~/Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    let linux = expand_home("~/.config/Cursor/User/globalStorage/state.vscdb");
    let win = expand_home("~/AppData/Roaming/Cursor/User/globalStorage/state.vscdb");
    for p in [mac, linux, win] {
        if p.exists() {
            return Some(p);
        }
    }
    None
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

fn download_cursor_usage_csv(start_ms: i64, end_ms: i64) -> Result<String> {
    let db_path = find_cursor_state_db().context(
        "Cursor state.vscdb not found. Install Cursor and sign in, or set up Linux paths under ~/.config/Cursor/…",
    )?;

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
}
