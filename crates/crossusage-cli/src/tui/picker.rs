//! Interactive checkbox list: choose which providers to load before the dashboard.

use std::io::{stdout, Stdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use crossusage_core::plugin_engine::manifest::LoadedPlugin;
use crossterm::cursor::{Hide, Show};
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::layout::{Alignment, Constraint, Direction, Layout};
use ratatui::prelude::*;
use ratatui::style::Modifier;
use ratatui::text::Line;
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};

use crate::config::CliConfig;
use crate::tui::theme::{Theme, ThemePreset};

fn restore_picker_terminal(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    let t = terminal.backend_mut();
    let _ = execute!(t, LeaveAlternateScreen, Show);
    disable_raw_mode().context("disable_raw_mode picker")?;
    Ok(())
}

/// Arrow keys move, Enter toggles `[x]` on a provider row; last row is **Continue** (Enter to confirm).
/// Returns the subset of `candidate_indices` that stayed checked (at least one required).
pub fn run_provider_picker(
    plugins: &Arc<Vec<LoadedPlugin>>,
    candidate_indices: &[usize],
    shutdown: &Arc<AtomicBool>,
    config: &CliConfig,
) -> Result<Vec<usize>> {
    let len_plugins = candidate_indices.len();
    if len_plugins == 0 {
        return Ok(vec![]);
    }

    let continue_row = len_plugins; // cursor index for "Continue"
    let mut selected: Vec<bool> = vec![true; len_plugins];
    let mut cursor: usize = 0;
    // First visible provider index when the list is taller than the terminal.
    let mut scroll_top: usize = 0;
    let mut status_msg: Option<String> = None;

    enable_raw_mode().context("enable_raw_mode picker")?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen, Hide).context("enter alt screen picker")?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;
    let theme = Theme::from_preset(ThemePreset::parse(&config.theme));

    let run_result = (|| -> Result<Vec<usize>> {
        loop {
            if shutdown.load(Ordering::SeqCst) {
                anyhow::bail!("Interrupted");
            }

            terminal.draw(|f| {
                let size = f.area();
                let block = Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(theme.border))
                    .title(Span::styled(" CrossUsage — select providers ", theme.title));
                let inner = block.inner(size);
                f.render_widget(block, size);

                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(2),
                        Constraint::Min(0), // list fills all space down to Continue
                        Constraint::Length(2),
                        Constraint::Length(1),
                    ])
                    .split(inner);

                let help = Paragraph::new(
                    "↑↓ move  ·  Enter / Space toggle  ·  Enter on Continue  ·  q cancel",
                )
                .style(Style::default().fg(theme.muted))
                .alignment(Alignment::Center);
                f.render_widget(help, chunks[0]);

                // Rows that fit in the list block (borders + one title line, like the final block).
                let visible = {
                    let b = Block::default()
                        .borders(Borders::ALL)
                        .title(Line::from("-"))
                        .inner(chunks[1]);
                    (b.height as usize).max(1)
                };

                if len_plugins <= visible {
                    scroll_top = 0;
                } else if cursor < len_plugins {
                    if cursor < scroll_top {
                        scroll_top = cursor;
                    }
                    if cursor >= scroll_top + visible {
                        scroll_top = cursor + 1 - visible;
                    }
                    let max_scroll = len_plugins - visible;
                    scroll_top = scroll_top.min(max_scroll);
                }

                let window_end = (scroll_top + visible).min(len_plugins);

                let title_line = if len_plugins > visible {
                    Line::from(vec![
                        Span::styled(" Providers ", theme.title),
                        Span::styled(
                            format!(
                                " (rows {}–{} of {}) ",
                                scroll_top + 1,
                                window_end,
                                len_plugins
                            ),
                            Style::default().fg(theme.muted),
                        ),
                    ])
                } else {
                    Line::from(Span::styled(" Providers ", theme.title))
                };

                let list_block = Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(theme.border))
                    .title(title_line);
                let list_inner = list_block.inner(chunks[1]);
                f.render_widget(list_block, chunks[1]);
                let items: Vec<ListItem> = (scroll_top..window_end)
                    .map(|i| {
                        let idx = candidate_indices[i];
                        let p = &plugins[idx];
                        let chk = if selected[i] { "[x]" } else { "[ ]" };
                        let line = format!(" {chk}  {}  ({})", p.manifest.name, p.manifest.id);
                        let style = if cursor == i {
                            Style::default()
                                .bg(theme.accent)
                                .fg(theme.bg)
                                .add_modifier(Modifier::BOLD)
                        } else {
                            Style::default().fg(theme.fg)
                        };
                        ListItem::new(line).style(style)
                    })
                    .collect();
                let list = List::new(items);
                f.render_widget(list, list_inner);

                let cont_line = if cursor == continue_row {
                    "  ▸ Continue  "
                } else {
                    "    Continue  "
                };
                let cont_style = if cursor == continue_row {
                    Style::default()
                        .fg(theme.bg)
                        .bg(theme.good)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(theme.muted)
                };
                let cont_p = Paragraph::new(cont_line)
                    .style(cont_style)
                    .alignment(Alignment::Center);
                f.render_widget(cont_p, chunks[2]);

                let st = status_msg.as_deref().unwrap_or("");
                let foot = Paragraph::new(st)
                    .style(Style::default().fg(theme.warn))
                    .alignment(Alignment::Center);
                f.render_widget(foot, chunks[3]);
            })?;

            if !event::poll(Duration::from_millis(75))? {
                continue;
            }
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => match key.code {
                    KeyCode::Char('q') | KeyCode::Char('Q') | KeyCode::Esc => {
                        anyhow::bail!("Provider selection cancelled (q). Use --no-picker to skip this screen.");
                    }
                    KeyCode::Up => {
                        cursor = cursor.saturating_sub(1);
                        status_msg = None;
                    }
                    KeyCode::Down => {
                        cursor = (cursor + 1).min(continue_row);
                        status_msg = None;
                    }
                    KeyCode::Enter | KeyCode::Char(' ') => {
                        if cursor < len_plugins {
                            selected[cursor] = !selected[cursor];
                            status_msg = None;
                        } else {
                            let mut out_idx = Vec::new();
                            for (i, &on) in selected.iter().enumerate() {
                                if on {
                                    out_idx.push(candidate_indices[i]);
                                }
                            }
                            if out_idx.is_empty() {
                                status_msg = Some(
                                    "Check at least one provider, or press q to quit.".into(),
                                );
                            } else {
                                return Ok(out_idx);
                            }
                        }
                    }
                    _ => {}
                },
                _ => {}
            }
        }
    })();

    restore_picker_terminal(&mut terminal)?;
    run_result
}
