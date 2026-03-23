//! Best-effort normalization of [`PluginOutput`] lines for charts, sparklines, and alerts.

use crossusage_core::plugin_engine::runtime::{MetricLine, PluginOutput, ProgressFormat};

/// Standard numeric/categorical fields parsed from plugin text (no core changes required).
#[derive(Debug, Clone, Default)]
pub struct NormalizedMetrics {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cost: Option<f64>,
    pub reset_time: Option<String>,
    /// Best-effort cache hit count when labels mention cache.
    pub cache_hits: Option<u64>,
    /// 0.0–100.0 — max %-used across `Progress` lines (percent format), when several
    /// (e.g. Antigravity per-model rows); otherwise first progress / heuristics.
    pub primary_percent: f64,
    /// When the plugin reports **2+** percent progress rows (e.g. Antigravity: Gemini + Claude + GPT-OSS),
    /// a compact string for `crossusage-cli list`: short labels + commas (see `format_list_quota_summary`).
    pub list_quota_summary: Option<String>,
}

fn truncate_label_for_list_quota(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        return s.to_string();
    }
    let take = max_chars.saturating_sub(1);
    s.chars().take(take).collect::<String>() + "…"
}

fn format_list_quota_summary(provider_id: &str, percent_lines: &[(String, f64)]) -> String {
    const MAX_PARTS: usize = 6;
    const MAX_LABEL: usize = 18;
    const MAX_TOTAL_CHARS: usize = 96;

    if provider_id == "mock" {
        let n = percent_lines.len();
        return format!("Demo chaos plugin ({n} %-rows — not real usage; `probe mock` for full)");
    }

    let take = percent_lines.len().min(MAX_PARTS);
    let mut segments: Vec<String> = Vec::with_capacity(take + 1);
    for (l, p) in percent_lines.iter().take(take) {
        let lbl = truncate_label_for_list_quota(l, MAX_LABEL);
        segments.push(format!("{lbl} {:.0}%", p));
    }
    let mut s = segments.join(", ");
    if percent_lines.len() > take {
        s.push_str(&format!(", +{} more", percent_lines.len() - take));
    }
    if s.chars().count() > MAX_TOTAL_CHARS {
        let keep = MAX_TOTAL_CHARS.saturating_sub(1);
        s = s.chars().take(keep).collect::<String>() + "…";
    }
    s
}

fn parse_u64_loose(s: &str) -> Option<u64> {
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn parse_money(s: &str) -> Option<f64> {
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    cleaned.parse().ok()
}

fn label_value_tokens(line: &MetricLine) -> Option<(&str, &str)> {
    match line {
        MetricLine::Text { label, value, .. } => Some((label.as_str(), value.as_str())),
        MetricLine::Badge { label, text, .. } => Some((label.as_str(), text.as_str())),
        MetricLine::Progress { .. } => None,
    }
}

/// Heuristic mapper: scans labels/values for common English patterns.
pub struct NormalizedMetricsMapper;

impl NormalizedMetricsMapper {
    pub fn from_output(out: &PluginOutput) -> NormalizedMetrics {
        let mut m = NormalizedMetrics::default();
        let mut primary_ratio: Option<f64> = None;
        let mut max_percent: f64 = 0.0;
        let mut percent_lines: Vec<(String, f64)> = Vec::new();
        // Sum `used` from `progress` lines with `format: count` (tokens / requests / credits).
        let mut count_input_sum: u64 = 0;
        let mut count_input_lines: usize = 0;
        let mut count_output_sum: u64 = 0;
        let mut count_output_lines: usize = 0;

        for line in &out.lines {
            if let MetricLine::Progress {
                used,
                limit,
                format,
                label,
                resets_at,
                ..
            } = line
            {
                if *limit > 0.0 {
                    let r = (*used / *limit).min(1.0).max(0.0);
                    if primary_ratio.is_none() {
                        primary_ratio = Some(r);
                    }
                }
                match format {
                    ProgressFormat::Percent => {
                        if *limit > 0.0 {
                            let pct = (*used / *limit * 100.0).min(100.0).max(0.0);
                            if pct > max_percent {
                                max_percent = pct;
                            }
                            percent_lines.push((label.clone(), pct));
                        }
                    }
                    ProgressFormat::Dollars => {
                        if m.cost.is_none() && used.is_finite() && *used >= 0.0 {
                            m.cost = Some(*used);
                        }
                    }
                    ProgressFormat::Count { suffix } => {
                        let suf = suffix.to_lowercase();
                        let lab = label.to_lowercase();
                        let n = if used.is_finite() && *used >= 0.0 {
                            (*used).min(u64::MAX as f64) as u64
                        } else {
                            0
                        };
                        let is_req = suf.contains("request") || lab.contains("request");
                        let is_tok = suf.contains("token") || lab.contains("token");
                        let is_cred = suf.contains("credit") || lab.contains("credit");
                        if is_tok {
                            if lab.contains("output") {
                                count_output_sum = count_output_sum.saturating_add(n);
                                count_output_lines += 1;
                            } else {
                                count_input_sum = count_input_sum.saturating_add(n);
                                count_input_lines += 1;
                            }
                        } else if is_req || is_cred {
                            count_input_sum = count_input_sum.saturating_add(n);
                            count_input_lines += 1;
                        }
                    }
                }
                if resets_at.is_some() && m.reset_time.is_none() {
                    m.reset_time = resets_at.clone();
                }

                let combined = format!("{} {}", label.to_lowercase(), "");
                if combined.contains("input") && combined.contains("token") {
                    m.input_tokens = parse_u64_loose(&used.to_string());
                }
                if combined.contains("output") && combined.contains("token") {
                    m.output_tokens = parse_u64_loose(&used.to_string());
                }
            }

            if let Some((label, value)) = label_value_tokens(line) {
                let lk = label.to_lowercase();
                let vk = value.to_lowercase();
                let blob = format!("{} {}", lk, vk);

                if blob.contains("input") && (blob.contains("token") || blob.contains("tok")) {
                    m.input_tokens = m.input_tokens.or_else(|| parse_u64_loose(value));
                }
                if blob.contains("output") && (blob.contains("token") || blob.contains("tok")) {
                    m.output_tokens = m.output_tokens.or_else(|| parse_u64_loose(value));
                }
                if lk.contains("cost") || vk.contains('$') || blob.contains("usd") {
                    m.cost = m.cost.or_else(|| parse_money(value));
                }
                if lk.contains("reset") || vk.contains("reset") || blob.contains("resets") {
                    if m.reset_time.is_none() {
                        m.reset_time = Some(value.to_string());
                    }
                }
                if blob.contains("cache") && (blob.contains("hit") || lk.contains("cache")) {
                    m.cache_hits = m.cache_hits.or_else(|| parse_u64_loose(value));
                }
            }
        }

        if m.input_tokens.is_none() && count_input_lines > 0 {
            m.input_tokens = Some(count_input_sum);
        }
        if m.output_tokens.is_none() && count_output_lines > 0 {
            m.output_tokens = Some(count_output_sum);
        }

        m.primary_percent = max_percent;
        if m.primary_percent <= 0.0 {
            if let Some(r) = primary_ratio {
                m.primary_percent = r * 100.0;
            }
        }

        if percent_lines.len() >= 2 {
            m.list_quota_summary = Some(format_list_quota_summary(
                out.provider_id.as_str(),
                &percent_lines,
            ));
        }

        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossusage_core::plugin_engine::runtime::ProgressFormat;

    fn sample_output() -> PluginOutput {
        PluginOutput {
            provider_id: "mock".into(),
            display_name: "Mock".into(),
            plan: Some("pro".into()),
            icon_url: String::new(),
            lines: vec![
                MetricLine::Text {
                    label: "Input tokens".into(),
                    value: "12000".into(),
                    color: None,
                    subtitle: None,
                },
                MetricLine::Text {
                    label: "Output tokens".into(),
                    value: "3400".into(),
                    color: None,
                    subtitle: None,
                },
                MetricLine::Text {
                    label: "Cost".into(),
                    value: "$1.23".into(),
                    color: None,
                    subtitle: None,
                },
                MetricLine::Progress {
                    label: "Usage".into(),
                    used: 45.0,
                    limit: 100.0,
                    format: ProgressFormat::Percent,
                    resets_at: Some("tomorrow".into()),
                    period_duration_ms: None,
                    color: None,
                },
            ],
        }
    }

    #[test]
    fn mapper_extracts_fields() {
        let m = NormalizedMetricsMapper::from_output(&sample_output());
        assert_eq!(m.input_tokens, Some(12000));
        assert_eq!(m.output_tokens, Some(3400));
        assert!((m.cost.unwrap() - 1.23).abs() < 0.01);
        assert_eq!(m.reset_time.as_deref(), Some("tomorrow"));
        assert!((m.primary_percent - 45.0).abs() < 0.01);
    }

    #[test]
    fn mapper_primary_is_max_percent_across_progress_lines() {
        let out = PluginOutput {
            provider_id: "antigravity".into(),
            display_name: "Antigravity".into(),
            plan: None,
            icon_url: String::new(),
            lines: vec![
                MetricLine::Progress {
                    label: "Gemini Pro".into(),
                    used: 0.0,
                    limit: 100.0,
                    format: ProgressFormat::Percent,
                    resets_at: None,
                    period_duration_ms: None,
                    color: None,
                },
                MetricLine::Progress {
                    label: "Claude Sonnet 4.6".into(),
                    used: 72.0,
                    limit: 100.0,
                    format: ProgressFormat::Percent,
                    resets_at: None,
                    period_duration_ms: None,
                    color: None,
                },
            ],
        };
        let m = NormalizedMetricsMapper::from_output(&out);
        assert!((m.primary_percent - 72.0).abs() < 0.01);
        let s = m.list_quota_summary.as_deref().unwrap_or("");
        assert!(s.contains("Gemini Pro"));
        assert!(s.contains("72"));
        assert!(s.contains("Claude"));
    }

    #[test]
    fn mapper_cost_from_dollars_progress() {
        let out = PluginOutput {
            provider_id: "cursor".into(),
            display_name: "Cursor".into(),
            plan: None,
            icon_url: String::new(),
            lines: vec![MetricLine::Progress {
                label: "On-demand".into(),
                used: 12.34,
                limit: 50.0,
                format: ProgressFormat::Dollars,
                resets_at: None,
                period_duration_ms: None,
                color: None,
            }],
        };
        let m = NormalizedMetricsMapper::from_output(&out);
        assert!((m.cost.unwrap() - 12.34).abs() < 0.01);
    }

    #[test]
    fn mapper_sums_count_token_progress_lines() {
        let out = PluginOutput {
            provider_id: "factory".into(),
            display_name: "Factory".into(),
            plan: None,
            icon_url: String::new(),
            lines: vec![
                MetricLine::Progress {
                    label: "Standard".into(),
                    used: 1000.0,
                    limit: 5000.0,
                    format: ProgressFormat::Count {
                        suffix: "tokens".into(),
                    },
                    resets_at: None,
                    period_duration_ms: None,
                    color: None,
                },
                MetricLine::Progress {
                    label: "Premium".into(),
                    used: 200.0,
                    limit: 1000.0,
                    format: ProgressFormat::Count {
                        suffix: "tokens".into(),
                    },
                    resets_at: None,
                    period_duration_ms: None,
                    color: None,
                },
            ],
        };
        let m = NormalizedMetricsMapper::from_output(&out);
        assert_eq!(m.input_tokens, Some(1200));
    }

    #[test]
    fn mock_provider_quota_summary_is_one_short_line() {
        let lines: Vec<MetricLine> = (0..10)
            .map(|i| MetricLine::Progress {
                label: format!("Line {i}"),
                used: (i as f64) * 10.0,
                limit: 100.0,
                format: ProgressFormat::Percent,
                resets_at: None,
                period_duration_ms: None,
                color: None,
            })
            .collect();
        let out = PluginOutput {
            provider_id: "mock".into(),
            display_name: "Mock".into(),
            plan: None,
            icon_url: String::new(),
            lines,
        };
        let m = NormalizedMetricsMapper::from_output(&out);
        let s = m.list_quota_summary.as_deref().unwrap_or("");
        assert!(s.contains("Demo chaos"));
        assert!(s.contains("10"));
        assert!(!s.contains("Line 0"));
    }
}
