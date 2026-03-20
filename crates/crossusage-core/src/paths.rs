//! Resolve app data and resource dirs to match the Tauri app (`com.barramee27.crossusage`).

use std::path::PathBuf;

/// Identifier folder segment (matches `tauri.conf.json` identifier).
const APP_ID: &str = "com.barramee27.crossusage";

/// App data directory (plugins, settings, etc.) — same family as Tauri `app_data_dir`.
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(APP_ID))
}

/// Resource dir containing bundled plugins (e.g. `bundled_plugins` or `resources/bundled_plugins`).
///
/// - If `CROSSUSAGE_RESOURCES` is set, it is used as the resource root.
/// - Otherwise: `../Resources` next to the executable (macOS app bundle),
///   or `../share/crossusage` (Linux install), or parent of the exe (dev).
pub fn resource_dir() -> PathBuf {
    if let Ok(p) = std::env::var("CROSSUSAGE_RESOURCES") {
        return PathBuf::from(p);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // Tauri app bundle: Contents/MacOS/exe -> Contents/Resources
            #[cfg(target_os = "macos")]
            {
                if exe_dir.ends_with("MacOS") {
                    let resources = exe_dir
                        .parent()
                        .map(|p| p.join("Resources"))
                        .unwrap_or_else(|| exe_dir.to_path_buf());
                    if resources.join("bundled_plugins").exists()
                        || resources.join("resources/bundled_plugins").exists()
                    {
                        return resources;
                    }
                }
            }

            // Linux: /usr/bin/crossusage -> /usr/share/crossusage
            #[cfg(target_os = "linux")]
            {
                let share = PathBuf::from("/usr/share/crossusage");
                if share.join("bundled_plugins").exists()
                    || share.join("resources/bundled_plugins").exists()
                {
                    return share;
                }
            }

            // Next to executable (portable / dev)
            let beside = exe_dir.join("resources");
            if beside.join("bundled_plugins").exists()
                || beside.join("resources/bundled_plugins").exists()
            {
                return beside;
            }
            let beside2 = exe_dir.join("bundled_plugins");
            if beside2.exists() {
                return exe_dir.to_path_buf();
            }
        }
    }

    // Monorepo dev: run CLI from repo root with `src-tauri/resources/bundled_plugins`
    if let Ok(cwd) = std::env::current_dir() {
        let r = cwd.join("src-tauri/resources");
        if r.join("bundled_plugins").exists() || r.join("resources/bundled_plugins").exists() {
            return r;
        }
    }

    PathBuf::from(".")
}

/// Resolve both paths for CLI / GUI parity.
pub fn resolve_paths() -> Option<(PathBuf, PathBuf)> {
    let data = app_data_dir()?;
    let res = resource_dir();
    Some((data, res))
}
