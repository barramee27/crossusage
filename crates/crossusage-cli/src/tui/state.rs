//! Application state: probe scheduling, selection, UI.

use crossusage_core::plugin_engine::runtime::PluginOutput;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::config::CliConfig;
use crate::history::PercentRing;
use crate::tui::view_model::NormalizedMetricsMapper;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pane {
    List,
    Detail,
    Spark,
}

pub struct AppState {
    pub config_path: PathBuf,
    pub config: CliConfig,
    pub config_path_mtime: Option<std::time::SystemTime>,
    pub selected: usize,
    pub pane: Pane,
    pub help_open: bool,
    /// First full probe batch finished (show full dashboard vs loading screen).
    pub initial_load_complete: bool,
    pub last_config_poll: Instant,
    pub outputs: Vec<PluginOutput>,
    pub last_probe: Vec<Option<Instant>>,
    pub rr_index: usize,
    pub last_full_probe: Instant,
    pub probe_busy: bool,
    pub refreshing: bool,
    pub status_msg: Option<String>,
    pub rings: Vec<PercentRing>,
    /// Background probe batch progress (current, total), if known.
    pub probe_progress: Option<(usize, usize)>,
    /// Spinner frame for status line while probing.
    pub spinner_frame: u8,
    /// Horizontal scroll into chart history (sample index offset).
    pub chart_scroll: usize,
    /// Throttled host metrics (sysinfo).
    pub host_cpu_pct: f32,
    pub host_mem_used_mb: u64,
    pub host_mem_total_mb: u64,
    pub last_sysinfo: Instant,
}

impl AppState {
    pub fn new(
        config_path: PathBuf,
        config: CliConfig,
        initial_outputs: Vec<PluginOutput>,
    ) -> Self {
        let n = initial_outputs.len();
        let now = Instant::now();
        let cap = config.history_capacity;
        let mut rings = Vec::with_capacity(n);
        for o in &initial_outputs {
            let mut r = PercentRing::new(cap);
            let m = NormalizedMetricsMapper::from_output(o);
            r.push_percent(m.primary_percent);
            rings.push(r);
        }
        let meta_mtime = config_path.metadata().ok().and_then(|m| m.modified().ok());
        Self {
            config_path,
            config,
            config_path_mtime: meta_mtime,
            selected: 0,
            pane: Pane::List,
            help_open: false,
            initial_load_complete: false,
            last_config_poll: now,
            last_probe: vec![Some(now); n],
            outputs: initial_outputs,
            rings,
            rr_index: 0,
            last_full_probe: now,
            probe_busy: false,
            refreshing: false,
            status_msg: None,
            probe_progress: None,
            spinner_frame: 0,
            chart_scroll: 0,
            host_cpu_pct: 0.0,
            host_mem_used_mb: 0,
            host_mem_total_mb: 1,
            last_sysinfo: now - Duration::from_secs(10),
        }
    }

    pub fn effective_probe_interval(&self) -> Duration {
        Duration::from_secs(self.config.effective_probe_sec())
    }

    pub fn ui_tick(&self) -> Duration {
        Duration::from_millis(self.config.ui_tick_ms())
    }

    pub fn stale_secs(&self, idx: usize) -> Option<u64> {
        self.last_probe
            .get(idx)
            .copied()
            .flatten()
            .map(|t| t.elapsed().as_secs())
    }

    pub fn cycle_pane(&mut self) {
        self.pane = match self.pane {
            Pane::List => Pane::Detail,
            Pane::Detail => Pane::Spark,
            Pane::Spark => Pane::List,
        };
    }
}
