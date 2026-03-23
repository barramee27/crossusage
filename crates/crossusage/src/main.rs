//! CrossUsage CLI — same plugin engine as the desktop app.
//! Fork: https://github.com/barramee27/crossusage · Upstream OpenUsage: https://github.com/robinebers/openusage

mod batch_probe;
mod config;
mod daemon;
mod history;
mod panic_hook;
mod tui;

use anyhow::{bail, Context, Result};
use chrono::Utc;
use clap::{Parser, Subcommand, ValueEnum};
use crossusage_core::plugin_engine::runtime::{MetricLine, PluginOutput, ProgressFormat};
use crossusage_core::plugin_engine::{self, manifest::LoadedPlugin};
use owo_colors::OwoColorize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tabled::settings::Style;
use tabled::{Table, Tabled};

use crate::config::CliConfig;
use crate::tui::view_model::NormalizedMetricsMapper;

#[derive(Parser)]
#[command(name = "crossusage")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "CrossUsage — AI subscription usage from the terminal (Rust; same plugin engine as the GUI)")]
#[command(
    after_long_help = "NOTE: --daemon runs background polling only and cannot be combined with a subcommand. For advanced daemon options use: crossusage daemon --help. Legacy binary name: crossusage-cli."
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

fn sort_list_rows_by_id(rows: &mut Vec<ListUsageRow>) {
    rows.sort_by(|a, b| a.id.cmp(&b.id));
}

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
        eprintln!("\ncrossusage: interrupted");
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

    let (app_data, resource_dir) = resolve_install_paths().context(
        "Could not resolve app data / resource paths. Set CROSSUSAGE_RESOURCES if needed.",
    )?;

    let version = env!("CARGO_PKG_VERSION").to_string();
    let (_plugin_dir, plugins) = plugin_engine::initialize_plugins(&app_data, &resource_dir);
    let plugins = Arc::new(plugins);

    let config_path = CliConfig::resolve_path(cli.config.clone());
    let mut cfg = CliConfig::load_from_path(&config_path);
    cfg = cfg.merge_cli_overrides(cli.theme.as_deref(), cli.refresh_sec, cli.no_mouse);

    if cli.daemon {
        if plugins.is_empty() {
            bail!("No plugins discovered; nothing to watch.");
        }
        return run_global_daemon(app_data, version, Arc::clone(&plugins), cli.verbose);
    }

    match cli.command {
        None => {
            run_dashboard_cmd(&cli, &cfg, &config_path, &[], &app_data, &version, &plugins)?;
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
            )?;
        }
        Some(Commands::List { ref plugin_ids }) => {
            run_list_cmd(&cli, &cfg, plugin_ids, &app_data, &version, &plugins, plain)?;
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
                    bail!("No plugins discovered; nothing to watch.");
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
        eprintln!("No plugins to show.");
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
        tui::run(
            cfg.clone(),
            config_path.clone(),
            app_data.clone(),
            version.to_string(),
            Arc::clone(plugins),
            selected_indices,
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
        eprintln!("No plugins to list.");
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
    eprintln!(
        "crossusage: probing {n} provider(s)…  (Ctrl+C to cancel; not the TUI — `q` does nothing here.)"
    );

    let mut rows: Vec<ListUsageRow> = Vec::new();
    for (i, p) in selected.into_iter().enumerate() {
        exit_if_batch_interrupted(&interrupt);
        eprintln!("crossusage:   [{}/{}] {}…", i + 1, n, p.manifest.id);
        let out = batch_probe::run_probe_with_timeout(p, app_data, version, Some(&interrupt));
        let m = NormalizedMetricsMapper::from_output(&out);
        rows.push(ListUsageRow {
            id: p.manifest.id.clone(),
            name: p.manifest.name.clone(),
            primary: format!("{:.0}%", m.primary_percent),
            quota: m
                .list_quota_summary
                .clone()
                .unwrap_or_else(|| "—".into()),
            input: m
                .input_tokens
                .map(|n| n.to_string())
                .unwrap_or_else(|| "—".into()),
            output: m
                .output_tokens
                .map(|n| n.to_string())
                .unwrap_or_else(|| "—".into()),
            cost: m
                .cost
                .map(|c| format!("{:.2}", c))
                .unwrap_or_else(|| "—".into()),
        });
    }

    sort_list_rows_by_id(&mut rows);

    if !plain {
        print_banner(plain);
    }
    let mut table = Table::new(&rows);
    table.with(Style::rounded());
    println!("{table}");
    Ok(())
}

fn run_probe_cmd(
    plugin_ids: &[String],
    human: bool,
    app_data: &PathBuf,
    version: &str,
    plugins: &Arc<Vec<LoadedPlugin>>,
    plain: bool,
    verbose: bool,
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
        eprintln!("No plugins to probe.");
        return Ok(());
    }

    let interrupt = register_batch_interrupt_flag()?;
    let n = selected.len();
    eprintln!(
        "crossusage: probing {n} provider(s)…  (Ctrl+C to cancel; not the TUI — `q` does nothing here.)"
    );

    let mut outputs: Vec<PluginOutput> = Vec::new();
    for (i, plugin) in selected.into_iter().enumerate() {
        exit_if_batch_interrupted(&interrupt);
        eprintln!(
            "crossusage:   [{}/{}] {}…",
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
            eprintln!("No plugins to export.");
            return Ok(());
        }
        let interrupt = register_batch_interrupt_flag()?;
        let n = selected.len();
        eprintln!(
            "crossusage: exporting live probe for {n} provider(s)…  (Ctrl+C to cancel.)"
        );
        let mut recs = Vec::new();
        for (i, plugin) in selected.into_iter().enumerate() {
            exit_if_batch_interrupted(&interrupt);
            eprintln!(
                "crossusage:   [{}/{}] {}…",
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

    #[derive(Tabled)]
    struct LineRow {
        label: String,
        value: String,
    }

    let mut rows: Vec<LineRow> = Vec::new();
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
                rows.push(LineRow {
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
                    v.push_str(&format!(" · resets {r}"));
                }
                rows.push(LineRow {
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
                rows.push(LineRow {
                    label: label.clone(),
                    value: v,
                });
            }
        }
    }

    if !rows.is_empty() {
        let mut table = Table::new(&rows);
        table.with(Style::rounded());
        println!("{table}");
    }
    println!();
    Ok(())
}

fn resolve_install_paths() -> Option<(PathBuf, PathBuf)> {
    crossusage_core::paths::resolve_paths()
}
