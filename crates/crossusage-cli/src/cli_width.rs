//! Terminal width detection and responsive table layout thresholds.

use std::io::{self, IsTerminal};

/// Below this width, `probe --human` uses stacked lines; between this and [WIDTH_FULL_TABLE_AT] it uses a
/// **single-line** compact table with truncation (never multi-line wrap — that breaks ASCII borders).
pub const WIDTH_STACKED_BELOW: u16 = 100;
/// At or above this width, ASCII tables (`list` full grid, `probe --human` full, `usage-stats` full) are used.
/// Kept **high** so typical 80–120 col terminals stay on **stacked** / compact layouts without flags or `$COLUMNS=`.
pub const WIDTH_FULL_TABLE_AT: u16 = 140;
/// Default when not a TTY and `COLUMNS` is unset.
pub const DEFAULT_COLUMNS: u16 = 80;
/// Minimum width used for calculations (avoid degenerate wraps).
pub const MIN_TERM_WIDTH: u16 = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliTableLayout {
    /// Full `Style::rounded()`, no forced cell wrap (wide terminals).
    Full,
    /// `Style::modern()` + **truncate** long cells (never multi-line wrap).
    Compact,
    /// One record per block, no wide table.
    Stacked,
}

/// Best-effort terminal width: **minimum** of ioctl (`TIOCGWINSZ`), crossterm, and `$COLUMNS` when set.
///
/// Using the smallest value avoids picking a too-wide layout when sources disagree (resize lag, IDE quirks).
/// No CLI flags required — shells often set `$COLUMNS` automatically after resize.
pub fn terminal_width() -> u16 {
    let mut widths: Vec<u16> = Vec::new();

    #[cfg(unix)]
    if let Some(w) = unix_term_cols_ioctl() {
        widths.push(w);
    }

    if io::stdout().is_terminal() {
        if let Ok((w, _)) = crossterm::terminal::size() {
            widths.push(w);
        }
    }

    if let Ok(s) = std::env::var("COLUMNS") {
        if let Ok(c) = s.parse::<u16>() {
            if c >= MIN_TERM_WIDTH {
                widths.push(c);
            }
        }
    }

    let w = if widths.is_empty() {
        DEFAULT_COLUMNS
    } else {
        widths.into_iter().min().expect("widths non-empty")
    };

    w.max(MIN_TERM_WIDTH)
}

/// `TIOCGWINSZ` on stdout and stderr (either may be the controlling TTY when the other is redirected).
#[cfg(unix)]
fn unix_term_cols_ioctl() -> Option<u16> {
    use libc::{ioctl, winsize, TIOCGWINSZ};
    use std::os::unix::io::AsRawFd;

    let mut best: Option<u16> = None;
    let stdout = std::io::stdout();
    let stderr = std::io::stderr();
    for fd in [stdout.as_raw_fd(), stderr.as_raw_fd()] {
        if fd < 0 {
            continue;
        }
        let col = unsafe {
            let mut ws: winsize = std::mem::zeroed();
            if ioctl(fd, TIOCGWINSZ, &mut ws as *mut _) == 0 && ws.ws_col > 0 {
                Some(ws.ws_col as u16)
            } else {
                None
            }
        };
        if let Some(c) = col {
            best = Some(match best {
                None => c,
                Some(b) => b.min(c),
            });
        }
    }
    best
}

pub fn layout_for_width(w: u16) -> CliTableLayout {
    if w < WIDTH_STACKED_BELOW {
        CliTableLayout::Stacked
    } else if w < WIDTH_FULL_TABLE_AT {
        CliTableLayout::Compact
    } else {
        CliTableLayout::Full
    }
}

/// `crossusage-cli list`: avoid wrapped multi-line cells in ASCII tables — they misalign borders.
/// Use plain stacked blocks below [WIDTH_FULL_TABLE_AT], full table at or above it.
pub fn list_layout_for_width(w: u16) -> CliTableLayout {
    if w < WIDTH_FULL_TABLE_AT {
        CliTableLayout::Stacked
    } else {
        CliTableLayout::Full
    }
}

/// `usage-stats` summary tables: same rule as [list_layout_for_width] (wrapped grids are unreadable when narrow).
pub fn usage_stats_layout_for_width(w: u16) -> CliTableLayout {
    list_layout_for_width(w)
}

/// Max width for probe `--human` value column when using single-line truncation.
pub fn probe_value_column_wrap_chars(term_w: u16) -> usize {
    let w = term_w as usize;
    w.saturating_sub(22).max(8).min(100)
}

/// Word-wrap plain text for stacked `list` / `usage-stats` output.
pub fn wrap_plain(text: &str, width: usize) -> String {
    let w = width.max(8);
    textwrap::fill(text, w)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_buckets() {
        assert_eq!(layout_for_width(40), CliTableLayout::Stacked);
        assert_eq!(layout_for_width(99), CliTableLayout::Stacked);
        assert_eq!(layout_for_width(100), CliTableLayout::Compact);
        assert_eq!(layout_for_width(119), CliTableLayout::Compact);
        assert_eq!(layout_for_width(139), CliTableLayout::Compact);
        assert_eq!(layout_for_width(140), CliTableLayout::Full);
        assert_eq!(layout_for_width(200), CliTableLayout::Full);
    }

    #[test]
    fn list_and_usage_stats_stack_until_wide_enough_for_table() {
        assert_eq!(list_layout_for_width(139), CliTableLayout::Stacked);
        assert_eq!(list_layout_for_width(140), CliTableLayout::Full);
        assert_eq!(usage_stats_layout_for_width(139), CliTableLayout::Stacked);
    }

    #[test]
    fn columns_env_fallback() {
        // When not in TTY in tests, COLUMNS may or may not be set — just ensure functions return sane values.
        let w = terminal_width();
        assert!(w >= MIN_TERM_WIDTH);
    }
}
