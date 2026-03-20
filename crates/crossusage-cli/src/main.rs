//! CrossUsage CLI — same plugin engine as the desktop app.
//! Fork: https://github.com/barramee27/crossusage · Upstream OpenUsage: https://github.com/robinebers/openusage

mod dashboard;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use crossusage_core::plugin_engine::{self, manifest::LoadedPlugin};
use crossusage_core::plugin_engine::runtime::{MetricLine, PluginOutput, ProgressFormat};
use owo_colors::OwoColorize;
use std::path::PathBuf;
use tabled::settings::Style;
use tabled::{Table, Tabled};

#[derive(Parser)]
#[command(name = "crossusage-cli")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "CrossUsage — AI subscription usage from the terminal (fork of OpenUsage by Robin Ebers)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Output JSON instead of tables (for scripts)
    #[arg(long, global = true)]
    json: bool,

    /// No ANSI colors
    #[arg(long, global = true)]
    plain: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// List discovered providers (plugins)
    List,
    /// Fetch usage for one or more providers (omit IDs to probe all)
    Probe {
        /// Plugin ids (e.g. cursor, claude). If empty, probes all.
        plugin_ids: Vec<String>,
    },
    /// Full-screen terminal dashboard (probe all or selected providers)
    Dashboard {
        /// Plugin ids (e.g. cursor). If empty, probes all.
        plugin_ids: Vec<String>,
    },
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();

    let cli = Cli::parse();
    let plain = cli.plain;

    let (app_data, resource_dir) = resolve_install_paths()
        .context("Could not resolve app data / resource paths. Set CROSSUSAGE_RESOURCES if needed.")?;

    let version = env!("CARGO_PKG_VERSION").to_string();
    let (_plugin_dir, plugins) = plugin_engine::initialize_plugins(&app_data, &resource_dir);

    match cli.command {
        Commands::List => {
            if cli.json {
                let names: Vec<_> = plugins
                    .iter()
                    .map(|p| serde_json::json!({"id": p.manifest.id, "name": p.manifest.name}))
                    .collect();
                println!("{}", serde_json::to_string_pretty(&names)?);
            } else {
                print_banner(plain);
                let rows: Vec<ListRow> = plugins
                    .iter()
                    .map(|p| ListRow {
                        id: p.manifest.id.clone(),
                        name: p.manifest.name.clone(),
                    })
                    .collect();
                let mut table = Table::new(&rows);
                table.with(Style::rounded());
                println!("{table}");
            }
        }
        Commands::Probe { plugin_ids } => {
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
                eprintln!("No plugins to probe.");
                return Ok(());
            }

            let mut outputs: Vec<PluginOutput> = Vec::new();
            for plugin in selected {
                log::info!("Probing {}", plugin.manifest.id);
                let out = plugin_engine::runtime::run_probe(plugin, &app_data, &version);
                outputs.push(out);
            }

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&outputs)?);
            } else {
                print_banner(plain);
                for out in &outputs {
                    print_plugin_output(out, plain)?;
                }
            }
        }
        Commands::Dashboard { plugin_ids } => {
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
                eprintln!("No plugins to show.");
                return Ok(());
            }

            eprintln!("Probing {} provider(s)…", selected.len());
            let mut outputs: Vec<plugin_engine::runtime::PluginOutput> = Vec::new();
            for plugin in selected {
                let out = plugin_engine::runtime::run_probe(plugin, &app_data, &version);
                outputs.push(out);
            }

            if cli.json {
                println!("{}", serde_json::to_string_pretty(&outputs)?);
            } else {
                dashboard::run(outputs)?;
            }
        }
    }

    Ok(())
}

#[derive(Tabled)]
struct ListRow {
    id: String,
    name: String,
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

/// Match Tauri app paths + dev fallbacks (repo root, env).
fn resolve_install_paths() -> Option<(PathBuf, PathBuf)> {
    if let Some(p) = crossusage_core::paths::resolve_paths() {
        return Some(p);
    }
    None
}
