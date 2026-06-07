//! CLI presentation for Cursor CSV usage export (logic in crossusage-core).

use anyhow::{bail, Result};
use crossusage_core::cursor_usage_export::{
    aggregate_by_model, aggregate_by_provider, download_cursor_usage_csv, parse_usage_csv, resolve_date_range,
    to_epoch_range_ms, RowAgg,
};
use serde_json::json;
use std::collections::HashMap;
use tabled::settings::Style;
use tabled::{Table, Tabled};

pub use crossusage_core::cursor_usage_export::{
    fetch_cursor_month_to_date_totals_for_plugin, format_token_count,
};

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

fn print_summary_model_table(since: &str, until: &str, map: &HashMap<String, RowAgg>) -> Result<()> {
    let mut total = RowAgg::default();
    let mut items: Vec<(String, RowAgg)> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    items.sort_by(|a, b| {
        b.1.cost_usd
            .partial_cmp(&a.1.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });

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
    let w = crate::cli_width::terminal_width();
    let tw = (w as usize).saturating_sub(4).max(20);
    if w < crate::cli_width::WIDTH_FULL_TABLE_AT {
        for r in rows {
            if r.model == "Total" {
                println!("---");
                let line = format!(
                    "Total  In: {}  Out: {}  CacheW: {}  CacheR: {}  Total tok: {}  {}",
                    r.input, r.output, r.cache_write, r.cache_hit, r.total_tokens, r.cost_usd
                );
                for line in crate::cli_width::wrap_plain(&line, tw).lines() {
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
            for pl in crate::cli_width::wrap_plain(&line, tw).lines() {
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
    items.sort_by(|a, b| {
        b.1.cost_usd
            .partial_cmp(&a.1.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });

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
    let w = crate::cli_width::terminal_width();
    let tw = (w as usize).saturating_sub(4).max(20);
    if w < crate::cli_width::WIDTH_FULL_TABLE_AT {
        for r in rows {
            if r.provider == "Total" {
                println!("---");
                let line = format!(
                    "Total  In: {}  Out: {}  CacheW: {}  CacheR: {}  Total tok: {}  {}",
                    r.input, r.output, r.cache_write, r.cache_hit, r.total_tokens, r.cost_usd
                );
                for line in crate::cli_width::wrap_plain(&line, tw).lines() {
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
            for pl in crate::cli_width::wrap_plain(&line, tw).lines() {
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
