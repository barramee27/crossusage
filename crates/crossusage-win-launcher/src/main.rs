//! Windows portable entry. In directory mode it writes `WebView2Loader.dll` next to this exe, then
//! runs sibling `crossusage_gui.exe`. In onefile mode it extracts the GUI, DLL, CLI, and resources
//! from an embedded payload into temp first, then runs the extracted GUI.

#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

static WEBVIEW2_LOADER_DLL: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/webview2loader.dll"));
static ONEFILE_PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.bin"));
static ONEFILE_PAYLOAD_ID: &str = include_str!(concat!(env!("OUT_DIR"), "/payload_id.txt"));

fn main() -> io::Result<()> {
    let dir = if ONEFILE_PAYLOAD.is_empty() {
        prepare_directory_mode()?
    } else {
        prepare_onefile_mode()?
    };

    run_gui(&dir)
}

fn prepare_directory_mode() -> io::Result<PathBuf> {
    let exe = env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "current_exe has no parent"))?
        .to_path_buf();

    write_if_missing_or_empty(&dir.join("WebView2Loader.dll"), WEBVIEW2_LOADER_DLL)?;
    Ok(dir)
}

fn prepare_onefile_mode() -> io::Result<PathBuf> {
    let base = env::temp_dir()
        .join("CrossUsage")
        .join("onefile")
        .join(ONEFILE_PAYLOAD_ID.trim());
    extract_payload(&base, ONEFILE_PAYLOAD)?;
    Ok(base)
}

fn run_gui(dir: &Path) -> io::Result<()> {
    let gui = dir.join("crossusage_gui.exe");
    if !gui.is_file() {
        #[cfg(debug_assertions)]
        eprintln!("crossusage-win-launcher: missing {}", gui.display());
        std::process::exit(2);
    }

    let mut cmd = Command::new(&gui);
    cmd.args(env::args_os().skip(1));
    cmd.current_dir(dir);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Avoid a brief console flash when double-clicking from Explorer.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let status = cmd.status()?;
    std::process::exit(status.code().unwrap_or(1));
}

fn extract_payload(dir: &Path, payload: &[u8]) -> io::Result<()> {
    let mut cursor = Cursor::new(payload);
    if cursor.read_bytes(5)? != b"CUOF1" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid crossusage onefile payload",
        ));
    }

    let file_count = cursor.read_u32()?;
    for _ in 0..file_count {
        let path_len = cursor.read_u16()? as usize;
        let data_len = cursor.read_u64()? as usize;
        let path_bytes = cursor.read_bytes(path_len)?;
        let archive_path = std::str::from_utf8(path_bytes).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("invalid path utf8: {e}"),
            )
        })?;
        let file_data = cursor.read_bytes(data_len)?;
        let target = safe_join(dir, archive_path)?;

        if target.is_file() && fs::metadata(&target)?.len() == data_len as u64 {
            continue;
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(target, file_data)?;
    }
    Ok(())
}

fn safe_join(base: &Path, archive_path: &str) -> io::Result<PathBuf> {
    let mut out = base.to_path_buf();
    for part in archive_path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("unsafe payload path: {archive_path}"),
            ));
        }
        out.push(part);
    }
    Ok(out)
}

fn write_if_missing_or_empty(path: &Path, data: &[u8]) -> io::Result<()> {
    if !path.is_file() || fs::metadata(path)?.len() == 0 {
        fs::write(path, data)?;
    }
    Ok(())
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn read_bytes(&mut self, len: usize) -> io::Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "payload offset overflow"))?;
        if end > self.bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated crossusage onefile payload",
            ));
        }
        let slice = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(slice)
    }

    fn read_u16(&mut self) -> io::Result<u16> {
        let bytes = self.read_bytes(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn read_u32(&mut self) -> io::Result<u32> {
        let bytes = self.read_bytes(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn read_u64(&mut self) -> io::Result<u64> {
        let bytes = self.read_bytes(8)?;
        Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }
}
