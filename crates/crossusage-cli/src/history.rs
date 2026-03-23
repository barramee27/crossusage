//! CLI-owned snapshot history: ring buffers in the TUI + optional JSONL append.
//! One JSON object per line (easy to `export` / inspect with `jq`).

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use crossusage_core::plugin_engine::runtime::PluginOutput;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use crate::tui::view_model::{NormalizedMetrics, NormalizedMetricsMapper};

/// Single probe snapshot for export / persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotRecord {
    pub ts: String,
    pub provider_id: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub primary_percent: f64,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cost: Option<f64>,
    pub reset_time: Option<String>,
}

pub fn history_jsonl_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("crossusage")
        .join("cli-history.jsonl")
}

pub fn record_from_output(out: &PluginOutput, at: DateTime<Utc>) -> SnapshotRecord {
    let m = NormalizedMetricsMapper::from_output(out);
    record_from_parts(out, &m, at)
}

fn record_from_parts(
    out: &PluginOutput,
    m: &NormalizedMetrics,
    at: DateTime<Utc>,
) -> SnapshotRecord {
    SnapshotRecord {
        ts: at.to_rfc3339(),
        provider_id: out.provider_id.clone(),
        display_name: out.display_name.clone(),
        plan: out.plan.clone(),
        primary_percent: m.primary_percent,
        input_tokens: m.input_tokens,
        output_tokens: m.output_tokens,
        cost: m.cost,
        reset_time: m.reset_time.clone(),
    }
}

/// Append one line to the default history file (used when `persist_history` is on in the TUI).
pub fn append_jsonl(rec: &SnapshotRecord) -> Result<()> {
    let path = history_jsonl_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create_dir_all {:?}", parent))?;
    }
    let line = serde_json::to_string(rec).context("serialize history line")?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("open {:?}", path))?;
    writeln!(f, "{line}").with_context(|| format!("write {:?}", path))?;
    Ok(())
}

/// Read all records from a JSONL file (skips malformed lines).
pub fn read_jsonl(path: &std::path::Path) -> Result<Vec<SnapshotRecord>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {:?}", path))?;
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(r) = serde_json::from_str::<SnapshotRecord>(line) {
            out.push(r);
        }
    }
    Ok(out)
}

/// Fixed-capacity ring of primary usage % for sparklines.
#[derive(Debug, Clone)]
pub struct PercentRing {
    cap: usize,
    data: VecDeque<u64>,
}

impl PercentRing {
    pub fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(4),
            data: VecDeque::new(),
        }
    }

    pub fn push_percent(&mut self, primary: f64) {
        let v = primary.clamp(0.0, 100.0) as u64;
        if self.data.len() >= self.cap {
            self.data.pop_front();
        }
        self.data.push_back(v);
    }

    /// Last up to 32 points, left-padded with zeros for short history.
    pub fn sparkline_values(&self) -> Vec<u64> {
        const W: usize = 32;
        let v: Vec<u64> = self.data.iter().copied().collect();
        if v.is_empty() {
            return vec![0; W];
        }
        if v.len() >= W {
            v[v.len() - W..].to_vec()
        } else {
            let mut out = vec![0u64; W - v.len()];
            out.extend(v);
            out
        }
    }
}

pub fn print_csv(records: &[SnapshotRecord]) -> Result<()> {
    use std::io::{self, Write};
    let mut w = io::stdout().lock();
    writeln!(
        w,
        "ts,provider_id,display_name,plan,primary_percent,input_tokens,output_tokens,cost,reset_time"
    )?;
    for r in records {
        writeln!(
            w,
            "{},{},{},{},{},{},{},{},{}",
            csv_cell(&r.ts),
            csv_cell(&r.provider_id),
            csv_cell(&r.display_name),
            csv_opt(&r.plan),
            r.primary_percent,
            csv_opt_u64(r.input_tokens),
            csv_opt_u64(r.output_tokens),
            csv_opt_f64(r.cost),
            csv_opt(&r.reset_time),
        )?;
    }
    Ok(())
}

fn csv_cell(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn csv_opt(s: &Option<String>) -> String {
    match s {
        None => String::new(),
        Some(v) => csv_cell(v),
    }
}

fn csv_opt_u64(o: Option<u64>) -> String {
    match o {
        None => String::new(),
        Some(n) => n.to_string(),
    }
}

fn csv_opt_f64(o: Option<f64>) -> String {
    match o {
        None => String::new(),
        Some(n) => format!("{n:.6}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_pads_sparkline() {
        let mut r = PercentRing::new(8);
        r.push_percent(10.0);
        r.push_percent(20.0);
        let v = r.sparkline_values();
        assert_eq!(v.len(), 32);
        assert_eq!(v[v.len() - 2], 10);
        assert_eq!(v[v.len() - 1], 20);
    }
}
