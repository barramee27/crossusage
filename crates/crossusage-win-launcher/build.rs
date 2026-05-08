//! Stage `WebView2Loader.dll` into `OUT_DIR` for `include_bytes!(concat!(env!("OUT_DIR"), ...))`.
//! With `CROSSUSAGE_ONEFILE=1`, also builds a tiny custom payload archive so the launcher can
//! be shipped as one self-extracting exe.

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() {
    let out_dir = env::var_os("OUT_DIR").expect("OUT_DIR");
    let out_dir = Path::new(&out_dir);
    let dll_dst = out_dir.join("webview2loader.dll");
    let payload_dst = out_dir.join("payload.bin");
    let payload_id_dst = out_dir.join("payload_id.txt");
    let target = env::var("TARGET").expect("TARGET");

    if !target.contains("windows") {
        fs::write(&dll_dst, [0u8]).expect("write placeholder webview2loader.dll");
        fs::write(&payload_dst, []).expect("write empty payload.bin");
        fs::write(&payload_id_dst, "empty").expect("write placeholder payload_id.txt");
        return;
    }

    let root = env::var("CARGO_MANIFEST_DIR")
        .map(|manifest| Path::new(&manifest).join("../.."))
        .expect("CARGO_MANIFEST_DIR");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "release".into());
    let target_dir = root.join("target").join(&target).join(&profile);

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = env::var("CROSSUSAGE_WEBVIEW2_LOADER_SRC") {
        candidates.push(PathBuf::from(p));
    }
    candidates.push(target_dir.join("WebView2Loader.dll"));

    let mut copied = false;
    for src in &candidates {
        if src.is_file() {
            fs::copy(src, &dll_dst)
                .unwrap_or_else(|e| panic!("copy {} -> {}: {e}", src.display(), dll_dst.display()));
            println!("cargo:rerun-if-changed={}", src.display());
            copied = true;
            break;
        }
    }

    if !copied {
        panic!(
            "WebView2Loader.dll not found for crossusage-win-launcher (target={target}).\n\
             Build the Tauri app for this Windows target first (produces target/.../release/WebView2Loader.dll for GNU), or set CROSSUSAGE_WEBVIEW2_LOADER_SRC.\n\
             Tried: {:?}",
            candidates
        );
    }

    if env::var("CROSSUSAGE_ONEFILE").ok().as_deref() == Some("1") {
        write_payload(&root, &target_dir, &payload_dst, &payload_id_dst)
            .expect("write onefile payload");
    } else {
        fs::write(&payload_dst, []).expect("write empty payload.bin");
        fs::write(&payload_id_dst, "directory").expect("write payload_id.txt");
    }
}

fn write_payload(
    root: &Path,
    target_dir: &Path,
    payload_dst: &Path,
    payload_id_dst: &Path,
) -> io::Result<()> {
    let mut files = Vec::new();
    push_required(
        &mut files,
        target_dir.join("crossusage.exe"),
        "crossusage_gui.exe",
    );
    push_required(
        &mut files,
        target_dir.join("crossusage-cli.exe"),
        "crossusage-cli.exe",
    );
    push_required(
        &mut files,
        target_dir.join("WebView2Loader.dll"),
        "WebView2Loader.dll",
    );
    push_required(
        &mut files,
        root.join("src-tauri/resources/WINDOWS-PORTABLE.txt"),
        "README-Windows.txt",
    );

    let resources = root.join("src-tauri/resources");
    add_dir(&resources, Path::new("resources"), &mut files)?;

    // Tauri resolves configured resources from the resource root, so this must be `icons/...`
    // beside `resources/...`, not nested under `resources/icons`.
    let icons = root.join("src-tauri/icons");
    add_dir(&icons, Path::new("icons"), &mut files)?;

    files.sort_by(|a, b| a.1.cmp(&b.1));

    let mut payload = Vec::new();
    payload.extend_from_slice(b"CUOF1");
    payload.extend_from_slice(&(files.len() as u32).to_le_bytes());

    for (src, archive_path) in files {
        let data = fs::read(&src)?;
        let path_bytes = archive_path.as_bytes();
        if path_bytes.len() > u16::MAX as usize {
            panic!("payload path too long: {archive_path}");
        }
        payload.extend_from_slice(&(path_bytes.len() as u16).to_le_bytes());
        payload.extend_from_slice(&(data.len() as u64).to_le_bytes());
        payload.extend_from_slice(path_bytes);
        payload.extend_from_slice(&data);
        println!("cargo:rerun-if-changed={}", src.display());
    }

    let hash = fnv1a64(&payload);
    fs::write(payload_dst, payload)?;
    fs::write(payload_id_dst, format!("{hash:016x}"))?;
    Ok(())
}

fn push_required(files: &mut Vec<(PathBuf, String)>, src: PathBuf, archive_path: &str) {
    if !src.is_file() {
        panic!("required onefile payload input missing: {}", src.display());
    }
    files.push((src, archive_path.to_string()));
}

fn add_dir(
    src_dir: &Path,
    archive_dir: &Path,
    files: &mut Vec<(PathBuf, String)>,
) -> io::Result<()> {
    let mut entries = fs::read_dir(src_dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let archive_path = archive_dir.join(entry.file_name());
        if path.is_dir() {
            add_dir(&path, &archive_path, files)?;
        } else if path.is_file() {
            files.push((path, archive_path.to_string_lossy().replace('\\', "/")));
        }
    }
    Ok(())
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
