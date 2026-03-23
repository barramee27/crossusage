//! CLI configuration — `~/.config/crossusage/config.toml` (or `--config` path)

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliConfig {
    /// Seconds between data probe cycles (ignored for effective probe when `low_power_mode` forces 10s).
    #[serde(default = "default_refresh_sec")]
    pub refresh_sec: u64,
    /// When true: 10s probes, 2s UI redraws, no animated transitions.
    #[serde(default)]
    pub low_power_mode: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub mouse: bool,
    /// Left / center / right pane width ratios (sum should be 100).
    #[serde(default = "default_pane_ratios")]
    pub pane_ratios: [u16; 3],
    /// Sparkline / ring buffer depth (per provider) in the dashboard.
    #[serde(default = "default_history_capacity")]
    pub history_capacity: usize,
    /// Append each successful probe snapshot as JSONL under the data-local dir (see `history::history_jsonl_path`).
    #[serde(default)]
    pub persist_history: bool,
}

fn default_refresh_sec() -> u64 {
    3
}

fn default_theme() -> String {
    "dark".into()
}

fn default_true() -> bool {
    true
}

fn default_pane_ratios() -> [u16; 3] {
    [22, 48, 30]
}

fn default_history_capacity() -> usize {
    120
}

impl Default for CliConfig {
    fn default() -> Self {
        Self {
            refresh_sec: default_refresh_sec(),
            low_power_mode: false,
            theme: default_theme(),
            mouse: default_true(),
            pane_ratios: default_pane_ratios(),
            history_capacity: default_history_capacity(),
            persist_history: false,
        }
    }
}

impl CliConfig {
    pub fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("crossusage")
            .join("config.toml")
    }

    /// Default path or `--config` override.
    pub fn resolve_path(override_path: Option<PathBuf>) -> PathBuf {
        override_path.unwrap_or_else(|| Self::config_path())
    }

    /// Load from default XDG path (see `config_path`).
    #[allow(dead_code)]
    pub fn load() -> Self {
        Self::load_from_path(&Self::config_path())
    }

    pub fn load_from_path(path: &Path) -> Self {
        if !path.exists() {
            return Self::default();
        }
        match std::fs::read_to_string(path)
            .ok()
            .and_then(|s| toml::from_str::<CliConfig>(&s).ok())
        {
            Some(c) => c,
            None => Self::default(),
        }
    }

    /// Merge session overrides from CLI (non-None fields win).
    pub fn merge_cli_overrides(
        mut self,
        theme: Option<&str>,
        refresh_sec: Option<u64>,
        no_mouse: bool,
    ) -> Self {
        if let Some(t) = theme {
            if !t.is_empty() {
                self.theme = t.to_string();
            }
        }
        if let Some(r) = refresh_sec {
            self.refresh_sec = r.max(1);
        }
        if no_mouse {
            self.mouse = false;
        }
        self
    }

    pub fn save_to(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create_dir_all {:?}", parent))?;
        }
        let s = toml::to_string_pretty(self).context("serialize config")?;
        std::fs::write(path, s).with_context(|| format!("write {:?}", path))?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn save(&self) -> Result<()> {
        self.save_to(&Self::config_path())
    }

    pub fn effective_probe_sec(&self) -> u64 {
        if self.low_power_mode {
            10
        } else {
            self.refresh_sec.max(1)
        }
    }

    pub fn ui_tick_ms(&self) -> u64 {
        if self.low_power_mode {
            2000
        } else {
            500
        }
    }
}
