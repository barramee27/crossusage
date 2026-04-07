//! Same plugin set as `src-tauri/resources/bundled_plugins` (from `plugins/` at build time).
//! Used when no resource dir / empty install so `cargo install` and minimal builds still discover providers.

use include_dir::{include_dir, Dir};
use std::fs;
use std::io;
use std::path::Path;

static PLUGINS_ROOT: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../plugins");

fn materialize_dir(dir: &Dir<'_>, plugins_dest: &Path) -> io::Result<()> {
    for entry in dir.entries() {
        match entry {
            include_dir::DirEntry::File(f) => {
                let rel = f.path();
                let s = rel.to_string_lossy();
                if s.starts_with("mock/") || s.as_ref() == "mock" {
                    continue;
                }
                let out = plugins_dest.join(rel);
                if let Some(parent) = out.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(out, f.contents())?;
            }
            include_dir::DirEntry::Dir(d) => {
                if d.path() == Path::new("mock") {
                    continue;
                }
                materialize_dir(d, plugins_dest)?;
            }
        }
    }
    Ok(())
}

/// Writes embedded plugins into `app_data/plugins` (excluding `mock`).
pub fn materialize_into_app_data(app_data: &Path) -> io::Result<()> {
    let dest = app_data.join("plugins");
    fs::create_dir_all(&dest)?;
    materialize_dir(&PLUGINS_ROOT, &dest)
}
