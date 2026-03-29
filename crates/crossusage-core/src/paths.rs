//! Resolve app data and resource dirs to match the Tauri app (`com.barramee27.crossusage`).

use std::path::{Path, PathBuf};

/// Identifier folder segment (matches `tauri.conf.json` identifier).
const APP_ID: &str = "com.barramee27.crossusage";

/// App data directory (plugins, settings, etc.) — same family as Tauri `app_data_dir`.
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(APP_ID))
}

/// Context collected when no bundled plugin tree was found (for user-facing hints).
#[derive(Debug, Clone, Default)]
pub struct ResourceDirProbeContext {
    /// Canonical parent directory of the running executable, if known.
    pub current_exe_parent: Option<PathBuf>,
    /// Current working directory when probing ran.
    pub current_dir: Option<PathBuf>,
}

/// Outcome of locating bundled plugin resources for the CLI.
#[derive(Debug, Clone)]
pub enum ResourceDirResolution {
    /// Resource root to pass to [`crate::plugin_engine::initialize_plugins`].
    ///
    /// - If set via `CROSSUSAGE_RESOURCES`, the path is used even when nothing exists yet
    ///   (caller may get empty plugins until the path is fixed).
    /// - Otherwise, this root is one where `bundled_plugins/` or `resources/bundled_plugins/`
    ///   was found to exist.
    Resolved(PathBuf),
    /// No bundled plugin directory was found in any standard location. The CLI must **not**
    /// fall back to the current working directory (`.`).
    NotFound(ResourceDirProbeContext),
}

/// Resolved paths for the standalone CLI.
#[derive(Debug, Clone)]
pub struct CliPaths {
    pub app_data: PathBuf,
    /// `None` when no bundled plugin location was discovered.
    pub resource_dir: Option<PathBuf>,
    /// Same as [`ResourceDirResolution`]; use for diagnostics when `resource_dir` is `None`
    /// or plugins are still empty after init.
    pub resource_resolution: ResourceDirResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathsError {
    /// `dirs::data_dir()` returned `None` (rare headless / misconfigured systems).
    NoAppDataDir,
}

fn bundled_exists_under_resource_root(root: &Path) -> bool {
    root.join("bundled_plugins").is_dir()
        || root.join("resources/bundled_plugins").is_dir()
}

/// Returns the resource root directory when `bundled_plugins` lives beside the executable
/// (portable tarball / local install layout).
fn bundled_root_beside_exe_dir(exe_dir: &Path) -> Option<PathBuf> {
    let beside = exe_dir.join("resources");
    if beside.join("bundled_plugins").is_dir()
        || beside.join("resources/bundled_plugins").is_dir()
    {
        return Some(beside);
    }
    if exe_dir.join("bundled_plugins").is_dir() {
        return Some(exe_dir.to_path_buf());
    }
    None
}

/// Locate bundled plugin resources for the CLI without falling back to `.`.
///
/// Resolution order matches the previous `resource_dir()` behavior, except the silent `.`
/// fallback is removed.
///
/// - If `CROSSUSAGE_RESOURCES` is set, it is used as the resource root.
/// - Otherwise: `../Resources` next to the executable (macOS app bundle),
///   or Homebrew-style `share/crossusage` on macOS,
///   or `/usr/share/crossusage` (Linux .deb-style install), or `resources/` next to the **real**
///   executable (portable tarball / `install.sh` layout; `current_exe` is canonicalized so
///   `~/.local/bin/...` symlinks resolve like Windows/Linux portable),
///   or the OpenUsage repo’s `src-tauri/resources` when the current working directory is the repo root.
pub fn resolve_resource_dir() -> ResourceDirResolution {
    if let Ok(p) = std::env::var("CROSSUSAGE_RESOURCES") {
        return ResourceDirResolution::Resolved(PathBuf::from(p));
    }

    if let Ok(exe) = std::env::current_exe() {
        let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
        if let Some(exe_dir) = exe.parent() {
            // Tauri app bundle: Contents/MacOS/exe -> Contents/Resources
            #[cfg(target_os = "macos")]
            {
                if exe_dir.ends_with("MacOS") {
                    let resources = exe_dir
                        .parent()
                        .map(|p| p.join("Resources"))
                        .unwrap_or_else(|| exe_dir.to_path_buf());
                    if bundled_exists_under_resource_root(&resources) {
                        return ResourceDirResolution::Resolved(resources);
                    }
                }

                // Standalone CLI (Homebrew / /usr/local): same layout as Linux installs
                for share in [
                    PathBuf::from("/opt/homebrew/share/crossusage"),
                    PathBuf::from("/usr/local/share/crossusage"),
                ] {
                    if bundled_exists_under_resource_root(&share) {
                        return ResourceDirResolution::Resolved(share);
                    }
                }
            }

            // Linux: /usr/bin/crossusage -> /usr/share/crossusage
            #[cfg(target_os = "linux")]
            {
                let share = PathBuf::from("/usr/share/crossusage");
                if bundled_exists_under_resource_root(&share) {
                    return ResourceDirResolution::Resolved(share);
                }
            }

            // Next to executable (portable / dev) — Windows, Linux, macOS
            if let Some(root) = bundled_root_beside_exe_dir(exe_dir) {
                return ResourceDirResolution::Resolved(root);
            }
        }
    }

    // Monorepo dev: run CLI from repo root with `src-tauri/resources/bundled_plugins`
    if let Ok(cwd) = std::env::current_dir() {
        let r = cwd.join("src-tauri/resources");
        if bundled_exists_under_resource_root(&r) {
            return ResourceDirResolution::Resolved(r);
        }
    }

    let mut ctx = ResourceDirProbeContext::default();
    if let Ok(exe) = std::env::current_exe() {
        let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
        ctx.current_exe_parent = exe.parent().map(|p| p.to_path_buf());
    }
    ctx.current_dir = std::env::current_dir().ok();

    ResourceDirResolution::NotFound(ctx)
}

/// Resolve app data + resource paths for the CLI.
pub fn resolve_cli_paths() -> Result<CliPaths, PathsError> {
    let app_data = app_data_dir().ok_or(PathsError::NoAppDataDir)?;
    let resource_resolution = resolve_resource_dir();
    let resource_dir = match &resource_resolution {
        ResourceDirResolution::Resolved(p) => Some(p.clone()),
        ResourceDirResolution::NotFound(_) => None,
    };
    Ok(CliPaths {
        app_data,
        resource_dir,
        resource_resolution,
    })
}

/// User-facing hint when no bundled plugin root was discovered (macOS terminal / bare `cargo install`, etc.).
pub fn missing_bundled_plugins_hint(ctx: &ResourceDirProbeContext) -> String {
    let exe_note = ctx
        .current_exe_parent
        .as_ref()
        .map(|p| format!("Executable directory (canonicalized): {}\n", p.display()))
        .unwrap_or_default();
    let cwd_note = ctx
        .current_dir
        .as_ref()
        .map(|p| format!("Current directory: {}\n", p.display()))
        .unwrap_or_default();
    format!(
        "Bundled providers were not found under any known install location.\n\
{exe_note}\
{cwd_note}\
Fix: install the official portable CLI bundle (binary + resources/bundled_plugins together), e.g.\n\
  curl -fsSL …/scripts/install.sh | INSTALL_MODE=cli bash\n\
Or set CROSSUSAGE_RESOURCES to a folder that contains bundled_plugins/ or resources/bundled_plugins/ \
(e.g. CrossUsage.app/Contents/Resources, ~/.local/lib/crossusage/resources, or your clone’s src-tauri/resources).\n\
If you use a bare cargo install, you must supply bundled plugins via CROSSUSAGE_RESOURCES or run from a repo checkout with plugins populated.\n\
Launching the desktop app once can copy bundled plugins into app data if the GUI build includes them."
    )
}

/// Hint when a resource root was chosen but no plugins loaded (wrong env path, empty bundle, etc.).
pub fn empty_plugins_with_resource_root_hint(resource_root: &Path) -> String {
    format!(
        "No bundled_plugins found under the resolved resource root ({}).\n\
Expected {} or {}.\n\
Fix: re-install the official CLI tarball (keep binary and resources/ together), or set CROSSUSAGE_RESOURCES correctly, \
or launch the desktop app once so it seeds plugins into app data.",
        resource_root.display(),
        resource_root.join("bundled_plugins").display(),
        resource_root.join("resources/bundled_plugins").display(),
    )
}

/// Message to show when the CLI finished plugin discovery but found no providers.
pub fn plugins_empty_diagnostic(resolution: &ResourceDirResolution) -> String {
    match resolution {
        ResourceDirResolution::Resolved(p) => empty_plugins_with_resource_root_hint(p),
        ResourceDirResolution::NotFound(ctx) => missing_bundled_plugins_hint(ctx),
    }
}
