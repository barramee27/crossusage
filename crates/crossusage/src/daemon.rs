//! Background polling + desktop notifications when usage crosses a threshold.
//! No tray icon — terminal-focused binary only.

use anyhow::{Context, Result};
use crossusage_core::plugin_engine::manifest::LoadedPlugin;
use crossusage_core::plugin_engine::runtime;
use notify_rust::Notification;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::tui::view_model::NormalizedMetricsMapper;

/// Forwarded to the detached child process.
pub struct SpawnArgs {
    pub interval_sec: u64,
    pub threshold_percent: f64,
    pub cooldown_sec: u64,
    pub log_file: Option<PathBuf>,
    pub plugin_ids: Vec<String>,
}

pub struct RunArgs {
    pub app_data: PathBuf,
    pub version: String,
    pub plugins: Arc<Vec<LoadedPlugin>>,
    pub interval_sec: u64,
    pub threshold_percent: f64,
    pub cooldown_sec: u64,
    pub log_file: Option<PathBuf>,
    pub plugin_ids: Vec<String>,
    /// If true, stdout is the terminal (user ran `daemon` without `--detach`).
    pub foreground: bool,
}

pub fn spawn_detached(args: SpawnArgs) -> Result<()> {
    let exe = std::env::current_exe().context("resolve current executable")?;
    let mut cmd = Command::new(exe);
    cmd.arg("daemon").arg("--child");
    cmd.arg("--interval-sec").arg(args.interval_sec.to_string());
    cmd.arg("--threshold-percent")
        .arg(format!("{}", args.threshold_percent));
    cmd.arg("--cooldown-sec").arg(args.cooldown_sec.to_string());
    if let Some(ref p) = args.log_file {
        cmd.arg("--log-file").arg(p);
    }
    for id in &args.plugin_ids {
        cmd.arg(id);
    }

    cmd.stdin(Stdio::null());
    #[cfg(unix)]
    {
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
    }

    let child = cmd.spawn().context("spawn daemon child")?;
    eprintln!(
        "crossusage-cli: background daemon started (pid {}). Log: {}",
        child.id(),
        args.log_file
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "(none; use --log-file with --detach)".into())
    );
    Ok(())
}

pub fn run(args: RunArgs) -> Result<()> {
    let selected: Vec<&LoadedPlugin> = if args.plugin_ids.is_empty() {
        args.plugins.iter().collect()
    } else {
        let mut out = Vec::new();
        for id in &args.plugin_ids {
            let p = args
                .plugins
                .iter()
                .find(|x| x.manifest.id == *id)
                .with_context(|| format!("Unknown plugin id: {id}"))?;
            out.push(p);
        }
        out
    };

    if selected.is_empty() {
        anyhow::bail!("No plugins to watch.");
    }

    if args.foreground {
        eprintln!(
            "crossusage-cli daemon: watching {} provider(s), every {}s (threshold {:.0}%, cooldown {}s). Ctrl+C to stop.",
            selected.len(),
            args.interval_sec,
            args.threshold_percent,
            args.cooldown_sec
        );
    }

    let mut last_notify: HashMap<String, Instant> = HashMap::new();
    let sleep = Duration::from_secs(args.interval_sec.max(5));

    loop {
        for plugin in &selected {
            let out = runtime::run_probe(plugin, &args.app_data, &args.version);
            let m = NormalizedMetricsMapper::from_output(&out);

            if m.primary_percent + f64::EPSILON < args.threshold_percent {
                continue;
            }

            let cooldown = Duration::from_secs(args.cooldown_sec.max(60));
            let now = Instant::now();
            let allow = last_notify
                .get(&out.provider_id)
                .map(|t| now.duration_since(*t) >= cooldown)
                .unwrap_or(true);

            if !allow {
                continue;
            }

            let title = format!("{} — high usage", out.display_name);
            let body = format!(
                "Primary usage ~ {:.0}% (threshold {:.0}%).",
                m.primary_percent, args.threshold_percent
            );

            match Notification::new()
                .summary(&title)
                .body(&body)
                .appname("crossusage-cli")
                .show()
            {
                Ok(handle) => {
                    log::info!("notification id {:?}", handle);
                    last_notify.insert(out.provider_id.clone(), now);
                }
                Err(e) => {
                    log::warn!("desktop notification failed (headless session?): {e}");
                    append_log(
                        args.log_file.as_deref(),
                        &format!("[WARN] notify failed for {}: {e}\n", out.provider_id),
                    )?;
                }
            }

            if args.foreground {
                eprintln!(
                    "[daemon] alert: {} ~ {:.0}%",
                    out.display_name, m.primary_percent
                );
            }
        }

        append_log(
            args.log_file.as_deref(),
            &format!(
                "[{}] polled {} plugins OK\n",
                chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC"),
                selected.len()
            ),
        )?;

        std::thread::sleep(sleep);
    }
}

fn append_log(path: Option<&Path>, line: &str) -> Result<()> {
    let Some(path) = path else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create_dir_all {:?}", parent))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("open log {:?}", path))?;
    f.write_all(line.as_bytes())
        .with_context(|| format!("write log {:?}", path))?;
    Ok(())
}
