//! CrossUsage CLI — same plugin engine as the desktop app.
//! Fork: https://github.com/barramee27/crossusage · Upstream OpenUsage: https://github.com/robinebers/openusage

mod batch_probe;
mod cli_width;
mod config;
mod cursor_token_usage;
mod daemon;
mod history;
mod panic_hook;
mod reset_display;
mod tui;

use anyhow::{bail, Context, Result};
use chrono::Utc;
use clap::{Parser, Subcommand, ValueEnum};
use crossusage_core::paths::{self as cu_paths, ResourceDirResolution};
use crossusage_core::plugin_engine::runtime::{MetricLine, PluginOutput, ProgressFormat};
use crossusage_core::plugin_engine::{self, manifest::LoadedPlugin};
use owo_colors::OwoColorize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tabled::settings::object::Columns;
use tabled::settings::{Modify, Style, Width};
use tabled::{Table, Tabled};

use crate::cli_width::CliTableLayout;
use crate::config::CliConfig;
use crate::reset_display::format_resets_at_for_display;
use crate::tui::view_model::NormalizedMetricsMapper;

#[derive(Parser)]
#[command(name = "crossusage-cli")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "CrossUsage — AI subscription usage from the terminal")]
#[command(
    after_long_help = "NOTE: --daemon runs background polling only and cannot be combined with a subcommand. For advanced daemon options use: crossusage-cli daemon --help"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Config file path (default: ~/.config/crossusage/config.toml)
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<PathBuf>,

    /// Theme: dark | light | btop-rainbow | auto
    #[arg(long, global = true)]
    theme: Option<String>,

    /// Override probe refresh interval (seconds)
    #[arg(long, global = true)]
    refresh_sec: Option<u64>,

    /// Disable mouse capture in the TUI
    #[arg(long, global = true)]
    no_mouse: bool,

    /// Background polling + desktop notifications only (no TUI). Cannot be used with a subcommand.
    #[arg(long, global = true)]
    daemon: bool,

    /// Output JSON instead of tables (for scripts)
    #[arg(long, global = true)]
    json: bool,

    /// No ANSI colors
    #[arg(long, global = true)]
    plain: bool,

    /// Show plugin host WARN/ERROR logs on stderr (default: hidden for dashboard)
    #[arg(long, global = true)]
    verbose: bool,

    /// Skip real plugin probes; use demo data (TUI input / layout test). Also: `dashboard --no-probe`.
    #[arg(long, global = true)]
    no_probe: bool,

    /// Skip the interactive provider checkbox screen; load all discovered providers (or those from CLI args) immediately.
    #[arg(long, global = true)]
    no_picker: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// List providers and probe current usage (table)
    List {
        /// Plugin ids (e.g. cursor). If empty, lists all.
        plugin_ids: Vec<String>,
    },
    /// One-shot JSON probe (use --human for legacy table output)
    Probe {
        /// Plugin ids (e.g. cursor, claude). If empty, probes all.
        plugin_ids: Vec<String>,
        /// Print human-readable tables instead of JSON
        #[arg(long)]
        human: bool,
    },
    /// Full-screen btop-style dashboard (default if no subcommand)
    #[command(visible_alias = "tui")]
    Dashboard {
        /// Plugin ids (e.g. cursor). If empty, probes all.
        plugin_ids: Vec<String>,
    },
    /// Export usage snapshots as JSON or CSV (live probe, or read prior JSONL history)
    Export {
        #[arg(long, value_enum, default_value_t = ExportFormat::Json)]
        format: ExportFormat,
        #[arg(long)]
        from_file: Option<std::path::PathBuf>,
        plugin_ids: Vec<String>,
    },
    /// Cursor per-model token usage (CSV export). Same data source as [cstats](https://github.com/robinebers/cstats); other providers are not supported.
    #[command(name = "usage-stats", visible_alias = "cstats")]
    UsageStats {
        /// Only `cursor` is implemented (token CSV export).
        #[arg(long, default_value = "cursor")]
        provider: String,
        #[arg(short = 's', long)]
        since: Option<String>,
        #[arg(short = 'u', long)]
        until: Option<String>,
        #[arg(short = 'g', long, default_value = "model")]
        group: String,
        #[arg(short = 'o', long, default_value = "summary")]
        output: String,
    },
    /// Poll in background and notify when usage is high (advanced; see also global --daemon)
    Daemon {
        #[arg(long)]
        detach: bool,
        #[arg(long, hide = true)]
        child: bool,
        #[arg(long, default_value_t = 30)]
        interval_sec: u64,
        #[arg(long, default_value_t = 85.0)]
        threshold_percent: f64,
        #[arg(long, default_value_t = 3600)]
        cooldown_sec: u64,
        #[arg(long)]
        log_file: Option<PathBuf>,
        plugin_ids: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum ExportFormat {
    #[default]
    Json,
    Csv,
}

/// Match dashboard behavior: hide `log` / plugin-host WARN+ERROR on stderr unless `--verbose`.
fn apply_cli_log_policy(verbose: bool) {
    if !verbose {
        log::set_max_level(log::LevelFilter::Off);
    }
}

/// Alphabetical by provider `id` (stable, matches probe order when listing all).
fn sort_list_rows_by_id(rows: &mut Vec<ListUsageRow>) {
    rows.sort_by(|a, b| a.id.cmp(&b.id));
}

    /// SIGINT/SIGTERM flag for batch commands (`list` / `probe` / live `export`) — checked between probes.
    fn register_batch_interrupt_flag() -> Result<Arc<AtomicBool>> {
        use signal_hook::consts::signal::SIGINT;
        use signal_hook::flag as signal_flag;

        let flag = Arc::new(AtomicBool::new(false));
        signal_flag::register(SIGINT, Arc::clone(&flag)).context("register SIGINT for batch command")?;
        #[cfg(unix)]
        {
            use signal_hook::consts::signal::SIGTERM;
            signal_flag::register(SIGTERM, Arc::clone(&flag)).context("register SIGTERM for batch command")?;
        }
        Ok(flag)
    }

    fn exit_if_batch_interrupted(flag: &Arc<AtomicBool>) {
        if flag.load(Ordering::SeqCst) {
            eprintln!("\ncrossusage-cli: interrupted");
            std::process::exit(130);
        }
    }

    fn main() -> Result<()> {
        panic_hook::install();
        let cli = Cli::parse();
        // Ignore SIGTSTP / SIGTTIN / SIGTTOU for every command (long probes, IDE terminals, bash
        // `[1]+ Stopped`, etc.) — same idea as the interactive dashboard.
        tui::ignore_sigtstp();
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
        let plain = cli.plain;

        if cli.daemon && cli.command.is_some() {
            bail!(
                "--daemon cannot be used with a subcommand. \
                Run `crossusage-cli --daemon` alone, or use `crossusage-cli daemon` for advanced options."
            );
        }

        if let Some(Commands::UsageStats {
            ref provider,
            ref since,
            ref until,
            ref group,
            ref output,
        }) = &cli.command
        {
            apply_cli_log_policy(cli.verbose);
            cursor_token_usage::run_usage_stats(cursor_token_usage::UsageStatsArgs {
                provider: provider.clone(),
                since: since.clone(),
                until: until.clone(),
                group: group.clone(),
                output: output.clone(),
                json: cli.json,
            })?;
            return Ok(());
        }

        let cu_paths::CliPaths {
            app_data,
            resource_dir,
            resource_resolution,
        } = resolve_install_paths()?;

        let version = env!("CARGO_PKG_VERSION").to_string();
        let (_plugin_dir, plugins) =
            plugin_engine::initialize_plugins(&app_data, resource_dir.as_deref());
        let plugins = Arc::new(plugins);

        let config_path = CliConfig::resolve_path(cli.config.clone());
        let mut cfg = CliConfig::load_from_path(&config_path);
        cfg = cfg.merge_cli_overrides(cli.theme.as_deref(), cli.refresh_sec, cli.no_mouse);

        if cli.daemon {
            if plugins.is_empty() {
                bail!(
                    "No plugins discovered; nothing to watch.\n{}",
                    cu_paths::plugins_empty_diagnostic(&resource_resolution)
                );
            }
            return run_global_daemon(app_data, version, Arc::clone(&plugins), cli.verbose);
        }

        match cli.command {
            None => {
                run_dashboard_cmd(
                    &cli,
                    &cfg,
                    &config_path,
                    &[],
                    &app_data,
                    &version,
                    &plugins,
                    &resource_resolution,
                )?;
            }
            Some(Commands::UsageStats { .. }) => {
                unreachable!("usage-stats is handled before plugin load")
            }
            Some(Commands::Dashboard { ref plugin_ids }) => {
                run_dashboard_cmd(
                    &cli,
                    &cfg,
                    &config_path,
                    plugin_ids,
                    &app_data,
                    &version,
                    &plugins,
                    &resource_resolution,
                )?;
            }
            Some(Commands::List { ref plugin_ids }) => {
                run_list_cmd(
                    &cli,
                    &cfg,
                    plugin_ids,
                    &app_data,
                    &version,
                    &plugins,
                    plain,
                    &resource_resolution,
                )?;
            }
            Some(Commands::Probe {
                ref plugin_ids,
                human,
            }) => {
                run_probe_cmd(
                    plugin_ids,
                    human,
                    &app_data,
                    &version,
                    &plugins,
                    plain,
                    cli.verbose,
                    &resource_resolution,
                )?;
            }
            Some(Commands::Export {
                format: export_fmt,
                ref from_file,
                ref plugin_ids,
            }) => {
                run_export_cmd(
                    export_fmt,
                    from_file.clone(),
                    plugin_ids.clone(),
                    &app_data,
                    &version,
                    &plugins,
                    cli.verbose,
                    &resource_resolution,
                )?;
            }
        Some(Commands::Daemon {
            detach,
            child,
            interval_sec,
            threshold_percent,
            cooldown_sec,
            ref log_file,
            ref plugin_ids,
        }) => {
            apply_cli_log_policy(cli.verbose);
            if detach && !child {
                if plugins.is_empty() {
                    bail!(
                        "No plugins discovered; nothing to watch.\n{}",
                        cu_paths::plugins_empty_diagnostic(&resource_resolution)
                    );
                }
                daemon::spawn_detached(daemon::SpawnArgs {
                    interval_sec,
                    threshold_percent,
                    cooldown_sec,
                    log_file: log_file.clone(),
                    plugin_ids: plugin_ids.clone(),
                })?;
                return Ok(());
            }
            daemon::run(daemon::RunArgs {
                app_data,
                version,
                plugins: Arc::clone(&plugins),
                interval_sec,
                threshold_percent,
                cooldown_sec,
                log_file: log_file.clone(),
                plugin_ids: plugin_ids.clone(),
                foreground: !child,
            })?;
        }
    }

    Ok(())
}

fn run_global_daemon(
    app_data: PathBuf,
    version: String,
    plugins: Arc<Vec<LoadedPlugin>>,
    verbose: bool,
) -> Result<()> {
    apply_cli_log_policy(verbose);
    daemon::run(daemon::RunArgs {
        app_data,
        version,
        plugins,
        interval_sec: 30,
        threshold_percent: 85.0,
        cooldown_sec: 3600,
        log_file: None,
        plugin_ids: vec![],
        foreground: true,
    })
}

fn run_dashboard_cmd(
    cli: &Cli,
    cfg: &CliConfig,
    config_path: &PathBuf,
    plugin_ids: &[String],
    app_data: &PathBuf,
    version: &str,
    plugins: &Arc<Vec<LoadedPlugin>>,
    resource_resolution: &ResourceDirResolution,
) -> Result<()> {
    apply_cli_log_policy(cli.verbose);

    let selected_indices: Vec<usize> = if plugin_ids.is_empty() {
        (0..plugins.len()).collect()
    } else {
        let mut out = Vec::new();
        for id in plugin_ids {
            let idx = plugins
                .iter()
                .position(|x| x.manifest.id == *id)
                .with_context(|| format!("Unknown plugin id: {id}"))?;
            out.push(idx);
        }
        out
    };

    if selected_indices.is_empty() {
        eprintln!(
            "No plugins to show.\n{}",
            cu_paths::plugins_empty_diagnostic(resource_resolution)
        );
        return Ok(());
    }

    if cli.json {
        let mut outputs: Vec<PluginOutput> = Vec::new();
        for &idx in &selected_indices {
            let out = batch_probe::run_probe_with_timeout(&plugins[idx], app_data, version, None);
            outputs.push(out);
        }
        println!("{}", serde_json::to_string_pretty(&outputs)?);
    } else {
        let tui_debug = cli.verbose || std::env::var_os("CROSSUSAGE_TUI_DEBUG").is_some();
        let show_picker =
            !cli.no_picker && !cli.no_probe && plugin_ids.is_empty();
        tui::run(
            cfg.clone(),
            config_path.clone(),
            app_data.clone(),
            version.to_string(),
            Arc::clone(plugins),
            selected_indices,
            show_picker,
            cli.no_probe,
            tui_debug,
        )?;
    }
    Ok(())
}

fn run_list_cmd(
    cli: &Cli,
    _cfg: &CliConfig,
    plugin_ids: &[String],
    app_data: &PathBuf,
    version: &str,
    plugins: &Arc<Vec<LoadedPlugin>>,
    plain: bool,
    resource_resolution: &ResourceDirResolution,
) -> Result<()> {
    apply_cli_log_policy(cli.verbose);

    let mut selected: Vec<&LoadedPlugin> = if plugin_ids.is_empty() {
        plugins.iter().collect()
    } else {
        let mut out = Vec::new();
        for id in plugin_ids {
            let p = plugins
                .iter()
                .find(|x| x.manifest.id == *id)
                .with_context(|| format!("Unknown plugin id: {id}"))?;
            out.push(p);
        }
        out
    };

    if plugin_ids.is_empty() {
        selected.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
    }

    if selected.is_empty() {
        eprintln!(
            "No plugins to list.\n{}",
            cu_paths::plugins_empty_diagnostic(resource_resolution)
        );
        return Ok(());
    }

    if cli.json {
        let names: Vec<_> = selected
            .iter()
            .map(|p| serde_json::json!({"id": p.manifest.id, "name": p.manifest.name}))
            .collect();
        println!("{}", serde_json::to_string_pretty(&names)?);
        return Ok(());
    }

    let interrupt = register_batch_interrupt_flag()?;
    let n = selected.len();
    let tmax = batch_probe::probe_timeout_secs();
    eprintln!(
        "crossusage-cli: probing {n} provider(s)…  (up to {tmax}s each — CROSSUSAGE_PROBE_TIMEOUT_SEC; Ctrl+C between probes; not the TUI — `q` does nothing.)"
    );

    let mut rows: Vec<ListUsageRow> = Vec::new();
    for (i, p) in selected.into_iter().enumerate() {
        exit_if_batch_interrupted(&interrupt);
        eprintln!(
            "crossusage-cli:   [{}/{}] {}…",
            i + 1,
            n,
            p.manifest.id
        );
        let out = batch_probe::run_probe_with_timeout(p, app_data, version, Some(&interrupt));
        let m = NormalizedMetricsMapper::from_output(&out);

        let mut input_s = m
            .input_tokens
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".into());
        let mut output_s = m
            .output_tokens
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".into());
        let mut cost_s = m
            .cost
            .map(|c| format!("{:.2}", c))
            .unwrap_or_else(|| "—".into());

        if p.manifest.id == "cursor" {
            if let Some(mtd) = cursor_token_usage::fetch_cursor_month_to_date_totals() {
                input_s = cursor_token_usage::format_token_count(mtd.input_tokens);
                output_s = cursor_token_usage::format_token_count(mtd.output_tokens);
                cost_s = format!("{:.2}", mtd.cost_usd);
            }
        }

        rows.push(ListUsageRow {
            id: p.manifest.id.clone(),
            name: p.manifest.name.clone(),
            primary: format!("{:.0}%", m.primary_percent),
            quota: m
                .list_quota_summary
                .clone()
                .unwrap_or_else(|| "—".into()),
            input: input_s,
            output: output_s,
            cost: cost_s,
        });
    }

    sort_list_rows_by_id(&mut rows);

    if !plain {
        print_banner(plain);
    }
    print_list_table_responsive(&rows);
    Ok(())
}

fn print_list_table_responsive(rows: &[ListUsageRow]) {
    let w = cli_width::terminal_width();
    match cli_width::list_layout_for_width(w) {
        CliTableLayout::Stacked => print_list_stacked(rows, w as usize),
        CliTableLayout::Full => {
            let mut table = Table::new(rows);
            table.with(Style::rounded());
            println!("{table}");
        }
        // Kept for exhaustive match; list_layout_for_width only returns Stacked | Full.
        CliTableLayout::Compact => print_list_stacked(rows, w as usize),
    }
}

fn print_list_stacked(rows: &[ListUsageRow], term_width: usize) {
    let text_w = term_width.saturating_sub(4).max(20);
    let rule_len = (term_width.saturating_sub(2)).clamp(12, 72);
    let rule: String = std::iter::repeat('-').take(rule_len).collect();
    for (i, r) in rows.iter().enumerate() {
        if i > 0 {
            println!("{rule}");
        }
        println!("{}  ·  {}  ·  primary {}", r.id, r.name, r.primary);
        if r.quota != "—" {
            let block = format!("Quota: {}", r.quota);
            for line in cli_width::wrap_plain(&block, text_w).lines() {
                println!("  {line}");
            }
        } else {
            println!("  Quota: —");
        }
        println!(
            "  input: {}  output: {}  cost: {}",
            r.input, r.output, r.cost
        );
        println!();
    }
}

fn run_probe_cmd(
    plugin_ids: &[String],
    human: bool,
    app_data: &PathBuf,
    version: &str,
    plugins: &Arc<Vec<LoadedPlugin>>,
    plain: bool,
    verbose: bool,
    resource_resolution: &ResourceDirResolution,
) -> Result<()> {
    apply_cli_log_policy(verbose);

    let selected: Vec<&LoadedPlugin> = if plugin_ids.is_empty() {
        plugins.iter().collect()
    } else {
        let mut out = Vec::new();
        for id in plugin_ids {
            let p = plugins
                .iter()
                .find(|x| x.manifest.id == *id)
                .with_context(|| format!("Unknown plugin id: {id}"))?;
            out.push(p);
        }
        out
    };

    if selected.is_empty() {
        eprintln!(
            "No plugins to probe.\n{}",
            cu_paths::plugins_empty_diagnostic(resource_resolution)
        );
        return Ok(());
    }

    let interrupt = register_batch_interrupt_flag()?;
    let n = selected.len();
    let tmax = batch_probe::probe_timeout_secs();
    eprintln!(
        "crossusage-cli: probing {n} provider(s)…  (up to {tmax}s each — CROSSUSAGE_PROBE_TIMEOUT_SEC; Ctrl+C between probes; not the TUI — `q` does nothing.)"
    );

    let mut outputs: Vec<PluginOutput> = Vec::new();
    for (i, plugin) in selected.into_iter().enumerate() {
        exit_if_batch_interrupted(&interrupt);
        eprintln!(
            "crossusage-cli:   [{}/{}] {}…",
            i + 1,
            n,
            plugin.manifest.id
        );
        log::info!("Probing {}", plugin.manifest.id);
        let out = batch_probe::run_probe_with_timeout(plugin, app_data, version, Some(&interrupt));
        outputs.push(out);
    }

    if human {
        print_banner(plain);
        for out in &outputs {
            print_plugin_output(out, plain)?;
        }
    } else {
        println!("{}", serde_json::to_string_pretty(&outputs)?);
    }
    Ok(())
}

fn run_export_cmd(
    export_fmt: ExportFormat,
    from_file: Option<std::path::PathBuf>,
    plugin_ids: Vec<String>,
    app_data: &PathBuf,
    version: &str,
    plugins: &Arc<Vec<LoadedPlugin>>,
    verbose: bool,
    resource_resolution: &ResourceDirResolution,
) -> Result<()> {
    apply_cli_log_policy(verbose);

    let mut records = if let Some(ref path) = from_file {
        history::read_jsonl(path)?
    } else {
        let selected: Vec<&LoadedPlugin> = if plugin_ids.is_empty() {
            plugins.iter().collect()
        } else {
            let mut out = Vec::new();
            for id in &plugin_ids {
                let p = plugins
                    .iter()
                    .find(|x| x.manifest.id == *id)
                    .with_context(|| format!("Unknown plugin id: {id}"))?;
                out.push(p);
            }
            out
        };
        if selected.is_empty() {
            eprintln!(
                "No plugins to export.\n{}",
                cu_paths::plugins_empty_diagnostic(resource_resolution)
            );
            return Ok(());
        }
        let interrupt = register_batch_interrupt_flag()?;
        let n = selected.len();
        let tmax = batch_probe::probe_timeout_secs();
        eprintln!(
            "crossusage-cli: exporting live probe for {n} provider(s)…  (up to {tmax}s each — CROSSUSAGE_PROBE_TIMEOUT_SEC; Ctrl+C between probes.)"
        );
        let mut recs = Vec::new();
        for (i, plugin) in selected.into_iter().enumerate() {
            exit_if_batch_interrupted(&interrupt);
            eprintln!(
                "crossusage-cli:   [{}/{}] {}…",
                i + 1,
                n,
                plugin.manifest.id
            );
            let out =
                batch_probe::run_probe_with_timeout(plugin, app_data, version, Some(&interrupt));
            recs.push(history::record_from_output(&out, Utc::now()));
        }
        recs
    };

    if !plugin_ids.is_empty() && from_file.is_some() {
        let ids: std::collections::HashSet<_> = plugin_ids.iter().cloned().collect();
        records.retain(|r| ids.contains(&r.provider_id));
    }

    match export_fmt {
        ExportFormat::Json => println!("{}", serde_json::to_string_pretty(&records)?),
        ExportFormat::Csv => history::print_csv(&records)?,
    }
    Ok(())
}

#[derive(Tabled)]
struct ListUsageRow {
    id: String,
    name: String,
    primary: String,
    #[tabled(rename = "Quota (per model)")]
    quota: String,
    input: String,
    output: String,
    cost: String,
}

#[derive(Tabled, Clone)]
struct LineRowProbe {
    label: String,
    value: String,
}

fn print_banner(plain: bool) {
    if plain {
        println!("CrossUsage CLI {}", env!("CARGO_PKG_VERSION"));
        println!("Fork: https://github.com/barramee27/crossusage");
        println!("Upstream OpenUsage (Robin Ebers): https://github.com/robinebers/openusage");
    } else {
        println!(
            "{} {}",
            "CrossUsage CLI".bold().cyan(),
            env!("CARGO_PKG_VERSION").dimmed()
        );
        println!("{}", "Fork: github.com/barramee27/crossusage".dimmed());
        println!(
            "{}",
            "Upstream: OpenUsage by Robin Ebers — github.com/robinebers/openusage".dimmed()
        );
        println!();
    }
}

fn print_plugin_output(out: &PluginOutput, plain: bool) -> Result<()> {
    let title = format!("{}  ({})", out.display_name, out.provider_id);
    if plain {
        println!("=== {title} ===");
        if let Some(ref plan) = out.plan {
            println!("Plan: {plan}");
        }
    } else {
        println!("{}", title.bold().green());
        if let Some(ref plan) = out.plan {
            println!("{} {}", "Plan:".dimmed(), plan);
        }
    }

    let mut rows: Vec<LineRowProbe> = Vec::new();
    for line in &out.lines {
        match line {
            MetricLine::Text {
                label,
                value,
                subtitle,
                ..
            } => {
                let mut v = value.clone();
                if let Some(s) = subtitle {
                    v.push_str(&format!(" ({s})"));
                }
                rows.push(LineRowProbe {
                    label: label.clone(),
                    value: v,
                });
            }
            MetricLine::Progress {
                label,
                used,
                limit,
                format,
                resets_at,
                ..
            } => {
                let pct = if *limit > 0.0 {
                    (used / limit) * 100.0
                } else {
                    0.0
                };
                let mut v = match format {
                    ProgressFormat::Percent => format!("{:.1}% ({:.0} / {:.0})", pct, used, limit),
                    ProgressFormat::Dollars => format!("${:.2} / ${:.2}", used, limit),
                    ProgressFormat::Count { suffix } => {
                        format!("{:.0} / {:.0} {}", used, limit, suffix)
                    }
                };
                if let Some(r) = resets_at {
                    let rel = format_resets_at_for_display(r);
                    if !rel.is_empty() {
                        v.push_str(&format!(" · {rel}"));
                    }
                }
                rows.push(LineRowProbe {
                    label: label.clone(),
                    value: v,
                });
            }
            MetricLine::Badge {
                label,
                text,
                subtitle,
                ..
            } => {
                let mut v = text.clone();
                if let Some(s) = subtitle {
                    v.push_str(&format!(" ({s})"));
                }
                rows.push(LineRowProbe {
                    label: label.clone(),
                    value: v,
                });
            }
        }
    }

    if !rows.is_empty() {
        print_probe_human_table(&rows);
    }
    println!();
    Ok(())
}

fn print_probe_human_table(rows: &[LineRowProbe]) {
    let w = cli_width::terminal_width();
    let layout = cli_width::layout_for_width(w);
    let wrap = cli_width::probe_value_column_wrap_chars(w);
    match layout {
        CliTableLayout::Stacked => {
            let tw = (w as usize).saturating_sub(2).max(12);
            for row in rows {
                println!("{}:", row.label);
                for line in cli_width::wrap_plain(&row.value, tw).lines() {
                    println!("  {line}");
                }
            }
        }
        CliTableLayout::Compact => {
            let mut table = Table::new(rows);
            table
                .with(Style::modern())
                .with(
                    Modify::new(Columns::single(1)).with(Width::truncate(wrap).suffix("…")),
                );
            println!("{table}");
        }
        CliTableLayout::Full => {
            let mut table = Table::new(rows);
            table
                .with(Style::rounded())
                .with(
                    Modify::new(Columns::single(1))
                        .with(Width::truncate(wrap.max(40).min(120)).suffix("…")),
                );
            println!("{table}");
        }
    }
}

fn resolve_install_paths() -> Result<cu_paths::CliPaths> {
    cu_paths::resolve_cli_paths().map_err(|e| match e {
        cu_paths::PathsError::NoAppDataDir => anyhow::anyhow!(
            "Could not resolve application data directory (e.g. HOME / XDG_DATA_HOME, or Windows AppData). \
             Setting CROSSUSAGE_RESOURCES does not fix this."
        ),
    })
}
