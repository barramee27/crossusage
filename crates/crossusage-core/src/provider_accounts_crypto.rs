//! Encrypt `provider_accounts.json` at rest. Master key lives in the OS keychain.

use aes_gcm::{
    AesGcm, Nonce,
    aead::{Aead, KeyInit, OsRng, generic_array::typenum::U16, rand_core::RngCore},
    aes::Aes256,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const KEYCHAIN_SERVICE: &str = "CrossUsage";
const KEYCHAIN_ACCOUNT: &str = "provider-accounts-master-key";
pub const STORE_FORMAT_V1: &str = "crossusage-provider-accounts-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedProviderAccountsFile {
    pub format: String,
    pub envelope: String,
}

#[cfg(test)]
static TEST_MASTER_KEY: std::sync::Mutex<Option<[u8; 32]>> = std::sync::Mutex::new(None);

static CACHED_MASTER_KEY: std::sync::Mutex<Option<(PathBuf, [u8; 32])>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
pub fn set_test_master_key(key: Option<[u8; 32]>) {
    *TEST_MASTER_KEY.lock().expect("test master key lock") = key;
    clear_cached_master_key();
}

fn clear_cached_master_key() {
    if let Ok(mut guard) = CACHED_MASTER_KEY.lock() {
        *guard = None;
    }
}

pub fn encrypt_store_plaintext(
    plaintext: &str,
    app_data_dir: &Path,
) -> io::Result<EncryptedProviderAccountsFile> {
    let key = master_key_bytes(app_data_dir, true)?;
    let envelope = encrypt_aes_256_gcm_envelope(plaintext, &key)?;
    Ok(EncryptedProviderAccountsFile {
        format: STORE_FORMAT_V1.to_string(),
        envelope,
    })
}

pub fn decrypt_store_envelope(envelope: &str, app_data_dir: &Path) -> io::Result<String> {
    let (key, from_cache) = master_key_bytes_with_cache_info(app_data_dir, false)?;
    match decrypt_aes_256_gcm_envelope(envelope, &key) {
        Ok(plaintext) => Ok(plaintext),
        Err(err) if from_cache && err.kind() == io::ErrorKind::InvalidData => {
            clear_cached_master_key();
            let (fresh_key, _) = master_key_bytes_with_cache_info(app_data_dir, false)?;
            decrypt_aes_256_gcm_envelope(envelope, &fresh_key)
        }
        Err(err) => Err(err),
    }
}

pub fn is_legacy_plaintext_store(text: &str) -> bool {
    let trimmed = text.trim();
    if !trimmed.starts_with('{') {
        return false;
    }
    serde_json::from_str::<EncryptedProviderAccountsFile>(trimmed)
        .map(|wrapper| wrapper.format != STORE_FORMAT_V1)
        .unwrap_or(true)
}

fn master_key_bytes(app_data_dir: &Path, allow_create: bool) -> io::Result<[u8; 32]> {
    master_key_bytes_with_cache_info(app_data_dir, allow_create).map(|(key, _)| key)
}

fn master_key_bytes_with_cache_info(
    app_data_dir: &Path,
    allow_create: bool,
) -> io::Result<([u8; 32], bool)> {
    #[cfg(test)]
    {
        if let Some(key) = *TEST_MASTER_KEY.lock().expect("test master key lock") {
            return Ok((key, false));
        }
    }

    if let Ok(guard) = CACHED_MASTER_KEY.lock() {
        if let Some((cached_dir, cached_key)) = guard.as_ref() {
            if cached_dir == app_data_dir {
                return Ok((*cached_key, true));
            }
        }
    }

    let key_b64 = read_or_create_master_key(app_data_dir, allow_create).map_err(io::Error::other)?;
    let decoded = decode_master_key_b64(&key_b64)?;
    if let Ok(mut guard) = CACHED_MASTER_KEY.lock() {
        *guard = Some((app_data_dir.to_path_buf(), decoded));
    }
    Ok((decoded, false))
}

fn decode_master_key_b64(key_b64: &str) -> io::Result<[u8; 32]> {
    let key = BASE64_STANDARD
        .decode(key_b64.trim())
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    if key.len() != 32 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid provider accounts master key length: {}", key.len()),
        ));
    }
    let mut out = [0_u8; 32];
    out.copy_from_slice(&key);
    Ok(out)
}

fn master_key_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(".provider_accounts_master_key")
}

#[derive(Debug, PartialEq, Eq)]
enum KeyringReadResult {
    Found(String),
    NotFound,
    Unavailable(String),
}

fn resolve_keychain_master_key_with<R, C>(
    read_fn: R,
    create_fn: C,
    allow_create: bool,
) -> Result<String, String>
where
    R: FnOnce() -> KeyringReadResult,
    C: FnOnce() -> Result<String, String>,
{
    match read_fn() {
        KeyringReadResult::Found(existing) => Ok(existing),
        KeyringReadResult::NotFound => {
            if allow_create {
                create_fn()
            } else {
                Err("provider accounts master key not found in keychain".to_string())
            }
        }
        // Never attempt to create/overwrite a key when secure storage is locked or unavailable.
        KeyringReadResult::Unavailable(err) => Err(err),
    }
}

fn resolve_master_key_with<R, C>(
    app_data_dir: &Path,
    allow_create: bool,
    read_keychain: R,
    create_keychain: C,
) -> Result<String, String>
where
    R: FnOnce() -> KeyringReadResult,
    C: FnOnce() -> Result<String, String>,
{
    match resolve_keychain_master_key_with(read_keychain, create_keychain, allow_create) {
        Ok(key) => Ok(key),
        Err(keychain_err) => {
            if let Some(existing) = read_existing_file_master_key(app_data_dir)? {
                log::warn!(
                    "provider accounts keychain unavailable ({keychain_err}); using existing app-local master key file"
                );
                return Ok(existing);
            }
            if !allow_create {
                return Err(format!(
                    "provider accounts keychain unavailable ({keychain_err}) and no app-local master key file exists"
                ));
            }
            log::warn!(
                "provider accounts keychain unavailable ({keychain_err}); creating app-local master key file"
            );
            create_file_master_key(app_data_dir)
        }
    }
}

fn read_or_create_master_key(app_data_dir: &Path, allow_create: bool) -> Result<String, String> {
    resolve_master_key_with(
        app_data_dir,
        allow_create,
        || read_platform_keyring_password(KEYCHAIN_SERVICE, Some(KEYCHAIN_ACCOUNT)),
        create_keychain_master_key,
    )
}

fn read_existing_file_master_key(app_data_dir: &Path) -> Result<Option<String>, String> {
    let path = master_key_file_path(app_data_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    Ok(Some(trimmed.to_string()))
}

fn create_file_master_key(app_data_dir: &Path) -> Result<String, String> {
    let path = master_key_file_path(app_data_dir);
    let encoded = create_random_key_b64();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&path, format!("{encoded}\n")).map_err(|err| err.to_string())?;
    restrict_private_file_permissions(&path)?;
    Ok(encoded)
}

fn create_random_key_b64() -> String {
    let mut raw = [0_u8; 32];
    OsRng.fill_bytes(&mut raw);
    BASE64_STANDARD.encode(raw)
}

#[cfg(unix)]
fn restrict_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|err| err.to_string())
}

#[cfg(not(unix))]
fn restrict_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn create_keychain_master_key() -> Result<String, String> {
    let encoded = create_random_key_b64();
    write_platform_keyring_password(KEYCHAIN_SERVICE, Some(KEYCHAIN_ACCOUNT), &encoded)?;
    Ok(encoded)
}

fn encrypt_aes_256_gcm_envelope(plaintext: &str, key: &[u8; 32]) -> io::Result<String> {
    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher = Aes256Gcm16::new_from_slice(key)
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err.to_string()))?;
    let mut iv = [0_u8; 16];
    OsRng.fill_bytes(&mut iv);
    let nonce = Nonce::<U16>::from_slice(&iv);
    let ciphertext_and_tag = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::Other, "encrypt finalize failed"))?;
    if ciphertext_and_tag.len() < 16 {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "encrypted payload missing auth tag",
        ));
    }
    let split_at = ciphertext_and_tag.len() - 16;
    let (ciphertext, tag) = ciphertext_and_tag.split_at(split_at);
    Ok(format!(
        "{}:{}:{}",
        BASE64_STANDARD.encode(iv),
        BASE64_STANDARD.encode(tag),
        BASE64_STANDARD.encode(ciphertext)
    ))
}

fn decrypt_aes_256_gcm_envelope(envelope: &str, key: &[u8; 32]) -> io::Result<String> {
    let parts: Vec<&str> = envelope.split(':').collect();
    if parts.len() != 3 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid encrypted provider accounts envelope",
        ));
    }

    let iv = BASE64_STANDARD
        .decode(parts[0])
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    if iv.len() != 16 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid AES-GCM iv length: {}", iv.len()),
        ));
    }

    let tag = BASE64_STANDARD
        .decode(parts[1])
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    if tag.len() != 16 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid AES-GCM auth tag length: {}", tag.len()),
        ));
    }

    let ciphertext = BASE64_STANDARD
        .decode(parts[2])
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;

    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher = Aes256Gcm16::new_from_slice(key)
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err.to_string()))?;
    let nonce = Nonce::<U16>::from_slice(&iv);
    let mut ciphertext_and_tag = ciphertext;
    ciphertext_and_tag.extend_from_slice(&tag);
    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag.as_ref())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "decrypt finalize failed"))?;
    String::from_utf8(plaintext).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

#[cfg(target_os = "linux")]
fn dbus_session_bus_address() -> Option<String> {
    if let Ok(addr) = std::env::var("DBUS_SESSION_BUS_ADDRESS") {
        let trimmed = addr.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let uid = unsafe { libc::getuid() };
    let bus_path = format!("/run/user/{uid}/bus");
    if std::path::Path::new(&bus_path).exists() {
        return Some(format!("unix:path={bus_path}"));
    }
    None
}

#[cfg(target_os = "linux")]
fn read_linux_secret_tool_password(service: &str, account: Option<&str>) -> Result<String, String> {
    let secret_tool = ["secret-tool", "/usr/bin/secret-tool"]
        .into_iter()
        .find(|path| std::path::Path::new(path).is_file());
    let secret_tool = secret_tool.ok_or_else(|| {
        "secret-tool not installed (install libsecret-tools for Linux keyring access)".to_string()
    })?;

    let mut cmd = std::process::Command::new(secret_tool);
    cmd.arg("lookup").arg("service").arg(service);
    if let Some(user) = account.map(str::trim).filter(|a| !a.is_empty()) {
        cmd.arg("username").arg(user);
    }
    if let Some(addr) = dbus_session_bus_address() {
        cmd.env("DBUS_SESSION_BUS_ADDRESS", addr);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("secret-tool failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let first_line = stderr.lines().next().unwrap_or("").trim();
        return Err(if first_line.is_empty() {
            "secret-tool lookup returned no entry".to_string()
        } else {
            first_line.to_string()
        });
    }
    let password = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if password.is_empty() {
        return Err("secret-tool lookup returned empty secret".to_string());
    }
    Ok(password)
}

#[cfg(target_os = "windows")]
fn windows_go_keyring_target(service: &str, user: &str) -> String {
    format!("{service}:{user}")
}

#[cfg(target_os = "windows")]
fn read_windows_keyring_password(service: &str, account: Option<&str>) -> KeyringReadResult {
    let user = account.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("");
    let mut unavailable_errors: Vec<String> = Vec::new();
    let mut saw_no_entry = false;

    if !user.is_empty() {
        let go_target = windows_go_keyring_target(service, user);
        match keyring::Entry::new_with_target(&go_target, service, user) {
            Ok(entry) => match entry.get_password() {
                Ok(password) if !password.trim().is_empty() => {
                    return KeyringReadResult::Found(password)
                }
                Ok(_) => saw_no_entry = true,
                Err(keyring::Error::NoEntry) => saw_no_entry = true,
                Err(e) => unavailable_errors.push(format!("go-keyring target {go_target}: {e}")),
            },
            Err(e) => unavailable_errors.push(format!("go-keyring target {go_target}: {e}")),
        }
    }

    match keyring::Entry::new(service, user) {
        Ok(entry) => match entry.get_password() {
            Ok(password) if !password.trim().is_empty() => {
                return KeyringReadResult::Found(password)
            }
            Ok(_) => saw_no_entry = true,
            Err(keyring::Error::NoEntry) => saw_no_entry = true,
            Err(e) => unavailable_errors.push(format!("keyring crate default: {e}")),
        },
        Err(e) => unavailable_errors.push(format!("keyring crate default: {e}")),
    }

    if !unavailable_errors.is_empty() {
        KeyringReadResult::Unavailable(unavailable_errors.join("; "))
    } else if saw_no_entry {
        KeyringReadResult::NotFound
    } else {
        KeyringReadResult::NotFound
    }
}

#[cfg(target_os = "windows")]
fn write_windows_keyring_password(
    service: &str,
    account: Option<&str>,
    value: &str,
) -> Result<(), String> {
    let user = account.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("");
    if !user.is_empty() {
        let go_target = windows_go_keyring_target(service, user);
        if let Ok(entry) = keyring::Entry::new_with_target(&go_target, service, user) {
            if entry.set_password(value).is_ok() {
                return Ok(());
            }
        }
    }
    keyring::Entry::new(service, user)
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

fn write_platform_keyring_password(
    service: &str,
    account: Option<&str>,
    value: &str,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return write_windows_keyring_password(service, account, value);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let user = account.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("");
        keyring::Entry::new(service, user)
            .map_err(|e| e.to_string())?
            .set_password(value)
            .map_err(|e| e.to_string())
    }
}

fn read_platform_keyring_password(service: &str, account: Option<&str>) -> KeyringReadResult {
    #[cfg(target_os = "windows")]
    {
        return read_windows_keyring_password(service, account);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let user = account.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("");
        match keyring::Entry::new(service, user) {
            Ok(entry) => match entry.get_password() {
                Ok(password) if !password.trim().is_empty() => {
                    return KeyringReadResult::Found(password)
                }
                Ok(_) => return KeyringReadResult::NotFound,
                Err(keyring::Error::NoEntry) => {
                    // Entry genuinely absent in default keyring; on Linux check secret-tool once
                    // in case an existing entry was stored with different attributes.
                }
                Err(e) => {
                    // Locked keyring, dismissed unlock prompt, or D-Bus error — do NOT fall
                    // through to secret-tool or key creation (would trigger duplicate prompts).
                    return KeyringReadResult::Unavailable(e.to_string());
                }
            },
            Err(e) => return KeyringReadResult::Unavailable(e.to_string()),
        };

        #[cfg(target_os = "linux")]
        {
            match read_linux_secret_tool_password(service, account) {
                Ok(password) => KeyringReadResult::Found(password),
                Err(err)
                    if err.contains("returned no entry")
                        || err.contains("returned empty secret")
                        || err.contains("secret-tool not installed") =>
                {
                    KeyringReadResult::NotFound
                }
                Err(err) => KeyringReadResult::Unavailable(err),
            }
        }

        #[cfg(not(target_os = "linux"))]
        {
            KeyringReadResult::NotFound
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn test_key() -> [u8; 32] {
        let mut key = [0_u8; 32];
        for (index, byte) in key.iter_mut().enumerate() {
            *byte = index as u8;
        }
        key
    }

    #[test]
    #[serial]
    fn encrypt_decrypt_roundtrip() {
        set_test_master_key(Some(test_key()));
        let dir = std::env::temp_dir();
        let plaintext = r#"{"accounts":{"claude:work":{"instanceId":"claude:work"}}}"#;
        let encrypted = encrypt_store_plaintext(plaintext, &dir).expect("encrypt");
        assert_eq!(encrypted.format, STORE_FORMAT_V1);
        assert!(!encrypted.envelope.contains("accessToken"));
        let decrypted = decrypt_store_envelope(&encrypted.envelope, &dir).expect("decrypt");
        assert_eq!(decrypted, plaintext);
        set_test_master_key(None);
    }

    #[test]
    fn legacy_plaintext_detection() {
        assert!(is_legacy_plaintext_store(
            r#"{"accounts":{"cursor:work":{"credential":{"accessToken":"secret"}}}}"#
        ));
        let encrypted = EncryptedProviderAccountsFile {
            format: STORE_FORMAT_V1.to_string(),
            envelope: "a:b:c".into(),
        };
        let text = serde_json::to_string(&encrypted).expect("serialize");
        assert!(!is_legacy_plaintext_store(&text));
    }

    #[test]
    fn unavailable_keychain_never_calls_create() {
        let mut created = false;
        let res = resolve_keychain_master_key_with(
            || KeyringReadResult::Unavailable("Secret Service: unlock prompt was dismissed".into()),
            || {
                created = true;
                Ok("new-key".into())
            },
            true,
        );
        assert!(res.is_err());
        assert!(!created, "locked/unavailable keyring must never trigger create");
    }

    #[test]
    fn not_found_keychain_creates_only_when_allowed() {
        let mut created = false;
        let denied = resolve_keychain_master_key_with(
            || KeyringReadResult::NotFound,
            || {
                created = true;
                Ok("new-key".into())
            },
            false,
        );
        assert!(denied.is_err());
        assert!(!created);

        let allowed = resolve_keychain_master_key_with(
            || KeyringReadResult::NotFound,
            || {
                created = true;
                Ok("new-key".into())
            },
            true,
        );
        assert_eq!(allowed.as_deref(), Ok("new-key"));
        assert!(created);
    }

    #[test]
    fn decrypt_does_not_fabricate_master_key_file_when_keychain_unavailable() {
        let dir = std::env::temp_dir().join(format!(
            "crossusage-crypto-no-fabricate-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");

        let res = resolve_master_key_with(
            &dir,
            false,
            || KeyringReadResult::Unavailable("unlock prompt was dismissed".into()),
            || panic!("must not attempt keychain create"),
        );
        assert!(res.is_err());
        assert!(
            !master_key_file_path(&dir).exists(),
            "decrypt path must not create a brand-new .provider_accounts_master_key file"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
