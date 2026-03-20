//! Full-screen TUI dashboard (htop-style panels) for probe results.

use anyhow::Result;
use crossusage_core::plugin_engine::runtime::{MetricLine, PluginOutput};
use crossterm::event::{self, Event, KeyCode};
use crossterm::execute;
use crossterm::terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode};
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use ratatui::prelude::{Alignment, Color, Line, Modifier, Span, Style};
use ratatui::widgets::{Block, Borders, Gauge, Paragraph};
use ratatui::{Frame, Terminal};
use std::io::{self, stdout};
use std::time::Duration;

struct PanelModel {
    title: String,
    status_ok: bool,
    status_label: String,
    gauge_ratio: f64,
    gauge_label: String,
    detail_lines: Vec<String>,
}

fn panel_from_output(out: &PluginOutput) -> PanelModel {
    let mut status_ok = true;
    let mut status_label = "OK".to_string();
    for line in &out.lines {
        if let MetricLine::Badge { label, .. } = line {
            if label.eq_ignore_ascii_case("error") {
                status_ok = false;
                status_label = "ERR".to_string();
                break;
            }
        }
    }

    let mut gauge_ratio = 0.0_f64;
    let mut gauge_label = "—".to_string();
    for line in &out.lines {
        if let MetricLine::Progress {
            used,
            limit,
            format,
            label,
            ..
        } = line
        {
            if *limit > 0.0 {
                gauge_ratio = (*used / *limit).min(1.0).max(0.0);
            }
            gauge_label = match format {
                crossusage_core::plugin_engine::runtime::ProgressFormat::Percent => {
                    format!("{label} {:.0}%", (*used / *limit) * 100.0)
                }
                crossusage_core::plugin_engine::runtime::ProgressFormat::Dollars => {
                    format!("{label} ${:.2}/${:.2}", used, limit)
                }
                crossusage_core::plugin_engine::runtime::ProgressFormat::Count { suffix } => {
                    format!("{label} {:.0}/{:.0} {}", used, limit, suffix)
                }
            };
            break;
        }
    }

    let mut detail_lines = Vec::new();
    for line in out.lines.iter().take(6) {
        let s = match line {
            MetricLine::Text {
                label, value, subtitle, ..
            } => {
                let mut t = format!("{label}: {value}");
                if let Some(sub) = subtitle {
                    t.push_str(&format!(" ({sub})"));
                }
                t
            }
            MetricLine::Progress {
                label,
                used,
                limit,
                format,
                ..
            } => {
                if *limit > 0.0 {
                    let pct = (*used / *limit) * 100.0;
                    match format {
                        crossusage_core::plugin_engine::runtime::ProgressFormat::Percent => {
                            format!("{label}: {pct:.1}%")
                        }
                        crossusage_core::plugin_engine::runtime::ProgressFormat::Dollars => {
                            format!("{label}: ${:.2} / ${:.2}", used, limit)
                        }
                        crossusage_core::plugin_engine::runtime::ProgressFormat::Count {
                            suffix,
                        } => format!("{label}: {:.0} / {:.0} {}", used, limit, suffix),
                    }
                } else {
                    format!("{label}: —")
                }
            }
            MetricLine::Badge {
                label, text, subtitle, ..
            } => {
                let mut t = format!("{label}: {text}");
                if let Some(sub) = subtitle {
                    t.push_str(&format!(" ({sub})"));
                }
                t
            }
        };
        detail_lines.push(s);
    }

    PanelModel {
        title: format!("{} ({})", out.display_name, out.provider_id),
        status_ok,
        status_label,
        gauge_ratio,
        gauge_label,
        detail_lines,
    }
}

pub fn run(outputs: Vec<PluginOutput>) -> Result<()> {
    let panels: Vec<PanelModel> = outputs.iter().map(panel_from_output).collect();

    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut should_quit = false;
    while !should_quit {
        terminal.draw(|f| render_dashboard(f, &panels))?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => should_quit = true,
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(io::stdout(), LeaveAlternateScreen)?;
    Ok(())
}

fn render_dashboard(f: &mut Frame, panels: &[PanelModel]) {
    let n = panels.len().max(1);
    let cols: usize = 3;
    let rows = (n + cols - 1) / cols;

    let root = f.area();
    let main_and_bar = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(1)])
        .split(root);
    let grid_area = main_and_bar[0];

    let row_constraints: Vec<Constraint> = (0..rows)
        .map(|_| Constraint::Percentage((100 / rows as u16).max(1)))
        .collect();
    let row_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(row_constraints)
        .split(grid_area);

    for row_idx in 0..rows {
        let row_rect = row_chunks[row_idx];
        let col_constraints: Vec<Constraint> = (0..cols)
            .map(|_| Constraint::Percentage((100 / cols as u16).max(1)))
            .collect();
        let col_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints(col_constraints)
            .split(row_rect);

        for col_idx in 0..cols {
            let idx = row_idx * cols + col_idx;
            if idx >= panels.len() {
                continue;
            }
            let p = &panels[idx];
            let area = col_chunks[col_idx];
            render_panel(f, area, p);
        }
    }

    let hint = Paragraph::new(Line::from(vec![
        Span::styled(
            " CrossUsage ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" dashboard — "),
        Span::styled("q", Style::default().fg(Color::Yellow)),
        Span::raw(" quit "),
    ]))
    .alignment(Alignment::Center);
    f.render_widget(hint, main_and_bar[1]);
}

fn render_panel(f: &mut Frame, area: Rect, p: &PanelModel) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(p.title.clone())
        .title_style(
            Style::default()
                .fg(Color::LightCyan)
                .add_modifier(Modifier::BOLD),
        )
        .border_style(Style::default().fg(Color::DarkGray));

    let inner = block.inner(area);
    f.render_widget(block, area);

    let inner = inner.inner(Margin {
        horizontal: 1,
        vertical: 0,
    });

    let status_style = if p.status_ok {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::Red)
    };

    let status_line = Line::from(vec![
        Span::styled(" ● ", status_style),
        Span::styled(
            &p.status_label,
            status_style.add_modifier(Modifier::BOLD),
        ),
    ]);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(3),
            Constraint::Min(2),
        ])
        .split(inner);

    f.render_widget(
        Paragraph::new(status_line).alignment(Alignment::Left),
        chunks[0],
    );

    let gauge = Gauge::default()
        .gauge_style(if p.status_ok {
            Style::default().fg(Color::Green)
        } else {
            Style::default().fg(Color::Red)
        })
        .ratio(p.gauge_ratio.clamp(0.0, 1.0))
        .label(p.gauge_label.clone());
    f.render_widget(gauge, chunks[1]);

    let text: Vec<Line> = p
        .detail_lines
        .iter()
        .map(|s| {
            let t = if s.chars().count() > 80 {
                format!("{}…", s.chars().take(79).collect::<String>())
            } else {
                s.clone()
            };
            Line::from(Span::styled(
                t,
                Style::default().fg(Color::Gray).add_modifier(Modifier::ITALIC),
            ))
        })
        .collect();
    f.render_widget(Paragraph::new(text).wrap(ratatui::widgets::Wrap { trim: true }), chunks[2]);
}
