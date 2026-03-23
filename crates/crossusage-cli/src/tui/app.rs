//! Ratatui main loop: non-blocking input, tokio background probes, SIGINT handling.

use std::io::{stdin, stdout, IsTerminal, Stdout};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use crossusage_core::plugin_engine::manifest::LoadedPlugin;
use crossusage_core::plugin_engine::runtime::{self, MetricLine, PluginOutput, ProgressFormat};
use crossterm::cursor::{Hide, Show};
use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers,
    MouseEventKind,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::layout::Alignment;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::prelude::*;
use ratatui::style::Modifier;
use ratatui::symbols;
use ratatui::widgets::{
    Axis, Block, Borders, Chart, Clear, Dataset, Gauge, GraphType, List, ListItem, Paragraph, Wrap,
};

use super::platform;
use super::state::AppState;
use super::theme::{Theme, ThemePreset};
use super::view_model::NormalizedMetricsMapper;
use crate::config::CliConfig;
use crate::reset_display::format_resets_at_for_display;

/// Poll interval so the main loop never blocks long enough to miss input (ms).
const EVENT_POLL_MS: u64 = 75;

fn probe_timeout_secs() -> u64 {
    std::env::var("CROSSUSAGE_PROBE_TIMEOUT_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&s| s > 0)
        .unwrap_or(120)
}

/// Runs `run_probe` in `spawn_blocking` with a wall-clock timeout so one hung provider cannot block the dashboard.
async fn run_probe_with_timeout(
    plugins: Arc<Vec<LoadedPlugin>>,
    idx: usize,
    app_data: PathBuf,
    version: String,
    plugin_for_err: LoadedPlugin,
) -> PluginOutput {
    let plugin_id = plugin_for_err.manifest.id.clone();
    let timeout_sec = probe_timeout_secs();
    let fut = async move {
        tokio::task::spawn_blocking(move || {
            runtime::run_probe(&plugins[idx], &app_data, &version)
        })
        .await
    };
    match tokio::time::timeout(Duration::from_secs(timeout_sec), fut).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => probe_error_output(
            &plugin_for_err,
            format!("probe task panicked or cancelled: {e}"),
        ),
        Err(_) => {
            eprintln!(
                "crossusage-cli: probe timed out after {timeout_sec}s for provider `{plugin_id}` \
                 (increase CROSSUSAGE_PROBE_TIMEOUT_SEC or disable that plugin)."
            );
            probe_error_output(
                &plugin_for_err,
                format!(
                    "Probe timed out after {timeout_sec}s. The provider may be waiting on the network — \
                     set CROSSUSAGE_PROBE_TIMEOUT_SEC or run `crossusage-cli list` to see which plugin hangs."
                ),
            )
        }
    }
}

enum ProbeMsg {
    Progress { current: usize, total: usize },
    Done(usize, PluginOutput, bool),
}

fn tui_trace(debug: bool, msg: &str) {
    if debug {
        eprintln!("[crossusage-cli tui] {msg}");
    }
}

fn register_shutdown_flag() -> Result<Arc<AtomicBool>> {
    use signal_hook::consts::signal::SIGINT;
    use signal_hook::flag as signal_flag;

    let shutdown = Arc::new(AtomicBool::new(false));
    signal_flag::register(SIGINT, Arc::clone(&shutdown)).context("register SIGINT")?;
    #[cfg(unix)]
    {
        use signal_hook::consts::signal::SIGTERM;
        signal_flag::register(SIGTERM, Arc::clone(&shutdown)).context("register SIGTERM")?;
    }
    Ok(shutdown)
}

fn loading_placeholder(plugin: &LoadedPlugin) -> PluginOutput {
    PluginOutput {
        provider_id: plugin.manifest.id.clone(),
        display_name: plugin.manifest.name.clone(),
        plan: None,
        lines: vec![MetricLine::Text {
            label: "Status".into(),
            value: "Waiting for probe…".into(),
            color: None,
            subtitle: None,
        }],
        icon_url: plugin.icon_data_url.clone(),
    }
}

fn fake_plugin_output(plugin: &LoadedPlugin, i: usize) -> PluginOutput {
    let used = 35.0 + ((i * 7) % 45) as f64;
    PluginOutput {
        provider_id: plugin.manifest.id.clone(),
        display_name: format!("{} (demo)", plugin.manifest.name),
        plan: Some("demo".into()),
        lines: vec![MetricLine::Progress {
            label: "primary".into(),
            used,
            limit: 100.0,
            format: ProgressFormat::Percent,
            resets_at: None,
            period_duration_ms: None,
            color: None,
        }],
        icon_url: plugin.icon_data_url.clone(),
    }
}

fn probe_error_output(plugin: &LoadedPlugin, message: String) -> PluginOutput {
    PluginOutput {
        provider_id: plugin.manifest.id.clone(),
        display_name: plugin.manifest.name.clone(),
        plan: None,
        lines: vec![MetricLine::Text {
            label: "Error".into(),
            value: message,
            color: None,
            subtitle: None,
        }],
        icon_url: plugin.icon_data_url.clone(),
    }
}

fn spawn_initial_probe_batch(
    handle: &tokio::runtime::Handle,
    tx: Sender<ProbeMsg>,
    plugins: Arc<Vec<LoadedPlugin>>,
    selected_indices: Vec<usize>,
    app_data: PathBuf,
    version: String,
) {
    let n = selected_indices.len();
    handle.spawn(async move {
        for (pos, &idx) in selected_indices.iter().enumerate() {
            let _ = tx.send(ProbeMsg::Progress {
                current: pos + 1,
                total: n,
            });
            let plugin_for_err = plugins[idx].clone();
            let plugins_c = Arc::clone(&plugins);
            let app_data = app_data.clone();
            let version = version.clone();
            let out = run_probe_with_timeout(plugins_c, idx, app_data, version, plugin_for_err).await;
            let is_last = pos + 1 == n;
            let _ = tx.send(ProbeMsg::Done(pos, out, is_last));
        }
    });
}

pub fn run(
    config: CliConfig,
    config_path: PathBuf,
    app_data: PathBuf,
    version: String,
    plugins: Arc<Vec<LoadedPlugin>>,
    candidate_indices: Vec<usize>,
    show_picker: bool,
    no_probe: bool,
    tui_debug: bool,
) -> Result<()> {
    tui_trace(tui_debug, "run(): enter");
    if candidate_indices.is_empty() {
        return Ok(());
    }

    let shutdown = register_shutdown_flag().context("signal-hook register")?;

    if !stdin().is_terminal() || !stdout().is_terminal() {
        anyhow::bail!(
            "The dashboard needs an interactive terminal (stdin and stdout must be TTYs). \
             Open a real terminal window, or use `crossusage-cli list` / `crossusage-cli probe` for non-interactive output."
        );
    }

    platform::ignore_sigtstp();

    let selected_indices = if show_picker {
        tui_trace(tui_debug, "run(): provider picker");
        super::picker::run_provider_picker(
            &plugins,
            &candidate_indices,
            &shutdown,
            &config,
        )?
    } else {
        candidate_indices
    };

    if selected_indices.is_empty() {
        eprintln!("No providers selected.");
        return Ok(());
    }

    eprintln!(
        "crossusage-cli: starting dashboard — first probe runs in the background; use q to quit, Ctrl+C to exit. \
         Tip: `crossusage-cli --no-probe` skips probes; `--no-picker` skips the checkbox screen."
    );
    if platform::parent_process_is_cargo() {
        eprintln!(
            "crossusage-cli: you are running under `cargo run` (parent: cargo). \
             Prefer `./target/debug/crossusage-cli` for a cleaner TTY."
        );
    }

    let placeholder: Vec<PluginOutput> = selected_indices
        .iter()
        .map(|&idx| loading_placeholder(&plugins[idx]))
        .collect();

    let mut state = AppState::new(config_path, config.clone(), placeholder);
    let n_sel = selected_indices.len();
    state.probe_progress = Some((0, n_sel));
    state.probe_busy = true;
    state.refreshing = true;

    let (tx, rx) = mpsc::channel::<ProbeMsg>();

    let rt = tokio::runtime::Runtime::new().context("tokio::Runtime::new")?;
    let handle = rt.handle().clone();

    if no_probe {
        tui_trace(tui_debug, "run(): --no-probe, filling fake data");
        for (i, &idx) in selected_indices.iter().enumerate() {
            state.outputs[i] = fake_plugin_output(&plugins[idx], i);
        }
        state.initial_load_complete = true;
        state.probe_busy = false;
        state.refreshing = false;
        state.probe_progress = None;
    } else {
        spawn_initial_probe_batch(
            &handle,
            tx.clone(),
            Arc::clone(&plugins),
            selected_indices.clone(),
            app_data.clone(),
            version.clone(),
        );
    }

    enable_raw_mode().context("enable_raw_mode")?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen, Hide).context("enter alternate screen")?;
    if state.config.mouse {
        execute!(out, EnableMouseCapture)?;
    }
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;
    let mut tick = Instant::now();
    let mut layout_ratios = normalize_ratios(config.pane_ratios);

    let result = run_inner(
        &mut terminal,
        &mut state,
        &plugins,
        &selected_indices,
        &app_data,
        &version,
        &rx,
        &tx,
        &mut tick,
        &mut layout_ratios,
        &handle,
        &shutdown,
        tui_debug,
    );

    let term_out = terminal.backend_mut();
    if state.config.mouse {
        let _ = execute!(term_out, DisableMouseCapture);
    }
    let _ = execute!(term_out, LeaveAlternateScreen, Show);
    disable_raw_mode()?;
    result
}

/// Each pane keeps at least this % width so columns never collapse to 0 (e.g. only Metrics visible)
/// after bad config, rounding, or mouse drag.
const MIN_PANE_PCT: u16 = 12;

fn enforce_min_pane_ratios(mut out: [u16; 3]) -> [u16; 3] {
    const MIN: u16 = MIN_PANE_PCT;
    let mut sum: u32 = out.iter().map(|&x| x as u32).sum();
    if sum == 0 {
        return [22, 48, 30];
    }
    for i in 0..3 {
        if out[i] < MIN {
            sum += (MIN - out[i]) as u32;
            out[i] = MIN;
        }
    }
    if sum > 100 {
        let mut excess = (sum - 100) as u16;
        while excess > 0 {
            let mut mi = 0usize;
            let mut mv = 0u16;
            for i in 0..3 {
                if out[i] > mv {
                    mv = out[i];
                    mi = i;
                }
            }
            let take = excess.min(out[mi].saturating_sub(MIN));
            if take == 0 {
                break;
            }
            out[mi] -= take;
            excess -= take;
        }
    } else if sum < 100 {
        out[1] = out[1].saturating_add((100 - sum) as u16);
    }
    out
}

fn normalize_ratios(r: [u16; 3]) -> [u16; 3] {
    let sum: u32 = r.iter().map(|&x| x as u32).sum();
    if sum == 0 {
        return [22, 48, 30];
    }
    let scale = 100u32;
    let mut out = [0u16; 3];
    let mut acc = 0u32;
    for i in 0..3 {
        let v = (r[i] as u32 * scale + sum / 2) / sum;
        out[i] = v.min(100) as u16;
        acc += out[i] as u32;
    }
    // Rounding can make acc slightly below or above 100; never subtract unsigned (acc - scale)
    // when acc > scale — that panics in debug (`attempt to subtract with overflow`).
    if acc != scale && acc > 0 {
        if acc < scale {
            out[1] = out[1].saturating_add((scale - acc) as u16);
        } else {
            out[1] = out[1].saturating_sub((acc - scale) as u16);
        }
    }
    enforce_min_pane_ratios(out)
}

#[allow(clippy::too_many_arguments)]
fn run_inner(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    state: &mut AppState,
    plugins: &Arc<Vec<LoadedPlugin>>,
    selected_indices: &[usize],
    app_data: &PathBuf,
    version: &str,
    rx: &Receiver<ProbeMsg>,
    tx: &Sender<ProbeMsg>,
    tick: &mut Instant,
    layout_ratios: &mut [u16; 3],
    handle: &tokio::runtime::Handle,
    shutdown: &Arc<AtomicBool>,
    tui_debug: bool,
) -> Result<()> {
    let mut scroll_detail: u16 = 0;
    let mut sys = sysinfo::System::new_all();

    loop {
        if shutdown.load(Ordering::SeqCst) {
            tui_trace(tui_debug, "run_inner: shutdown flag (SIGINT/SIGTERM), exiting");
            return Ok(());
        }

        while let Ok(msg) = rx.try_recv() {
            tui_trace(tui_debug, "run_inner: recv probe msg");
            match msg {
                ProbeMsg::Progress { current, total } => {
                    state.probe_progress = Some((current, total));
                }
                ProbeMsg::Done(i, out, is_last) => {
                    if i < state.outputs.len() {
                        let m = NormalizedMetricsMapper::from_output(&out);
                        if i < state.rings.len() {
                            state.rings[i].push_percent(m.primary_percent);
                        }
                        if state.config.persist_history {
                            let rec = crate::history::record_from_output(&out, chrono::Utc::now());
                            let _ = crate::history::append_jsonl(&rec);
                        }
                        state.outputs[i] = out;
                        state.last_probe[i] = Some(Instant::now());
                    }
                    if is_last {
                        state.probe_busy = false;
                        state.refreshing = false;
                        state.probe_progress = None;
                        state.initial_load_complete = true;
                    }
                }
            }
        }

        if state.last_sysinfo.elapsed() >= Duration::from_secs(1) {
            state.last_sysinfo = Instant::now();
            sys.refresh_cpu_all();
            sys.refresh_memory();
            state.host_cpu_pct = sys.global_cpu_usage();
            state.host_mem_used_mb = sys.used_memory() / 1024 / 1024;
            state.host_mem_total_mb = sys.total_memory().max(1) / 1024 / 1024;
        }

        if state.probe_busy || state.refreshing {
            state.spinner_frame = state.spinner_frame.wrapping_add(1);
        }

        tui_trace(tui_debug, "draw()");
        terminal.draw(|f| {
            let size = f.area();
            let theme = Theme::from_preset(ThemePreset::parse(&state.config.theme));
            if !state.initial_load_complete {
                draw_loading_screen(f, size, state, &theme);
            } else {
                let root = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(0),
                        Constraint::Length(1),
                    ])
                    .split(size);

                draw_header(f, root[0], state, &theme);
                let main_area = root[1];
                let footer_area = root[2];

                let h = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([
                        Constraint::Percentage(layout_ratios[0] as u16),
                        Constraint::Percentage(layout_ratios[1] as u16),
                        Constraint::Percentage(layout_ratios[2] as u16),
                    ])
                    .split(main_area);

                draw_provider_list(f, h[0], state, &theme);
                draw_charts(f, h[1], state, &theme);
                draw_detail_table(f, h[2], state, &theme, scroll_detail);

                draw_status_bar(f, footer_area, state, &theme);

                if state.help_open {
                    draw_help_modal(f, size, &theme);
                }
            }
        })?;

        tui_trace(tui_debug, &format!("event::poll({EVENT_POLL_MS}ms)"));
        if event::poll(Duration::from_millis(EVENT_POLL_MS))? {
            loop {
                let ev = event::read()?;
                tui_trace(tui_debug, &format!("event read: {ev:?}"));
                if handle_terminal_event(
                    ev,
                    state,
                    plugins,
                    selected_indices,
                    app_data,
                    version,
                    tx,
                    terminal,
                    layout_ratios,
                    &mut scroll_detail,
                    handle,
                    tui_debug,
                )? {
                    return Ok(());
                }
                if !event::poll(Duration::ZERO)? {
                    break;
                }
            }
        }

        if tick.elapsed() >= state.ui_tick() {
            *tick = Instant::now();
            poll_config_reload(state);
            maybe_schedule_probe(
                state,
                plugins,
                selected_indices,
                app_data,
                version,
                tx,
                handle,
            );
        }
    }
}

/// Returns `true` if the app should exit (user quit).
#[allow(clippy::too_many_arguments)]
fn handle_terminal_event(
    ev: Event,
    state: &mut AppState,
    plugins: &Arc<Vec<LoadedPlugin>>,
    selected_indices: &[usize],
    app_data: &PathBuf,
    version: &str,
    tx: &Sender<ProbeMsg>,
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    layout_ratios: &mut [u16; 3],
    scroll_detail: &mut u16,
    handle: &tokio::runtime::Handle,
    tui_debug: bool,
) -> Result<bool> {
    let initial = !state.initial_load_complete;

    match ev {
        Event::Key(key) if key.kind == KeyEventKind::Press => {
            if state.help_open {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('?') => state.help_open = false,
                    KeyCode::Char('q') | KeyCode::Char('Q') => {
                        tui_trace(tui_debug, "key q in help: exit");
                        return Ok(true);
                    }
                    _ => {}
                }
                return Ok(false);
            }

            // During initial probe: any quit key exits immediately (no confirm).
            if key.modifiers.contains(KeyModifiers::CONTROL)
                && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('C'))
            {
                tui_trace(tui_debug, "Ctrl+C key: exit");
                return Ok(true);
            }
            if matches!(key.code, KeyCode::Char('q') | KeyCode::Char('Q')) {
                tui_trace(tui_debug, "key q: exit");
                return Ok(true);
            }

            if initial {
                tui_trace(tui_debug, "initial load: ignoring non-quit keys");
                return Ok(false);
            }

            match key.code {
                KeyCode::Char('?') => state.help_open = true,
                KeyCode::Tab => state.cycle_pane(),
                KeyCode::Char('p') | KeyCode::Char('P') => {
                    state.config.low_power_mode = !state.config.low_power_mode;
                    let _ = state.config.save_to(&state.config_path);
                    state.status_msg =
                        Some(format!("Low-power: {}", state.config.low_power_mode));
                }
                KeyCode::Char('r') | KeyCode::Char('R') => {
                    spawn_full_probe(
                        state,
                        plugins,
                        selected_indices,
                        app_data,
                        version,
                        tx,
                        handle,
                    );
                }
                KeyCode::Left => {
                    state.chart_scroll = state.chart_scroll.saturating_add(1);
                }
                KeyCode::Right => {
                    state.chart_scroll = state.chart_scroll.saturating_sub(1);
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    if state.selected + 1 < state.outputs.len() {
                        state.selected += 1;
                    }
                }
                KeyCode::Up | KeyCode::Char('k') => {
                    if state.selected > 0 {
                        state.selected -= 1;
                    }
                }
                KeyCode::PageDown => *scroll_detail = scroll_detail.saturating_add(5),
                KeyCode::PageUp => *scroll_detail = scroll_detail.saturating_sub(5),
                _ => {}
            }
        }
        Event::Mouse(m) => {
            if !state.initial_load_complete {
                return Ok(false);
            }
            if state.config.mouse {
                if let MouseEventKind::Drag(_) = m.kind {
                    let w = terminal.size()?.width;
                    if w > 0 {
                        let px = m.column as f64 / w as f64;
                        let mut r = *layout_ratios;
                        let left = (px * 100.0).clamp(10.0, 80.0) as u16;
                        r[0] = left;
                        r[1] = (100u16).saturating_sub(left).saturating_sub(r[2]).max(15);
                        *layout_ratios = normalize_ratios(r);
                    }
                }
            }
        }
        _ => {}
    }
    Ok(false)
}

fn draw_loading_screen(f: &mut Frame, area: Rect, state: &AppState, theme: &Theme) {
    let (cur, tot) = state
        .probe_progress
        .unwrap_or((0, state.outputs.len().max(1)));
    let ratio = if tot > 0 {
        (cur as f64 / tot as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border))
        .title(Span::styled(" CrossUsage ", theme.title));
    let inner = block.inner(area);
    f.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Min(2),
            Constraint::Length(2),
        ])
        .split(inner);

    let title = Paragraph::new("CrossUsage — Loading…")
        .style(
            Style::default()
                .fg(theme.fg)
                .add_modifier(Modifier::BOLD),
        )
        .alignment(Alignment::Center);
    f.render_widget(title, chunks[0]);

    let gauge = Gauge::default()
        .block(Block::default().borders(Borders::NONE))
        .gauge_style(Style::default().fg(theme.accent).bg(theme.border))
        .ratio(ratio);
    f.render_widget(gauge, chunks[1]);

    let line = format!("Probing providers…  {cur}/{tot}  (q or Ctrl+C to quit)");
    let p = Paragraph::new(line)
        .style(Style::default().fg(theme.muted))
        .alignment(Alignment::Center);
    f.render_widget(p, chunks[2]);
}

fn poll_config_reload(state: &mut AppState) {
    if state.last_config_poll.elapsed() < Duration::from_secs(2) {
        return;
    }
    state.last_config_poll = Instant::now();
    let path = &state.config_path;
    let Ok(meta) = path.metadata() else {
        return;
    };
    let Ok(mtime) = meta.modified() else {
        return;
    };
    if state.config_path_mtime != Some(mtime) {
        state.config = CliConfig::load_from_path(path);
        state.config_path_mtime = Some(mtime);
    }
}

fn maybe_schedule_probe(
    state: &mut AppState,
    plugins: &Arc<Vec<LoadedPlugin>>,
    selected_indices: &[usize],
    app_data: &PathBuf,
    version: &str,
    tx: &Sender<ProbeMsg>,
    handle: &tokio::runtime::Handle,
) {
    if state.probe_busy || selected_indices.is_empty() {
        return;
    }
    let interval = state.effective_probe_interval();
    let now = Instant::now();
    let full_every = Duration::from_secs(30);
    if now.duration_since(state.last_full_probe) >= full_every {
        spawn_full_probe(
            state,
            plugins,
            selected_indices,
            app_data,
            version,
            tx,
            handle,
        );
        state.last_full_probe = now;
        return;
    }

    let i = state.rr_index % selected_indices.len();
    let last = state.last_probe.get(i).copied().flatten();
    let need = last.map(|t| t.elapsed() >= interval).unwrap_or(true);
    if need {
        state.rr_index = (state.rr_index + 1) % selected_indices.len();
        state.probe_busy = true;
        state.refreshing = true;
        let idx = selected_indices[i];
        let plugin_for_err = plugins[idx].clone();
        let plugins_block = Arc::clone(plugins);
        let app_data = app_data.clone();
        let version = version.to_string();
        let tx = tx.clone();
        handle.spawn(async move {
            let _ = tx.send(ProbeMsg::Progress {
                current: 1,
                total: 1,
            });
            let out =
                run_probe_with_timeout(plugins_block, idx, app_data, version, plugin_for_err).await;
            let _ = tx.send(ProbeMsg::Done(i, out, true));
        });
    }
}

fn spawn_full_probe(
    state: &mut AppState,
    plugins: &Arc<Vec<LoadedPlugin>>,
    selected_indices: &[usize],
    app_data: &PathBuf,
    version: &str,
    tx: &Sender<ProbeMsg>,
    handle: &tokio::runtime::Handle,
) {
    if state.probe_busy {
        return;
    }
    state.probe_busy = true;
    state.refreshing = true;
    let plugins = Arc::clone(plugins);
    let app_data = app_data.clone();
    let version = version.to_string();
    let indices = selected_indices.to_vec();
    let tx = tx.clone();
    let n = indices.len();
    handle.spawn(async move {
        for (pos, &idx) in indices.iter().enumerate() {
            let _ = tx.send(ProbeMsg::Progress {
                current: pos + 1,
                total: n,
            });
            let plugin_for_err = plugins[idx].clone();
            let plugins_block = Arc::clone(&plugins);
            let app_data = app_data.clone();
            let version = version.clone();
            let out =
                run_probe_with_timeout(plugins_block, idx, app_data, version, plugin_for_err).await;
            let is_last = pos + 1 == n;
            let _ = tx.send(ProbeMsg::Done(pos, out, is_last));
        }
    });
}

fn draw_header(f: &mut Frame, area: Rect, state: &AppState, theme: &Theme) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let spend = best_effort_spend_today(&state.outputs);
    // host_* = this machine (sysinfo), not Cursor/API usage.
    let line = format!(
        " CrossUsage  |  {}  |  host CPU {:4.1}%  MEM {}/{} MiB  |  est. spend: {} ",
        now, state.host_cpu_pct, state.host_mem_used_mb, state.host_mem_total_mb, spend
    );
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border))
        .style(Style::default().bg(theme.bg));
    let inner = block.inner(area);
    let p = Paragraph::new(line).style(Style::default().fg(theme.fg).add_modifier(Modifier::BOLD));
    f.render_widget(block, area);
    f.render_widget(p, inner);
}

fn best_effort_spend_today(outputs: &[PluginOutput]) -> String {
    let mut sum = 0.0;
    let mut any = false;
    for o in outputs {
        let m = NormalizedMetricsMapper::from_output(o);
        if let Some(c) = m.cost {
            sum += c;
            any = true;
        }
    }
    if any {
        format!("${sum:.2}")
    } else {
        "—".into()
    }
}

fn draw_provider_list(f: &mut Frame, area: Rect, state: &AppState, theme: &Theme) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border))
        .title(Span::styled(" Providers ", theme.title));
    let items: Vec<ListItem> = state
        .outputs
        .iter()
        .enumerate()
        .map(|(i, o)| {
            let m = NormalizedMetricsMapper::from_output(o);
            let stale = state
                .stale_secs(i)
                .map(|s| format!(" {s}s"))
                .unwrap_or_default();
            let line = format!("{}  {:>4.0}%{}", o.display_name, m.primary_percent, stale);
            let style = if i == state.selected {
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
    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn draw_charts(f: &mut Frame, area: Rect, state: &AppState, theme: &Theme) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border))
        .title(Span::styled(" Usage / history ", theme.title));
    let inner = block.inner(area);
    f.render_widget(block, area);

    let o = state.outputs.get(state.selected);
    let m = o
        .map(|o| NormalizedMetricsMapper::from_output(o))
        .unwrap_or_default();
    let vals = state
        .rings
        .get(state.selected)
        .map(|r| r.sparkline_values())
        .unwrap_or_else(|| vec![0; 32]);

    let scroll = state.chart_scroll.min(vals.len().saturating_sub(1));
    let window: Vec<u64> = vals.into_iter().skip(scroll).take(32).collect();
    let mut pts: Vec<(f64, f64)> = window
        .iter()
        .enumerate()
        .map(|(i, &v)| (i as f64, v as f64))
        .collect();
    if pts.len() < 2 {
        pts = vec![(0., 0.), (1., 0.)];
    }

    let datasets = vec![Dataset::default()
        .name("primary %")
        .marker(symbols::Marker::Braille)
        .graph_type(GraphType::Line)
        .style(Style::default().fg(theme.accent))
        .data(&pts)];

    let chart = Chart::new(datasets)
        .block(Block::default().borders(Borders::NONE))
        .x_axis(
            Axis::default()
                .bounds([0.0, 31.0])
                .labels(vec![Span::raw("t"), Span::raw("scroll ←/→")]),
        )
        .y_axis(Axis::default().bounds([0.0, 100.0]).labels(vec![
            Span::raw("0"),
            Span::raw("50"),
            Span::raw("100"),
        ]));

    let meta = format!(
        "primary {:.0}% | in {:?} out {:?} | cost {:?} | cache {:?}",
        m.primary_percent, m.input_tokens, m.output_tokens, m.cost, m.cache_hits
    );
    let p = Paragraph::new(meta)
        .style(Style::default().fg(theme.muted))
        .wrap(Wrap { trim: true });

    let sub = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(4), Constraint::Length(2)].as_ref())
        .split(inner);
    f.render_widget(chart, sub[0]);
    f.render_widget(p, sub[1]);
}

fn draw_detail_table(f: &mut Frame, area: Rect, state: &AppState, theme: &Theme, scroll: u16) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border))
        .title(Span::styled(" Metrics ", theme.title));
    let inner = block.inner(area);
    let o = state.outputs.get(state.selected);
    let text = o
        .map(|o| format_plugin_lines(o))
        .unwrap_or_else(|| "(none)".into());
    let p = Paragraph::new(text)
        .style(Style::default().fg(theme.fg))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(block, area);
    f.render_widget(p, inner);
}

fn format_plugin_lines(o: &PluginOutput) -> String {
    use crossusage_core::plugin_engine::runtime::{MetricLine, ProgressFormat};
    let mut s = String::new();
    s.push_str(&format!("{}  ({})\n", o.display_name, o.provider_id));
    if let Some(ref pl) = o.plan {
        s.push_str(&format!("Plan: {pl}\n"));
    }
    s.push('\n');
    for line in &o.lines {
        match line {
            MetricLine::Text {
                label,
                value,
                subtitle,
                ..
            } => {
                s.push_str(label);
                s.push_str(": ");
                s.push_str(value);
                if let Some(sub) = subtitle {
                    s.push_str(&format!(" ({sub})"));
                }
                s.push('\n');
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
                    (*used / *limit) * 100.0
                } else {
                    0.0
                };
                let v = match format {
                    ProgressFormat::Percent => format!("{:.1}% ({:.0}/{:.0})", pct, used, limit),
                    ProgressFormat::Dollars => format!("${:.2} / ${:.2}", used, limit),
                    ProgressFormat::Count { suffix } => {
                        format!("{:.0} / {:.0} {}", used, limit, suffix)
                    }
                };
                s.push_str(label);
                s.push_str(": ");
                s.push_str(&v);
                if let Some(r) = resets_at {
                    let rel = format_resets_at_for_display(r);
                    if !rel.is_empty() {
                        s.push_str(&format!(" · {rel}"));
                    }
                }
                s.push('\n');
            }
            MetricLine::Badge {
                label,
                text,
                subtitle,
                ..
            } => {
                s.push_str(label);
                s.push_str(": ");
                s.push_str(text);
                if let Some(sub) = subtitle {
                    s.push_str(&format!(" ({sub})"));
                }
                s.push('\n');
            }
        }
    }
    s
}

fn draw_status_bar(f: &mut Frame, area: Rect, state: &AppState, theme: &Theme) {
    let stale = state
        .stale_secs(state.selected)
        .map(|s| format!("Stale {s}s"))
        .unwrap_or_else(|| "Fresh".into());
    let spin = ["|", "/", "-", "\\"][state.spinner_frame as usize % 4];
    let probe = if let Some((c, t)) = state.probe_progress {
        format!("Probing {c}/{t} {spin} ")
    } else if state.refreshing {
        format!("Refreshing… {spin} ")
    } else {
        "Idle ".into()
    };
    let extra = state.status_msg.as_deref().unwrap_or("");
    let low = if state.config.low_power_mode {
        "[LOW-POWER] "
    } else {
        ""
    };
    let line = format!(
        "crossusage-cli | {low}{stale} | {probe}| probe {}s | {extra}↑↓jk r refresh p low-power ? help q quit",
        state.config.effective_probe_sec(),
    );
    let p = Paragraph::new(Span::styled(
        line,
        Style::default().fg(theme.muted).bg(theme.bg),
    ))
    .style(Style::default().bg(theme.bg));
    f.render_widget(p, area);
}

fn draw_help_modal(f: &mut Frame, r: Rect, theme: &Theme) {
    let block = Block::default()
        .title(" Help ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    let area = centered_rect(72, 55, r);
    f.render_widget(Clear, area);
    f.render_widget(block.clone(), area);
    let inner = block.inner(area);
    let help = Paragraph::new(
        "q        Quit\n\
         Ctrl+C   Quit\n\
         Esc      Close help\n\
         ?        This help\n\
         Tab      Cycle pane focus\n\
         ↑↓ jk    Move provider\n\
         ←→       Chart history scroll\n\
         r        Refresh all providers\n\
         p        Toggle low-power (saved to config)\n\
         Mouse    Resize panes (when enabled)\n",
    )
    .style(Style::default().fg(theme.fg))
    .wrap(Wrap { trim: true });
    f.render_widget(help, inner);
}

fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}
