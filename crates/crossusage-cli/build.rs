use std::path::Path;

fn emit_rerun(dir: &Path) {
    if !dir.is_dir() {
        return;
    }
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_dir() {
            emit_rerun(&p);
        } else {
            println!("cargo:rerun-if-changed={}", p.display());
        }
    }
}

fn main() {
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let plugins = manifest.join("../../plugins");
    emit_rerun(&plugins);
}
