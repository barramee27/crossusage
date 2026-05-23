use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const FREEDESKTOP_STEREO: &str = "/usr/share/sounds/freedesktop/stereo";

/// Maps macOS alert names (shared with settings UI) to freedesktop sound files on Linux.
fn linux_sound_candidates(sound: &str) -> &'static [&'static str] {
    match sound {
        "Basso" => &["dialog-warning.oga", "complete.oga"],
        "Ping" => &["bell.oga", "message-new-instant.oga"],
        "Funk" => &["complete.oga", "message.oga"],
        "Frog" => &["message.oga", "complete.oga"],
        "Tink" => &["message-new-instant.oga", "bell.oga"],
        "Pop" => &["message.oga", "bell.oga"],
        "Bottle" => &["complete.oga", "device-added.oga"],
        "Blow" => &["audio-volume-change.oga", "bell.oga"],
        "Glass" => &["bell.oga", "complete.oga"],
        "Hero" => &["complete.oga", "service-login.oga"],
        "Morse" => &["phone-outgoing-calling.oga", "bell.oga"],
        "Purr" => &["message-new-instant.oga", "message.oga"],
        "Submarine" => &["suspend-error.oga", "complete.oga"],
        "Sosumi" => &["window-attention.oga", "dialog-warning.oga"],
        _ => &["complete.oga", "bell.oga"],
    }
}

fn first_existing_sound(candidates: &[&str]) -> Option<PathBuf> {
    let dirs = [
        FREEDESKTOP_STEREO,
        "/usr/share/sounds/gnome/default/alerts",
    ];
    for dir in dirs {
        for name in candidates {
            let path = Path::new(dir).join(name);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn play_linux(sound: &str) -> Result<(), String> {
    let path = first_existing_sound(linux_sound_candidates(sound))
        .ok_or_else(|| format!("no sound file found for '{sound}'"))?;

    let paplay = Command::new("paplay")
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("paplay failed: {e}"))?;

    if paplay.success() {
        Ok(())
    } else {
        Err(format!("paplay exited with status {}", paplay))
    }
}

#[cfg(target_os = "macos")]
fn play_macos(sound: &str) -> Result<(), String> {
    let path = format!("/System/Library/Sounds/{sound}.aiff");
    if !Path::new(&path).is_file() {
        return Err(format!("sound file not found: {path}"));
    }
    let status = Command::new("afplay")
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("afplay failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("afplay exited with status {}", status))
    }
}

#[cfg(target_os = "windows")]
fn play_windows(sound: &str) -> Result<(), String> {
    let sys_sound = match sound {
        "Basso" => "Hand",
        "Ping" => "Asterisk",
        "Pop" => "Asterisk",
        "Tink" => "Asterisk",
        "Hero" => "Exclamation",
        "Sosumi" => "Question",
        _ => "Asterisk",
    };
    let script = format!(
        "[System.Media.SystemSounds]::{sys_sound}.Play(); Start-Sleep -Milliseconds 400"
    );
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("powershell sound failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("powershell sound exited with status {}", status))
    }
}

/// Plays the usage-alert sound locally (Linux: paplay; macOS: afplay; Windows: SystemSounds).
#[tauri::command]
pub fn play_usage_alert_sound(sound: String) -> Result<(), String> {
    let trimmed = sound.trim();
    if trimmed.is_empty() {
        return Err("empty sound name".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        return play_linux(trimmed);
    }
    #[cfg(target_os = "macos")]
    {
        return play_macos(trimmed);
    }
    #[cfg(target_os = "windows")]
    {
        return play_windows(trimmed);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = trimmed;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_candidates_resolve_on_freedesktop() {
        if !Path::new(FREEDESKTOP_STEREO).is_dir() {
            return;
        }
        let path = first_existing_sound(linux_sound_candidates("Ping"));
        assert!(path.is_some(), "expected bell.oga on freedesktop systems");
    }
}
