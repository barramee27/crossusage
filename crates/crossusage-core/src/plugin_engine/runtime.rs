use crate::plugin_engine::host_api;
use crate::plugin_engine::manifest::LoadedPlugin;
use crate::provider_accounts::ProviderAccountContext;
use rquickjs::{Array, Context, Ctx, Error, Object, Promise, Runtime, Value};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProgressFormat {
    Percent,
    Dollars,
    Count { suffix: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarChartPoint {
    label: String,
    value: f64,
    #[serde(rename = "valueLabel")]
    value_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpendBreakdown {
    pub model: String,
    pub tokens: u64,
    pub cost_usd: Option<f64>,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MetricLine {
    Text {
        label: String,
        value: String,
        color: Option<String>,
        subtitle: Option<String>,
        model_breakdown: Option<Vec<ModelSpendBreakdown>>,
        status_dot: Option<String>,
        expiry_tooltip: Option<String>,
    },
    Progress {
        label: String,
        used: f64,
        limit: f64,
        format: ProgressFormat,
        #[serde(rename = "resetsAt")]
        resets_at: Option<String>,
        #[serde(rename = "periodDurationMs")]
        period_duration_ms: Option<u64>,
        color: Option<String>,
    },
    Badge {
        label: String,
        text: String,
        color: Option<String>,
        subtitle: Option<String>,
    },
    #[serde(rename = "barChart")]
    BarChart {
        label: String,
        points: Vec<BarChartPoint>,
        note: Option<String>,
        color: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginOutput {
    pub provider_id: String,
    pub display_name: String,
    pub plan: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
    pub lines: Vec<MetricLine>,
    pub icon_url: String,
}

pub fn run_probe(plugin: &LoadedPlugin, app_data_dir: &PathBuf, app_version: &str) -> PluginOutput {
    run_probe_with_account(plugin, app_data_dir, app_version, None)
}

pub fn run_probe_with_account(
    plugin: &LoadedPlugin,
    app_data_dir: &PathBuf,
    app_version: &str,
    account: Option<ProviderAccountContext>,
) -> PluginOutput {
    run_probe_with_account_timeout(
        plugin,
        app_data_dir,
        app_version,
        account,
        Duration::from_secs(PROBE_TIMEOUT_SECS),
    )
}

fn run_probe_with_account_timeout(
    plugin: &LoadedPlugin,
    app_data_dir: &PathBuf,
    app_version: &str,
    account: Option<ProviderAccountContext>,
    timeout: Duration,
) -> PluginOutput {
    let fallback = error_output(plugin, "runtime error".to_string());
    let timeout_message = format!("probe timed out after {}s", timeout.as_secs());
    let deadline_at = Instant::now()
        .checked_add(timeout)
        .unwrap_or_else(Instant::now);
    let deadline = host_api::ProbeDeadline::at(deadline_at);

    let rt = match Runtime::new() {
        Ok(rt) => rt,
        Err(_) => return fallback,
    };
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline_at)));

    let ctx = match Context::full(&rt) {
        Ok(ctx) => ctx,
        Err(_) => return fallback,
    };

    let plugin_id = account
        .as_ref()
        .map(|account| account.instance_id.clone())
        .unwrap_or_else(|| plugin.manifest.id.clone());
    let base_plugin_id = account
        .as_ref()
        .map(|account| account.base_provider_id.clone())
        .unwrap_or_else(|| plugin.manifest.id.clone());
    let display_name = account
        .as_ref()
        .filter(|account| !account.label.trim().is_empty())
        .map(|account| format!("{} ({})", plugin.manifest.name, account.label.trim()))
        .unwrap_or_else(|| plugin.manifest.name.clone());
    let entry_script = plugin.entry_script.clone();
    let icon_url = plugin.icon_data_url.clone();
    let app_data = app_data_dir.clone();

    ctx.with(|ctx| {
        if host_api::inject_host_api_with_deadline(
            &ctx,
            &base_plugin_id,
            &plugin_id,
            account.as_ref(),
            &app_data,
            app_version,
            deadline,
        )
        .is_err()
        {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "host api injection failed".to_string());
        }
        if host_api::patch_http_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "http wrapper patch failed".to_string());
        }
        if host_api::patch_ls_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "ls wrapper patch failed".to_string());
        }
        if host_api::patch_ccusage_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "ccusage wrapper patch failed".to_string());
        }
        if host_api::patch_usage_daily_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "usageDaily wrapper patch failed".to_string());
        }
        if host_api::patch_cursor_logs_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "cursorLogs wrapper patch failed".to_string());
        }
        if host_api::patch_claude_logs_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "claudeLogs wrapper patch failed".to_string());
        }
        if host_api::patch_codex_logs_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "codexLogs wrapper patch failed".to_string());
        }
        if host_api::patch_cursor_usage_export_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "cursorUsageExport wrapper patch failed".to_string());
        }
        if host_api::patch_fireworks_wrapper(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "fireworks wrapper patch failed".to_string());
        }
        if host_api::inject_utils(&ctx).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "utils injection failed".to_string());
        }

        if ctx.eval::<(), _>(entry_script.as_bytes()).is_err() {
            if deadline.has_elapsed() {
                return error_output(plugin, timeout_message.clone());
            }
            return error_output(plugin, "script eval failed".to_string());
        }

        let globals = ctx.globals();
        let plugin_obj: Object = match globals.get("__openusage_plugin") {
            Ok(obj) => obj,
            Err(_) => return error_output(plugin, "missing __openusage_plugin".to_string()),
        };

        let probe_fn: rquickjs::Function = match plugin_obj.get("probe") {
            Ok(f) => f,
            Err(_) => return error_output(plugin, "missing probe()".to_string()),
        };

        let probe_ctx: Value = globals
            .get("__openusage_ctx")
            .unwrap_or_else(|_| Value::new_undefined(ctx.clone()));

        let result_value: Value = match probe_fn.call((probe_ctx,)) {
            Ok(r) => r,
            Err(_) => {
                if deadline.has_elapsed() {
                    return error_output(plugin, timeout_message.clone());
                }
                return error_output(plugin, extract_error_string(&ctx));
            }
        };
        if deadline.has_elapsed() {
            return error_output(plugin, timeout_message.clone());
        }
        let result: Object = if result_value.is_promise() {
            let promise: Promise = match result_value.into_promise() {
                Some(promise) => promise,
                None => {
                    return error_output(plugin, "probe() returned invalid promise".to_string());
                }
            };
            match promise.finish::<Object>() {
                Ok(obj) => obj,
                Err(Error::WouldBlock) => {
                    return error_output(plugin, "probe() returned unresolved promise".to_string());
                }
                Err(_) => return error_output(plugin, extract_error_string(&ctx)),
            }
        } else {
            match result_value.into_object() {
                Some(obj) => obj,
                None => return error_output(plugin, "probe() returned non-object".to_string()),
            }
        };

        let plan: Option<String> = result
            .get::<_, String>("plan")
            .ok()
            .filter(|s| !s.is_empty());

        let warning: Option<String> = result
            .get::<_, String>("warning")
            .ok()
            .filter(|s| !s.is_empty());

        let lines = match parse_lines(&result) {
            Ok(lines) if !lines.is_empty() => lines,
            Ok(_) => vec![error_line("no lines returned".to_string())],
            Err(msg) => vec![error_line(msg)],
        };

        PluginOutput {
            provider_id: plugin_id,
            display_name,
            plan,
            warning,
            lines,
            icon_url,
        }
    })
}

fn parse_model_breakdown(line: &Object) -> Option<Vec<ModelSpendBreakdown>> {
    let arr: Array = line.get("modelBreakdown").ok()?;
    let mut out = Vec::new();
    let len = arr.len();
    for idx in 0..len {
        let row: Object = arr.get(idx).ok()?;
        let model = row.get::<_, String>("model").unwrap_or_default();
        let tokens = row
            .get::<_, f64>("tokens")
            .ok()
            .filter(|v| v.is_finite())
            .map(|v| v.max(0.0) as u64)
            .unwrap_or(0);
        let percent = row
            .get::<_, f64>("percent")
            .ok()
            .filter(|v| v.is_finite())
            .unwrap_or(0.0);
        let cost_usd = row
            .get::<_, f64>("costUsd")
            .ok()
            .filter(|v| v.is_finite());
        if model.trim().is_empty() {
            continue;
        }
        out.push(ModelSpendBreakdown {
            model,
            tokens,
            cost_usd,
            percent,
        });
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn parse_lines(result: &Object) -> Result<Vec<MetricLine>, String> {
    let lines: Array = result
        .get("lines")
        .map_err(|_| "missing lines".to_string())?;

    let mut out = Vec::new();
    let len = lines.len();
    for idx in 0..len {
        let line: Object = lines
            .get(idx)
            .map_err(|_| format!("invalid line at index {}", idx))?;

        let line_type: String = line.get("type").unwrap_or_default();
        let label = line.get::<_, String>("label").unwrap_or_default();
        let color = line.get::<_, String>("color").ok();
        let subtitle = line.get::<_, String>("subtitle").ok();

        match line_type.as_str() {
            "text" => {
                let value = line.get::<_, String>("value").unwrap_or_default();
                let model_breakdown = parse_model_breakdown(&line);
                let status_dot = line.get::<_, String>("statusDot").ok();
                let expiry_tooltip = line.get::<_, String>("expiryTooltip").ok();
                out.push(MetricLine::Text {
                    label,
                    value,
                    color,
                    subtitle,
                    model_breakdown,
                    status_dot,
                    expiry_tooltip,
                });
            }
            "progress" => {
                let used_value: Value = match line.get("used") {
                    Ok(v) => v,
                    Err(_) => {
                        out.push(error_line(format!(
                            "progress line at index {} missing used",
                            idx
                        )));
                        continue;
                    }
                };
                let used = match used_value.as_number() {
                    Some(n) => n,
                    None => {
                        out.push(error_line(format!(
                            "progress line at index {} invalid used (expected number)",
                            idx
                        )));
                        continue;
                    }
                };

                let limit_value: Value = match line.get("limit") {
                    Ok(v) => v,
                    Err(_) => {
                        out.push(error_line(format!(
                            "progress line at index {} missing limit",
                            idx
                        )));
                        continue;
                    }
                };
                let limit = match limit_value.as_number() {
                    Some(n) => n,
                    None => {
                        out.push(error_line(format!(
                            "progress line at index {} invalid limit (expected number)",
                            idx
                        )));
                        continue;
                    }
                };

                if !used.is_finite() || used < 0.0 {
                    out.push(error_line(format!(
                        "progress line at index {} invalid used: {}",
                        idx, used
                    )));
                    continue;
                }
                if !limit.is_finite() || limit <= 0.0 {
                    out.push(error_line(format!(
                        "progress line at index {} invalid limit: {}",
                        idx, limit
                    )));
                    continue;
                }

                let format_obj: Object = match line.get("format") {
                    Ok(obj) => obj,
                    Err(_) => {
                        out.push(error_line(format!(
                            "progress line at index {} missing format",
                            idx
                        )));
                        continue;
                    }
                };
                let kind_value: Value = match format_obj.get("kind") {
                    Ok(v) => v,
                    Err(_) => {
                        out.push(error_line(format!(
                            "progress line at index {} missing format.kind",
                            idx
                        )));
                        continue;
                    }
                };
                let kind = match kind_value.as_string() {
                    Some(s) => s.to_string().unwrap_or_default(),
                    None => {
                        out.push(error_line(format!(
                            "progress line at index {} invalid format.kind (expected string)",
                            idx
                        )));
                        continue;
                    }
                };
                let format = match kind.as_str() {
                    "percent" => {
                        if limit != 100.0 {
                            out.push(error_line(format!(
                                "progress line at index {}: percent format requires limit=100 (got {})",
                                idx, limit
                            )));
                            continue;
                        }
                        ProgressFormat::Percent
                    }
                    "dollars" => ProgressFormat::Dollars,
                    "count" => {
                        let suffix_value: Value = match format_obj.get("suffix") {
                            Ok(v) => v,
                            Err(_) => {
                                out.push(error_line(format!(
                                    "progress line at index {}: count format missing suffix",
                                    idx
                                )));
                                continue;
                            }
                        };
                        let suffix = match suffix_value.as_string() {
                            Some(s) => s.to_string().unwrap_or_default(),
                            None => {
                                out.push(error_line(format!(
                                    "progress line at index {}: count format suffix must be a string",
                                    idx
                                )));
                                continue;
                            }
                        };
                        let suffix = suffix.trim().to_string();
                        if suffix.is_empty() {
                            out.push(error_line(format!(
                                "progress line at index {}: count format suffix must be non-empty",
                                idx
                            )));
                            continue;
                        }
                        ProgressFormat::Count { suffix }
                    }
                    _ => {
                        out.push(error_line(format!(
                            "progress line at index {} invalid format.kind: {}",
                            idx, kind
                        )));
                        continue;
                    }
                };

                let resets_at = match line.get::<_, Value>("resetsAt") {
                    Ok(v) => {
                        if v.is_null() || v.is_undefined() {
                            None
                        } else if let Some(s) = v.as_string() {
                            let raw = s.to_string().unwrap_or_default();
                            let value = raw.trim().to_string();
                            if value.is_empty() {
                                None
                            } else {
                                let parsed = time::OffsetDateTime::parse(
                                    &value,
                                    &time::format_description::well_known::Rfc3339,
                                );
                                if parsed.is_ok() {
                                    Some(value)
                                } else {
                                    // ISO-like but missing timezone: assume UTC.
                                    let is_missing_tz =
                                        value.contains('T') && !value.ends_with('Z') && {
                                            let tail = value.splitn(2, 'T').nth(1).unwrap_or("");
                                            !tail.contains('+') && !tail.contains('-')
                                        };
                                    if is_missing_tz {
                                        let with_z = format!("{}Z", value);
                                        let parsed_with_z = time::OffsetDateTime::parse(
                                            &with_z,
                                            &time::format_description::well_known::Rfc3339,
                                        );
                                        if parsed_with_z.is_ok() {
                                            Some(with_z)
                                        } else {
                                            log::warn!(
                                                "invalid resetsAt at index {} (value='{}'), omitting",
                                                idx,
                                                raw
                                            );
                                            None
                                        }
                                    } else {
                                        log::warn!(
                                            "invalid resetsAt at index {} (value='{}'), omitting",
                                            idx,
                                            raw
                                        );
                                        None
                                    }
                                }
                            }
                        } else {
                            log::warn!("invalid resetsAt at index {} (non-string), omitting", idx);
                            None
                        }
                    }
                    Err(_) => None,
                };

                // Parse optional periodDurationMs
                let period_duration_ms: Option<u64> = match line.get::<_, Value>("periodDurationMs")
                {
                    Ok(val) => {
                        if val.is_null() || val.is_undefined() {
                            None
                        } else if let Some(n) = val.as_number() {
                            let ms = n as u64;
                            if ms > 0 {
                                Some(ms)
                            } else {
                                log::warn!(
                                    "periodDurationMs at index {} must be positive, omitting",
                                    idx
                                );
                                None
                            }
                        } else {
                            log::warn!(
                                "invalid periodDurationMs at index {} (non-number), omitting",
                                idx
                            );
                            None
                        }
                    }
                    Err(_) => None,
                };

                out.push(MetricLine::Progress {
                    label,
                    used,
                    limit,
                    format,
                    resets_at,
                    period_duration_ms,
                    color,
                });
            }
            "badge" => {
                let text = line.get::<_, String>("text").unwrap_or_default();
                out.push(MetricLine::Badge {
                    label,
                    text,
                    color,
                    subtitle,
                });
            }
            "barChart" => {
                let (chart, errors) = parse_bar_chart_line(&line, idx, label, color);
                for message in errors {
                    out.push(error_line(message));
                }
                if let Some(chart) = chart {
                    out.push(chart);
                }
            }
            _ => {
                out.push(error_line(format!(
                    "unknown line type at index {}: {}",
                    idx, line_type
                )));
            }
        }
    }

    Ok(out)
}

// Upper bound on barChart points parsed from a plugin. The chart is daily
// history (plugins emit ~31), so a year of points is generous headroom while
// keeping the loop and allocations bounded — parse_lines runs natively after
// the JS returns, so the probe's interrupt-based timeout can't cap it here.
const MAX_BAR_CHART_POINTS: usize = 366;

// Parses a barChart line, keeping its point/value/note validation out of
// parse_lines. Returns the built line (when at least one point is valid) plus
// any per-point error messages the caller should surface as error lines.
fn parse_bar_chart_line<'js>(
    line: &Object<'js>,
    idx: usize,
    label: String,
    color: Option<String>,
) -> (Option<MetricLine>, Vec<String>) {
    let mut errors: Vec<String> = Vec::new();

    let points_array: Array = match line.get("points") {
        Ok(points) => points,
        Err(_) => {
            errors.push(format!("barChart line at index {} missing points", idx));
            return (None, errors);
        }
    };

    // Bound the loop to a plugin-independent maximum so a huge points array
    // can't exhaust CPU/memory in this native (non-interruptible) path.
    let total_points = points_array.len();
    let scan_count = total_points.min(MAX_BAR_CHART_POINTS);
    if total_points > MAX_BAR_CHART_POINTS {
        log::warn!(
            "barChart line at index {} has {} points; capping at {}",
            idx,
            total_points,
            MAX_BAR_CHART_POINTS
        );
    }

    let mut points = Vec::new();
    for point_idx in 0..scan_count {
        let point: Object = match points_array.get(point_idx) {
            Ok(point) => point,
            Err(_) => {
                errors.push(format!(
                    "barChart line at index {} has invalid point at index {}",
                    idx, point_idx
                ));
                continue;
            }
        };
        let point_label = point.get::<_, String>("label").unwrap_or_default();
        let point_label = point_label.trim().to_string();
        if point_label.is_empty() {
            errors.push(format!(
                "barChart line at index {} has empty point label at index {}",
                idx, point_idx
            ));
            continue;
        }

        let value: Value = match point.get("value") {
            Ok(v) => v,
            Err(_) => {
                errors.push(format!(
                    "barChart line at index {} point {} missing value",
                    idx, point_idx
                ));
                continue;
            }
        };
        let value = match value.as_number() {
            Some(n) if n.is_finite() && n >= 0.0 => n,
            _ => {
                errors.push(format!(
                    "barChart line at index {} point {} invalid value",
                    idx, point_idx
                ));
                continue;
            }
        };

        let value_label = match point.get::<_, Value>("valueLabel") {
            Ok(v) => {
                if v.is_null() || v.is_undefined() {
                    None
                } else if let Some(s) = v.as_string() {
                    let value = s.to_string().unwrap_or_default();
                    let trimmed = value.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                } else {
                    log::warn!(
                        "invalid barChart valueLabel at line {} point {}, omitting",
                        idx,
                        point_idx
                    );
                    None
                }
            }
            Err(_) => None,
        };

        points.push(BarChartPoint {
            label: point_label,
            value,
            value_label,
        });
    }

    if points.is_empty() {
        errors.push(format!("barChart line at index {} has no valid points", idx));
        return (None, errors);
    }

    let note = match line.get::<_, Value>("note") {
        Ok(v) => {
            if v.is_null() || v.is_undefined() {
                None
            } else if let Some(s) = v.as_string() {
                let value = s.to_string().unwrap_or_default();
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            } else {
                log::warn!("invalid note at index {} (non-string), omitting", idx);
                None
            }
        }
        Err(_) => None,
    };

    (
        Some(MetricLine::BarChart {
            label,
            points,
            note,
            color,
        }),
        errors,
    )
}

fn error_output(plugin: &LoadedPlugin, message: String) -> PluginOutput {
    PluginOutput {
        provider_id: plugin.manifest.id.clone(),
        display_name: plugin.manifest.name.clone(),
        plan: None,
        warning: None,
        lines: vec![error_line(message)],
        icon_url: plugin.icon_data_url.clone(),
    }
}

/// Error-shaped probe output for a specific provider instance (matches `run_probe_with_account` ids).
pub fn probe_fault_output(
    plugin: &LoadedPlugin,
    provider_id: &str,
    display_name: &str,
    message: String,
) -> PluginOutput {
    PluginOutput {
        provider_id: provider_id.to_string(),
        display_name: display_name.to_string(),
        plan: None,
        warning: None,
        lines: vec![error_line(message)],
        icon_url: plugin.icon_data_url.clone(),
    }
}

fn extract_error_string(ctx: &Ctx<'_>) -> String {
    let exc = ctx.catch();
    if exc.is_null() || exc.is_undefined() {
        return "The plugin failed, try again or contact plugin author.".to_string();
    }
    if let Some(str_val) = exc.as_string() {
        let message: String = str_val.to_string().unwrap_or_default();
        let trimmed = message.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "The plugin failed, try again or contact plugin author.".to_string()
}

fn error_line(message: String) -> MetricLine {
    MetricLine::Badge {
        label: "Error".to_string(),
        text: message,
        color: Some("#ef4444".to_string()),
        subtitle: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_engine::host_api;
    use crate::plugin_engine::manifest::{LoadedPlugin, PluginManifest};
    use crate::provider_accounts::{ProviderAccountContext, ProviderCredential};
    use serde_json::Value as JsonValue;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_plugin(entry_script: &str) -> LoadedPlugin {
        test_plugin_with_id("test", "Test", entry_script)
    }

    fn test_plugin_with_id(id: &str, name: &str, entry_script: &str) -> LoadedPlugin {
        LoadedPlugin {
            manifest: PluginManifest {
                schema_version: 1,
                id: id.to_string(),
                name: name.to_string(),
                version: "0.0.0".to_string(),
                entry: "plugin.js".to_string(),
                icon: "icon.svg".to_string(),
                brand_color: None,
                lines: vec![],
                links: vec![],
            },
            plugin_dir: PathBuf::from("."),
            entry_script: entry_script.to_string(),
            icon_data_url: "data:image/svg+xml;base64,".to_string(),
            icon_file_path: PathBuf::from("."),
        }
    }

    fn temp_app_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("openusage-test-{}-{}", label, nanos))
    }

    fn error_text(output: PluginOutput) -> String {
        match output.lines.first() {
            Some(MetricLine::Badge { text, .. }) => text.clone(),
            other => panic!("expected error badge, got {:?}", other),
        }
    }

    fn account(instance_id: &str, base_provider_id: &str, label: &str, token: &str) -> ProviderAccountContext {
        ProviderAccountContext {
            instance_id: instance_id.to_string(),
            base_provider_id: base_provider_id.to_string(),
            label: label.to_string(),
            credential: Some(ProviderCredential {
                access_token: Some(token.to_string()),
                refresh_token: None,
                session_key: None,
                expires_at: None,
            }),
            store_path: None,
        }
    }

    #[test]
    fn run_probe_returns_thrown_string_from_sync_error() {
        let plugin = test_plugin(
            r#"
            globalThis.__openusage_plugin = {
                probe() {
                    throw "boom";
                }
            };
            "#,
        );
        let output = run_probe(&plugin, &temp_app_dir("sync"), "0.0.0");
        assert_eq!(error_text(output), "boom");
    }

    #[test]
    fn run_probe_returns_thrown_string_from_async_error() {
        let plugin = test_plugin(
            r#"
            globalThis.__openusage_plugin = {
                probe: async function () {
                    throw "boom";
                }
            };
            "#,
        );
        let output = run_probe(&plugin, &temp_app_dir("async"), "0.0.0");
        assert_eq!(error_text(output), "boom");
    }

    #[test]
    fn progress_resets_at_serializes_as_resets_at_camelcase() {
        let line = MetricLine::Progress {
            label: "Session".to_string(),
            used: 1.0,
            limit: 100.0,
            format: ProgressFormat::Percent,
            resets_at: Some("2099-01-01T00:00:00.000Z".to_string()),
            period_duration_ms: None,
            color: None,
        };

        let json: JsonValue = serde_json::to_value(&line).expect("serialize");
        let obj = json.as_object().expect("object");
        assert!(obj.get("resetsAt").is_some(), "expected resetsAt key");
        assert!(
            obj.get("resets_at").is_none(),
            "did not expect resets_at key"
        );
    }

    #[test]
    fn bar_chart_line_round_trips_from_builder() {
        let plugin = test_plugin(
            r#"
            globalThis.__openusage_plugin = {
                probe(ctx) {
                    return {
                        lines: [
                            ctx.line.barChart({
                                label: "Usage Trend",
                                points: [{ label: "Today", value: 42, valueLabel: "42 tokens" }],
                                note: "Estimated from local logs"
                            })
                        ]
                    };
                }
            };
            "#,
        );

        let output = run_probe(&plugin, &temp_app_dir("bar-chart"), "0.0.0");
        let json: JsonValue = serde_json::to_value(&output.lines[0]).expect("serialize");
        assert_eq!(json["type"], "barChart");
        assert_eq!(json["label"], "Usage Trend");
        assert_eq!(json["points"][0]["valueLabel"], "42 tokens");
        assert_eq!(json["note"], "Estimated from local logs");
    }

    #[test]
    fn bar_chart_caps_excessive_points() {
        let plugin = test_plugin(
            r#"
            globalThis.__openusage_plugin = {
                probe(ctx) {
                    var points = [];
                    for (var i = 0; i < 5000; i++) {
                        points.push({ label: "d" + i, value: i });
                    }
                    return { lines: [ctx.line.barChart({ label: "Big", points: points })] };
                }
            };
            "#,
        );

        let output = run_probe(&plugin, &temp_app_dir("bar-chart-cap"), "0.0.0");
        let json: JsonValue = serde_json::to_value(&output.lines[0]).expect("serialize");
        assert_eq!(json["type"], "barChart");
        assert_eq!(
            json["points"].as_array().expect("points array").len(),
            MAX_BAR_CHART_POINTS
        );
    }

    #[test]
    fn run_probe_routes_account_credentials_to_http_headers() {
        let claude = test_plugin_with_id(
            "claude",
            "Claude",
            r#"
            globalThis.__openusage_plugin = {
                probe(ctx) {
                    const raw = ctx.host.credentials.get();
                    const credential = JSON.parse(raw);
                    ctx.host.http.request({
                        method: "GET",
                        url: "https://example.test/claude/" + ctx.host.account.instanceId,
                        headers: { Authorization: "Bearer " + credential.accessToken }
                    });
                    return { lines: [{ type: "text", label: "Account", value: ctx.host.account.label }] };
                }
            };
            "#,
        );
        let cursor = test_plugin_with_id(
            "cursor",
            "Cursor",
            r#"
            globalThis.__openusage_plugin = {
                probe(ctx) {
                    const raw = ctx.host.credentials.get();
                    const credential = JSON.parse(raw);
                    ctx.host.http.request({
                        method: "POST",
                        url: "https://example.test/cursor",
                        headers: {
                            Authorization: "Bearer " + credential.accessToken,
                            Cookie: "WorkosCursorSessionToken=test-session"
                        }
                    });
                    return { lines: [{ type: "text", label: "Account", value: ctx.account.label }] };
                }
            };
            "#,
        );
        host_api::install_http_mock(vec![(200, "{}"), (200, "{}"), (200, "{}")]);

        let dir = temp_app_dir("multi-account");
        let out_work = run_probe_with_account(
            &claude,
            &dir,
            "0.0.0",
            Some(account("claude:work", "claude", "Work", "claude-work-token")),
        );
        let out_personal = run_probe_with_account(
            &claude,
            &dir,
            "0.0.0",
            Some(account(
                "claude:personal",
                "claude",
                "Personal",
                "claude-personal-token",
            )),
        );
        let out_cursor = run_probe_with_account(
            &cursor,
            &dir,
            "0.0.0",
            Some(account("cursor:default", "cursor", "Default", "cursor-token")),
        );

        assert_eq!(out_work.provider_id, "claude:work");
        assert_eq!(out_personal.provider_id, "claude:personal");
        assert_eq!(out_cursor.provider_id, "cursor:default");

        let requests = host_api::take_http_mock_requests();
        assert_eq!(requests.len(), 3);
        assert_eq!(
            requests[0].headers.get("Authorization").map(String::as_str),
            Some("Bearer claude-work-token")
        );
        assert_eq!(
            requests[1].headers.get("Authorization").map(String::as_str),
            Some("Bearer claude-personal-token")
        );
        assert_eq!(
            requests[2].headers.get("Authorization").map(String::as_str),
            Some("Bearer cursor-token")
        );
        assert_eq!(
            requests[2].headers.get("Cookie").map(String::as_str),
            Some("WorkosCursorSessionToken=test-session")
        );
    }
}
