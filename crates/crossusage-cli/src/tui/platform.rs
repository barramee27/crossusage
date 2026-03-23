//! Platform-specific helpers (signals, etc.).

/// Ignore signals that make **bash** print `[1]+ Stopped` (job suspended).
///
/// - **SIGTSTP** — Ctrl+Z
/// - **SIGTTIN** / **SIGTTOU** — terminal I/O while job control thinks the process is in the
///   “wrong” state (common with **IDE-integrated terminals** and lots of stderr during probes)
///
/// Call again after long-running work (e.g. each plugin probe) in case a child resets handlers.
pub fn ignore_sigtstp() {
    #[cfg(unix)]
    unsafe {
        let mut sa: libc::sigaction = std::mem::zeroed();
        sa.sa_sigaction = libc::SIG_IGN;
        libc::sigemptyset(&mut sa.sa_mask);
        sa.sa_flags = 0;
        for sig in [libc::SIGTSTP, libc::SIGTTIN, libc::SIGTTOU] {
            let _ = libc::sigaction(sig, &sa, std::ptr::null_mut());
        }
    }
}

/// True when this process was spawned by `cargo` (e.g. `cargo run`).
///
/// The shell’s **job** is usually the `cargo` parent, not `crossusage-cli`. If something
/// suspends that job (Ctrl+Z, or odd terminal/IDE behavior), bash prints `[1]+ Stopped cargo run …`
/// even though you never “quit” the TUI — **run `./target/debug/crossusage-cli`** instead.
#[cfg(target_os = "linux")]
pub fn parent_process_is_cargo() -> bool {
    parent_comm_linux()
        .map(|n| n == "cargo")
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
pub fn parent_process_is_cargo() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn parent_comm_linux() -> Option<String> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let ppid: u32 = status
        .lines()
        .find(|l| l.starts_with("PPid:"))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()?;
    let comm = std::fs::read_to_string(format!("/proc/{ppid}/comm")).ok()?;
    Some(comm.trim().to_string())
}
