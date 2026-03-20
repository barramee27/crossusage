//! Full-screen TUI dashboard — dense grid panels (Gruvbox-style, htop-like).

use anyhow::Result;
use chrono::Local;
use crossusage_core::plugin_engine::runtime::{MetricLine, PluginOutput};
use crossterm::event::{self, Event, KeyCode};
use crossterm::execute;
use crossterm::terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode};
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use ratatui::prelude::{Alignment, Color, Line, Modifier, Span, Style};
use ratatui::widgets::{Block, Borders, Gauge, Paragraph};
use ratatui::{Frame, Terminal};
use std::io::{self, stdout, IsTerminal, Write};
use std::time::Duration;

// Gruvbox-inspired (dark)
const CLR_BG: Color = Color::Rgb(40, 40, 40);
const CLR_FG: Color = Color::Rgb(235, 219, 178);
const CLR_DIM: Color = Color::Rgb(146, 131, 116);
const CLR_YLW: Color = Color::Rgb(250, 189, 47);
const CLR_GRN: Color = Color::Rgb(184, 187, 38);
const CLR_RED: Color = Color::Rgb(251, 73, 52);
const CLR_AQUA: Color = Color::Rgb(131, 165, 152);
const CLR_ORG: Color = Color::Rgb(254, 128, 25);
const CLR_BRDR: Color = Color::Rgb(80, 73, 69);
const CLR_GAUGE_BG: Color = Color::Rgb(50, 48, 45);

#[derive(Clone, Copy, PartialEq)]
enum PanelStatus {
    Ok,
    Limit,
    Error,
}

struct PanelModel {
    slug: String,
    display: String,
    plan: Option<String>,
    status: PanelStatus,
    progresses: Vec<(f64, String)>,
    detail_rows: Vec<(String, String, Color)>,
}

fn panel_from_output(out: &PluginOutput) -> PanelModel {
    let slug = out.provider_id.to_lowercase().replace(' ', "-");

    let mut status = PanelStatus::Ok;
    for line in &out.lines {
        if let MetricLine::Badge { label, .. } = line {
            if label.eq_ignore_ascii_case("error") {
                status = PanelStatus::Error;
                break;
            }
        }
    }

    let mut progresses: Vec<(f64, String)> = Vec::new();
    for line in &out.lines {
        if let MetricLine::Progress {
            used,
            limit,
            format,
            label,
            ..
        } = line
        {
            let ratio = if *limit > 0.0 {
                (*used / *limit).min(1.0).max(0.0)
            } else {
                0.0
            };
            let lbl = match format {
                crossusage_core::plugin_engine::runtime::ProgressFormat::Percent => {
                    format!("{}  {:.0}% · quota", label, ratio * 100.0)
                }
                crossusage_core::plugin_engine::runtime::ProgressFormat::Dollars => {
                    format!("{}  ${:.2} / ${:.2}", label, used, limit)
                }
                crossusage_core::plugin_engine::runtime::ProgressFormat::Count { suffix } => {
                    format!("{}  {:.0} / {:.0} {}", label, used, limit, suffix)
                }
            };
            progresses.push((ratio, lbl));
            if progresses.len() >= 2 {
                break;
            }
        }
    }

    if status == PanelStatus::Ok {
        if let Some((r, _)) = progresses.first() {
            if *r >= 0.88 {
                status = PanelStatus::Limit;
            }
        }
    }

    let mut detail_rows: Vec<(String, String, Color)> = Vec::new();
    let accent = [CLR_AQUA, CLR_ORG, CLR_YLW, CLR_GRN];
    let mut ai = 0usize;
    for line in &out.lines {
        if detail_rows.len() >= 8 {
            break;
        }
        match line {
            MetricLine::Text {
                label,
                value,
                subtitle,
                ..
            } => {
                let mut v = value.clone();
                if let Some(s) = subtitle {
                    v.push_str(&format!(" · {s}"));
                }
                let c = accent[ai % accent.len()];
                ai += 1;
                detail_rows.push((label.clone(), v, c));
            }
            MetricLine::Progress {
                label,
                used,
                limit,
                format,
                ..
            } => {
                if *limit <= 0.0 {
                    continue;
                }
                let pct = (*used / *limit) * 100.0;
                let v = match format {
                    crossusage_core::plugin_engine::runtime::ProgressFormat::Percent => {
                        format!("{pct:.1}%")
                    }
                    crossusage_core::plugin_engine::runtime::ProgressFormat::Dollars => {
                        format!("${:.2} / ${:.2}", used, limit)
                    }
                    crossusage_core::plugin_engine::runtime::ProgressFormat::Count { suffix } => {
                        format!("{:.0} / {:.0} {}", used, limit, suffix)
                    }
                };
                detail_rows.push((label.clone(), v, CLR_YLW));
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
                detail_rows.push((label.clone(), v, CLR_RED));
            }
        }
    }

    PanelModel {
        slug,
        display: out.display_name.clone(),
        plan: out.plan.clone(),
        status,
        progresses,
        detail_rows,
    }
}

fn sparkline(seed: u64, ratio: f64) -> String {
    const LEVELS: [&str; 8] = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    let mut h = seed;
    let mut s = String::new();
    for _ in 0..14 {
        h = h.wrapping_mul(6364136223846793005).wrapping_add(1);
        let r = (h % 1000) as f64 / 1000.0;
        let mix = (r * 0.55 + ratio * 0.45).clamp(0.0, 1.0);
        let idx = (mix * 7.0).floor() as usize;
        s.push_str(LEVELS[idx.min(7)]);
    }
    s
}

fn status_label(s: PanelStatus) -> (&'static str, Color) {
    match s {
        PanelStatus::Ok => (" OK ", CLR_GRN),
        PanelStatus::Limit => ("LIMIT", CLR_YLW),
        PanelStatus::Error => ("FAIL", CLR_RED),
    }
}

pub fn run(outputs: Vec<PluginOutput>) -> Result<()> {
    let panels: Vec<PanelModel> = outputs.iter().map(panel_from_output).collect();

    // Avoid job-control suspend (Ctrl+Z) while the alternate-screen TUI is active.
    // Prefer sigaction(2) over signal(3): well-defined with libc::sigaction + sa_sigaction = SIG_IGN.
    #[cfg(unix)]
    unsafe {
        let mut sa: libc::sigaction = std::mem::zeroed();
        sa.sa_sigaction = libc::SIG_IGN;
        libc::sigemptyset(&mut sa.sa_mask);
        sa.sa_flags = 0;
        let _ = libc::sigaction(libc::SIGTSTP, &sa, std::ptr::null_mut());
    }

    if std::io::stderr().is_terminal() {
        eprintln!("CrossUsage dashboard — loading UI… (press q or Esc to quit; avoid Ctrl+Z)");
        let _ = std::io::stderr().flush();
    }

    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;

    // Always restore the terminal (also runs on panic when unwinding past this stack frame).
    let _terminal_restore = scopeguard::guard((), |_| {
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
        let _ = disable_raw_mode();
    });

    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut should_quit = false;
    while !should_quit {
        let now = Local::now().format("%H:%M:%S").to_string();
        terminal.draw(|f| render_dashboard(f, &panels, &now))?;

        if event::poll(Duration::from_millis(200))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Char('Q') | KeyCode::Esc => should_quit = true,
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

fn render_dashboard(f: &mut Frame, panels: &[PanelModel], clock: &str) {
    let root = f.area();
    let main_and_bar = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(1)])
        .split(root);

    f.render_widget(ratatui::widgets::Clear, root);

    let grid_area = main_and_bar[0];
    let n = panels.len().max(1);
    let cols: usize = 3;
    let rows = (n + cols - 1) / cols;

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
            render_panel(f, col_chunks[col_idx], &panels[idx], clock);
        }
    }

    let hint = Paragraph::new(Line::from(vec![
        Span::styled(" CrossUsage ", Style::default().fg(CLR_FG).add_modifier(Modifier::BOLD)),
        Span::styled("·", Style::default().fg(CLR_DIM)),
        Span::raw(" usage  "),
        Span::styled("q", Style::default().fg(CLR_YLW)),
        Span::raw(" quit   "),
        Span::styled(clock, Style::default().fg(CLR_AQUA)),
    ]))
    .style(Style::default().bg(CLR_BG))
    .alignment(Alignment::Center);
    f.render_widget(hint, main_and_bar[1]);
}

fn render_panel(f: &mut Frame, area: Rect, p: &PanelModel, clock: &str) {
    let (st, st_clr) = status_label(p.status);

    let title = Line::from(vec![
        Span::styled(
            format!(" {} ", p.slug),
            Style::default().fg(CLR_YLW).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            truncate(&p.display, 20),
            Style::default().fg(CLR_FG),
        ),
    ]);

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .title_style(Style::default().fg(CLR_FG))
        .border_style(Style::default().fg(CLR_BRDR))
        .style(Style::default().bg(CLR_BG));

    let inner = block.inner(area);
    f.render_widget(block, area);

    let inner = inner.inner(Margin {
        horizontal: 1,
        vertical: 0,
    });

    // Top row: [ plan / slug line | status badge ]
    let top = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Min(0), Constraint::Length(6)])
        .split(inner);

    let left_col = top[0];
    let status_area = top[1];

    let status_line = Line::from(vec![Span::styled(
        st,
        Style::default()
            .fg(st_clr)
            .bg(Color::Rgb(60, 56, 54))
            .add_modifier(Modifier::BOLD),
    )]);
    f.render_widget(
        Paragraph::new(status_line).alignment(Alignment::Right),
        status_area,
    );

    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // plan line or blank
            Constraint::Length(1),             // rule
            Constraint::Length(2),             // gauge 1
            Constraint::Length(2),             // gauge 2
            Constraint::Min(1),                // details
            Constraint::Length(1),             // spark
            Constraint::Length(1),             // time
        ])
        .split(left_col);

    let mut i = 0usize;
    if let Some(ref plan) = p.plan {
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled("plan ", Style::default().fg(CLR_DIM)),
                Span::styled(truncate(plan, 48), Style::default().fg(CLR_AQUA)),
            ])),
            left_chunks[i],
        );
        i += 1;
    } else {
        f.render_widget(Paragraph::new(""), left_chunks[i]);
        i += 1;
    }

    let w = left_chunks[i].width.saturating_sub(1) as usize;
    f.render_widget(
        Paragraph::new(Line::from(vec![Span::styled(
            "─".repeat(w.min(60)),
            Style::default().fg(CLR_BRDR),
        )])),
        left_chunks[i],
    );
    i += 1;

    // Primary gauge
    if let Some((ratio, label)) = p.progresses.first() {
        let r = ratio.clamp(0.0, 1.0);
        let gauge_clr = match p.status {
            PanelStatus::Error => CLR_RED,
            PanelStatus::Limit => CLR_ORG,
            PanelStatus::Ok => CLR_GRN,
        };
        let g = Gauge::default()
            .gauge_style(
                Style::default()
                    .fg(gauge_clr)
                    .bg(CLR_GAUGE_BG)
                    .add_modifier(Modifier::BOLD),
            )
            .label(truncate(label, 56))
            .ratio(r);
        f.render_widget(g, left_chunks[i]);
    } else {
        f.render_widget(
            Paragraph::new(Line::from(vec![Span::styled(
                "no usage metrics",
                Style::default().fg(CLR_DIM),
            )])),
            left_chunks[i],
        );
    }
    i += 1;

    if let Some((ratio, label)) = p.progresses.get(1) {
        let g2 = Gauge::default()
            .gauge_style(Style::default().fg(CLR_YLW).bg(CLR_GAUGE_BG))
            .label(truncate(label, 56))
            .ratio(ratio.clamp(0.0, 1.0));
        f.render_widget(g2, left_chunks[i]);
    } else {
        f.render_widget(ratatui::widgets::Clear, left_chunks[i]);
    }
    i += 1;

    let lines: Vec<Line> = p
        .detail_rows
        .iter()
        .map(|(label, val, ac)| {
            Line::from(vec![
                Span::styled("▪ ", Style::default().fg(*ac)),
                Span::styled(format!("{label} ", label = label), Style::default().fg(CLR_DIM)),
                Span::styled(truncate(val, 36), Style::default().fg(CLR_FG)),
            ])
        })
        .collect();
    f.render_widget(
        Paragraph::new(lines).wrap(ratatui::widgets::Wrap { trim: true }),
        left_chunks[i],
    );
    i += 1;

    let ratio = p.progresses.first().map(|(r, _)| *r).unwrap_or(0.15);
    let seed = p.slug.as_bytes().iter().fold(0u64, |a, &b| a.wrapping_mul(31).wrapping_add(b as u64));
    let spark = sparkline(seed, ratio);
    f.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("trend ", Style::default().fg(CLR_DIM)),
            Span::styled(spark, Style::default().fg(CLR_YLW)),
        ])),
        left_chunks[i],
    );
    i += 1;

    f.render_widget(
        Paragraph::new(Line::from(vec![Span::styled(
            clock,
            Style::default().fg(CLR_DIM),
        )]))
        .alignment(Alignment::Right),
        left_chunks[i],
    );
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!("{}…", s.chars().take(max.saturating_sub(1)).collect::<String>())
}
