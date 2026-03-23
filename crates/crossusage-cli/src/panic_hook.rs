//! Panic hook: restore terminal (raw mode / alternate screen / cursor) before printing panic;
//! then wait for a key so the user can read the message (best-effort).

use crossterm::cursor::Show;
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, LeaveAlternateScreen};
use std::io::{self, Read, Write};

/// Best-effort restore so panics don't leave the terminal unusable.
pub fn restore_terminal() {
    let _ = disable_raw_mode();
    let mut out = io::stderr();
    let _ = execute!(out, LeaveAlternateScreen, Show);
    let _ = out.flush();
}

fn press_any_key() {
    let _ = io::stderr().write_all(b"\nPress any key to exit...\n");
    let _ = io::stderr().flush();

    #[cfg(unix)]
    {
        if let Ok(mut f) = std::fs::File::open("/dev/tty") {
            let mut buf = [0u8; 1];
            let _ = f.read_exact(&mut buf);
        } else {
            let mut buf = [0u8; 1];
            let _ = io::stdin().read_exact(&mut buf);
        }
    }
    #[cfg(windows)]
    {
        let mut buf = [0u8; 1];
        let _ = io::stdin().read_exact(&mut buf);
    }
}

pub fn install() {
    let _ = color_eyre::config::HookBuilder::default()
        .display_location_section(true)
        .display_env_section(false)
        .install();

    let original = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore_terminal();
        original(info);
        press_any_key();
    }));
}
