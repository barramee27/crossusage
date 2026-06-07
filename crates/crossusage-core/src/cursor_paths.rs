//! Cursor Stable vs Cursor Nightly install paths (separate `state.vscdb` per app).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

const STATE_DB_SUFFIX: &str = "User/globalStorage/state.vscdb";
const ACCESS_KEY: &str = "cursorAuth/accessToken";
const REFRESH_KEY: &str = "cursorAuth/refreshToken";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorInstall {
    Stable,
    Nightly,
}

impl CursorInstall {
    pub fn app_dir_name(self) -> &'static str {
        match self {
            Self::Stable => "Cursor",
            Self::Nightly => "Cursor Nightly",
        }
    }

    pub fn from_plugin_id(plugin_id: &str) -> Option<Self> {
        match plugin_id.trim() {
            "cursor" => Some(Self::Stable),
            "cursor-nightly" => Some(Self::Nightly),
            _ => None,
        }
    }
}

fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn platform_roots() -> Vec<PathBuf> {
    vec![
        expand_home("~/.config"),
        expand_home("~/Library/Application Support"),
        expand_home("~/AppData/Roaming"),
    ]
}

/// `state.vscdb` for one install only (stable **or** nightly — never merged).
pub fn resolve_cursor_state_db_for(install: CursorInstall) -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("CURSOR_STATE_DB") {
        let custom = custom.trim();
        if !custom.is_empty() {
            let p = expand_home(custom);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    for root in platform_roots() {
        let p = root.join(install.app_dir_name()).join(STATE_DB_SUFFIX);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub fn resolve_cursor_state_db_for_plugin_id(plugin_id: &str) -> Option<PathBuf> {
    CursorInstall::from_plugin_id(plugin_id).and_then(resolve_cursor_state_db_for)
}

/// Default stable DB (CLI / legacy callers).
pub fn resolve_cursor_state_db() -> Option<PathBuf> {
    resolve_cursor_state_db_for(CursorInstall::Stable).or_else(|| {
        resolve_cursor_state_db_for(CursorInstall::Nightly)
    })
}

fn read_sqlite_value(db_path: &Path, key: &str) -> Option<String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let mut stmt = conn
        .prepare("SELECT value FROM ItemTable WHERE key = ?1 LIMIT 1")
        .ok()?;
    let mut rows = stmt.query_map([key], |row| row.get::<_, String>(0)).ok()?;
    let row = rows.next()?.ok()?;
    let trimmed = row.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn cursor_state_db_has_auth(db_path: &Path) -> bool {
    read_sqlite_value(db_path, ACCESS_KEY).is_some()
        || read_sqlite_value(db_path, REFRESH_KEY).is_some()
}

fn path_has_app_dir(db_path: &Path, app_name: &str) -> bool {
    db_path
        .components()
        .any(|c| c.as_os_str() == OsStr::new(app_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_and_nightly_resolve_to_distinct_linux_paths() {
        let stable = resolve_cursor_state_db_for(CursorInstall::Stable).map(|p| p.to_string_lossy().to_string());
        let nightly = resolve_cursor_state_db_for(CursorInstall::Nightly).map(|p| p.to_string_lossy().to_string());
        let stable_path = expand_home("~/.config/Cursor/User/globalStorage/state.vscdb");
        let nightly_path = expand_home("~/.config/Cursor Nightly/User/globalStorage/state.vscdb");
        if stable_path.is_file() {
            assert_eq!(stable.as_deref(), Some(stable_path.to_string_lossy().as_ref()));
        }
        if nightly_path.is_file() {
            assert_eq!(nightly.as_deref(), Some(nightly_path.to_string_lossy().as_ref()));
        }
        if stable.is_some() && nightly.is_some() {
            assert_ne!(stable, nightly);
        }
    }

    #[test]
    fn from_plugin_id_maps_both_providers() {
        assert_eq!(
            CursorInstall::from_plugin_id("cursor"),
            Some(CursorInstall::Stable)
        );
        assert_eq!(
            CursorInstall::from_plugin_id("cursor-nightly"),
            Some(CursorInstall::Nightly)
        );
        assert_eq!(CursorInstall::from_plugin_id("claude"), None);
    }
}
