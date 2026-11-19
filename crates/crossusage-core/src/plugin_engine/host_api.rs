use aes_gcm::{
    AesGcm, Nonce,
    aead::{Aead, KeyInit, OsRng, generic_array::typenum::U16, rand_core::RngCore},
    aes::Aes256,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use crate::provider_accounts::{self, ProviderAccountContext, ProviderCredential};
use rquickjs::{function::Rest, Ctx, Exception, Function, Object};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value as JsonValue};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
#[cfg(test)]
use std::collections::VecDeque;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const MIN_BLOCKING_TIMEOUT: Duration = Duration::from_millis(1);

#[derive(Clone, Copy, Debug)]
pub(crate) struct ProbeDeadline {
    expires_at: Option<Instant>,
}

impl ProbeDeadline {
    pub(crate) fn none() -> Self {
        Self { expires_at: None }
    }

    pub(crate) fn at(expires_at: Instant) -> Self {
        Self {
            expires_at: Some(expires_at),
        }
    }

    pub(crate) fn has_elapsed(self) -> bool {
        self.expires_at
            .map(|expires_at| Instant::now() >= expires_at)
            .unwrap_or(false)
    }

    fn clamp_duration(self, requested: Duration) -> Option<Duration> {
        let Some(expires_at) = self.expires_at else {
            return Some(requested);
        };
        let remaining = expires_at
            .checked_duration_since(Instant::now())
            .filter(|remaining| *remaining >= MIN_BLOCKING_TIMEOUT)?;
        Some(requested.min(remaining))
    }
}

fn log_probe_deadline_skip(plugin_id: &str, operation: &str) {
    log::warn!(
        "[plugin:{}] {} skipped: probe timed out",
        plugin_id,
        operation
    );
}

const WHITELISTED_ENV_VARS: [&str; 27] = [
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CROFAI_API_KEY",
    "USER_TYPE",
    "USE_STAGING_OAUTH",
    "USE_LOCAL_OAUTH",
    "CLAUDE_CODE_CUSTOM_OAUTH_URL",
    "CLAUDE_CODE_OAUTH_CLIENT_ID",
    "CLAUDE_LOCAL_OAUTH_API_BASE",
    "ZAI_API_KEY",
    "GLM_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_API_TOKEN",
    "MINIMAX_CN_API_KEY",
    "SYNTHETIC_API_KEY",
    "PI_CODING_AGENT_DIR",
    "COMMAND_CODE_API_KEY",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_INITIAL_BALANCE",
    "OLLAMA_API_KEY",
    "OLLAMA_HOST",
    "OLLAMA_SESSION_COOKIE",
    "OLLAMA_COOKIE",
    "GEMINI_COOKIE",
    "NEURALWATT_API_KEY",
    "FIREWORKS_API_KEY",
];

const FIRECTL_TIMEOUT_SECS: u64 = 15;
const FIRECTL_POLL_INTERVAL_MS: u64 = 50;

fn last_non_empty_trimmed_line(text: &str) -> Option<String> {
    text.lines()
        .map(|line| line.trim())
        .rev()
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn sanitize_env_value(text: &str) -> Option<String> {
    let mut cleaned = if let Ok(ansi_re) = regex_lite::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]") {
        ansi_re.replace_all(text, "").to_string()
    } else {
        text.to_string()
    };
    cleaned.retain(|ch| ch == '\n' || ch == '\r' || ch == '\t' || !ch.is_control());
    last_non_empty_trimmed_line(&cleaned)
}

fn extract_marked_value(text: &str, start_marker: &str, end_marker: &str) -> Option<String> {
    let start = text.find(start_marker)?;
    let after_start = &text[start + start_marker.len()..];
    let end = after_start.find(end_marker)?;
    sanitize_env_value(&after_start[..end])
}

fn parse_interactive_shell_env_output(
    text: &str,
    start_marker: &str,
    end_marker: &str,
) -> Option<String> {
    if let Some(marked) = extract_marked_value(text, start_marker, end_marker) {
        return Some(marked);
    }

    let has_complete_markers = text.contains(start_marker) && text.contains(end_marker);
    if has_complete_markers {
        return None;
    }

    sanitize_env_value(text)
}

fn read_env_from_process(name: &str) -> Option<String> {
    let value = std::env::var(name).ok()?;
    sanitize_env_value(&value)
}

fn read_command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn read_env_value_via_command(program: &str, args: &[&str]) -> Option<String> {
    let stdout = read_command_stdout(program, args)?;
    sanitize_env_value(&stdout)
}

fn terminal_env_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn shell_from_env() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    let trimmed = shell.trim();
    if trimmed.is_empty() {
        return None;
    }
    let file = std::path::Path::new(trimmed).file_name()?.to_string_lossy();
    let allowed = file == "zsh" || file == "bash" || file == "fish";
    if allowed {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn read_env_from_interactive_shell(program: &str, name: &str) -> Option<String> {
    const START_MARKER: &str = "__OPENUSAGE_ENV_START__";
    const END_MARKER: &str = "__OPENUSAGE_ENV_END__";

    let script = format!(
        "printf '{}\\n'; printenv {}; printf '{}\\n'",
        START_MARKER, name, END_MARKER
    );
    let output = read_command_stdout(program, &["-ilc", script.as_str()])?;
    parse_interactive_shell_env_output(&output, START_MARKER, END_MARKER)
}

fn read_env_from_interactive_shells(name: &str) -> Option<String> {
    let mut programs: Vec<String> = Vec::new();

    if let Some(shell) = shell_from_env() {
        programs.push(shell);
    }

    for program in [
        "/bin/zsh",
        "/bin/bash",
        "/opt/homebrew/bin/fish",
        "/usr/local/bin/fish",
        "/opt/local/bin/fish",
    ] {
        if !programs.iter().any(|p| p == program) {
            programs.push(program.to_string());
        }
    }

    for program in programs {
        if let Some(value) = read_env_from_interactive_shell(program.as_str(), name) {
            return Some(value);
        }
    }

    None
}

fn resolve_env_value(name: &str) -> Option<String> {
    // Prefer the current process env (fast + supports launchctl/terminal-launch).
    if let Some(value) = read_env_from_process(name) {
        return Some(value);
    }

    if let Ok(cache) = terminal_env_cache().lock() {
        if let Some(cached) = cache.get(name) {
            return cached.clone();
        }
    }

    let resolved = read_env_from_interactive_shells(name);
    if let Ok(mut cache) = terminal_env_cache().lock() {
        cache.insert(name.to_string(), resolved.clone());
    }
    resolved
}

fn current_macos_keychain_account_from_user_env(user_env: Option<String>) -> String {
    user_env
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| read_env_value_via_command("id", &["-un"]))
        .unwrap_or_else(|| "crossusage-user".to_string())
}

fn current_macos_keychain_account() -> String {
    current_macos_keychain_account_from_user_env(read_env_from_process("USER"))
}

fn keychain_find_generic_password_args(service: &str) -> Vec<OsString> {
    vec![
        OsString::from("find-generic-password"),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
    ]
}

fn keychain_find_generic_password_args_for_account(service: &str, account: &str) -> Vec<OsString> {
    vec![
        OsString::from("find-generic-password"),
        OsString::from("-a"),
        OsString::from(account),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
    ]
}

fn keychain_add_generic_password_args(service: &str, value: &str) -> Vec<OsString> {
    vec![
        OsString::from("add-generic-password"),
        OsString::from("-U"),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
        OsString::from(value),
    ]
}

fn keychain_add_generic_password_args_for_account(
    service: &str,
    account: &str,
    value: &str,
) -> Vec<OsString> {
    vec![
        OsString::from("add-generic-password"),
        OsString::from("-U"),
        OsString::from("-a"),
        OsString::from(account),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
        OsString::from(value),
    ]
}

/// Redact sensitive value to first4...last4 format (UTF-8 safe)
fn redact_value(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 12 {
        "[REDACTED]".to_string()
    } else {
        let first4: String = chars.iter().take(4).collect();
        let last4: String = chars
            .iter()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{}...{}", first4, last4)
    }
}

/// Redact sensitive query parameters in URL
fn redact_url(url: &str) -> String {
    static ACCOUNT_PATH_PATTERN: OnceLock<regex_lite::Regex> = OnceLock::new();
    let account_path_pattern = ACCOUNT_PATH_PATTERN.get_or_init(|| {
        regex_lite::Regex::new(r"(?P<prefix>/accounts/)(?P<value>[^/?#]+)")
            .expect("valid account path regex")
    });
    let sensitive_params = [
        "key",
        "api_key",
        "apikey",
        "token",
        "access_token",
        "secret",
        "password",
        "auth",
        "authorization",
        "bearer",
        "credential",
        "user",
        "user_id",
        "userid",
        "account_id",
        "accountid",
        "profilearn",
        "profile_arn",
        "email",
        "login",
        "cookie",
        "sid",
        "sapisid",
    ];

    let url = account_path_pattern
        .replace_all(url, |caps: &regex_lite::Captures| {
            format!("{}{}", &caps["prefix"], redact_value(&caps["value"]))
        })
        .to_string();

    if let Some(query_start) = url.find('?') {
        let (base, query) = url.split_at(query_start + 1);
        let redacted_params: Vec<String> = query
            .split('&')
            .map(|param| {
                if let Some(eq_pos) = param.find('=') {
                    let (name, value) = param.split_at(eq_pos);
                    let value = &value[1..]; // skip '='
                    let name_lower = name.to_lowercase();
                    if sensitive_params.iter().any(|s| name_lower.contains(s)) && !value.is_empty()
                    {
                        format!("{}={}", name, redact_value(value))
                    } else {
                        param.to_string()
                    }
                } else {
                    param.to_string()
                }
            })
            .collect();
        format!("{}{}", base, redacted_params.join("&"))
    } else {
        url
    }
}

fn redact_google_cookie_pairs(text: &str) -> String {
    static COOKIE_PAIR_RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    let cookie_pair_re = COOKIE_PAIR_RE.get_or_init(|| {
        regex_lite::Regex::new(
            r"(?i)(__Secure-1PSIDTS|__Secure-1PAPISID|__Secure-3PSID|__Secure-1PSID|SAPISID|APISID|HSID|SSID|SIDCC|NID|SID)=([^\s;]+)",
        )
        .expect("valid google cookie pair regex")
    });
    cookie_pair_re
        .replace_all(text, |caps: &regex_lite::Captures| {
            format!("{}={}", &caps[1], redact_value(&caps[2]))
        })
        .into_owned()
}

/// Redact sensitive patterns in response body for logging
fn redact_body(body: &str) -> String {
    let mut result = redact_google_cookie_pairs(body);

    // Redact JWTs and JWEs (eyJ... pattern with 3 to 5 dot-separated segments, e.g. next-auth session cookies)
    let jwt_pattern =
        regex_lite::Regex::new(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){1,3}").unwrap();
    result = jwt_pattern
        .replace_all(&result, |caps: &regex_lite::Captures| {
            redact_value(&caps[0])
        })
        .to_string();

    // Redact common API key patterns (sk-xxx, pk-xxx, api_xxx, etc.)
    let api_key_pattern =
        regex_lite::Regex::new(r#"["']?(sk-|pk-|api_|key_|secret_)[A-Za-z0-9_-]{12,}["']?"#)
            .unwrap();
    result = api_key_pattern
        .replace_all(&result, |caps: &regex_lite::Captures| {
            let key = caps[0].trim_matches(|c| c == '"' || c == '\'');
            redact_value(key)
        })
        .to_string();

    if let Ok(devin_session_re) =
        regex_lite::Regex::new(r#"devin-session-token\$[^\s"',}\]]+"#)
    {
        result = devin_session_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                redact_value(&caps[0])
            })
            .to_string();
    }

    // Redact JSON values for sensitive keys
    let sensitive_keys = [
        "name",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "secret",
        "api_key",
        "apiKey",
        "authorization",
        "bearer",
        "credential",
        "session_token",
        "sessionToken",
        "auth_token",
        "authToken",
        "id_token",
        "idToken",
        "accessToken",
        "refreshToken",
        "user_id",
        "userId",
        "account_id",
        "accountId",
        "team_id",
        "teamId",
        "org_id",
        "orgId",
        "account_display_name",
        "accountDisplayName",
        "payment_id",
        "paymentId",
        "profile_arn",
        "profileArn",
        "email",
        "login",
        "username",
        "rpc_token",
        "simpleToken",
        "analytics_tracking_id",
        "uuid",
    ];
    for key in sensitive_keys {
        // Match "key": "value" or "key":"value"
        let pattern = format!(r#""{}":\s*"([^"]+)""#, key);
        if let Ok(re) = regex_lite::Regex::new(&pattern) {
            result = re
                .replace_all(&result, |caps: &regex_lite::Captures| {
                    let value = &caps[1];
                    format!("\"{}\": \"{}\"", key, redact_value(value))
                })
                .to_string();
        }
    }

    // Redact email addresses even in HTML/text responses.
    if let Ok(email_re) =
        regex_lite::Regex::new(r"[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}")
    {
        result = email_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                redact_value(&caps[0])
            })
            .to_string();
    }

    if let Ok(path_re) =
        regex_lite::Regex::new(r#"(/(?:Users|home|opt|private|var|tmp|Applications)/[^\s"')]+)"#)
    {
        result = path_re.replace_all(&result, "[PATH]").to_string();
    }

    result
}

/// Lightweight redaction for plugin log messages (JWT + API key patterns only).
fn redact_log_message(msg: &str) -> String {
    let mut result = redact_google_cookie_pairs(msg);
    if let Ok(email_re) =
        regex_lite::Regex::new(r"[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}")
    {
        result = email_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                redact_value(&caps[0])
            })
            .to_string();
    }
    if let Ok(jwt_re) = regex_lite::Regex::new(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
    {
        result = jwt_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                redact_value(&caps[0])
            })
            .to_string();
    }
    if let Ok(api_re) = regex_lite::Regex::new(r#"(sk-|pk-|api_|key_|secret_)[A-Za-z0-9_-]{12,}"#) {
        result = api_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                redact_value(&caps[0])
            })
            .to_string();
    }
    if let Ok(devin_session_re) =
        regex_lite::Regex::new(r#"devin-session-token\$[^\s"',}\]]+"#)
    {
        result = devin_session_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                redact_value(&caps[0])
            })
            .to_string();
    }
    if let Ok(account_re) = regex_lite::Regex::new(r#"(account=)([^,\s]+)"#) {
        result = account_re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                format!("{}{}", &caps[1], redact_value(&caps[2]))
            })
            .to_string();
    }
    if let Ok(path_re) =
        regex_lite::Regex::new(r#"(/(?:Users|home|opt|private|var|tmp|Applications)/[^\s"')]+)"#)
    {
        result = path_re.replace_all(&result, "[PATH]").to_string();
    }
    result
}

fn decrypt_aes_256_gcm_envelope(envelope: &str, key_b64: &str) -> Result<String, String> {
    let trimmed_envelope = envelope.trim();
    let trimmed_key = key_b64.trim();
    let parts: Vec<&str> = trimmed_envelope.split(':').collect();
    if parts.len() != 3 {
        return Err("invalid AES-GCM envelope".to_string());
    }

    let key = BASE64_STANDARD
        .decode(trimmed_key)
        .map_err(|e| format!("invalid base64 key: {}", e))?;
    if key.len() != 32 {
        return Err(format!(
            "invalid AES-256 key length: expected 32 bytes, got {}",
            key.len()
        ));
    }

    let iv = BASE64_STANDARD
        .decode(parts[0])
        .map_err(|e| format!("invalid base64 iv: {}", e))?;
    if iv.len() != 16 {
        return Err(format!(
            "invalid AES-GCM iv length: expected 16 bytes, got {}",
            iv.len()
        ));
    }

    let tag = BASE64_STANDARD
        .decode(parts[1])
        .map_err(|e| format!("invalid base64 auth tag: {}", e))?;
    if tag.len() != 16 {
        return Err(format!(
            "invalid AES-GCM auth tag length: expected 16 bytes, got {}",
            tag.len()
        ));
    }

    let ciphertext = BASE64_STANDARD
        .decode(parts[2])
        .map_err(|e| format!("invalid base64 ciphertext: {}", e))?;

    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher =
        Aes256Gcm16::new_from_slice(&key).map_err(|e| format!("decrypt init failed: {}", e))?;
    let nonce = Nonce::<U16>::from_slice(&iv);

    let mut ciphertext_and_tag = ciphertext;
    ciphertext_and_tag.extend_from_slice(&tag);
    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag.as_ref())
        .map_err(|_| "decrypt finalize failed".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("decrypted payload is not UTF-8: {}", e))
}

fn encrypt_aes_256_gcm_envelope(plaintext: &str, key_b64: &str) -> Result<String, String> {
    let trimmed_key = key_b64.trim();
    let key = BASE64_STANDARD
        .decode(trimmed_key)
        .map_err(|e| format!("invalid base64 key: {}", e))?;
    if key.len() != 32 {
        return Err(format!(
            "invalid AES-256 key length: expected 32 bytes, got {}",
            key.len()
        ));
    }

    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher =
        Aes256Gcm16::new_from_slice(&key).map_err(|e| format!("encrypt init failed: {}", e))?;
    let mut iv = [0_u8; 16];
    OsRng.fill_bytes(&mut iv);
    let nonce = Nonce::<U16>::from_slice(&iv);
    let ciphertext_and_tag = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| "encrypt finalize failed".to_string())?;
    if ciphertext_and_tag.len() < 16 {
        return Err("encrypted payload missing auth tag".to_string());
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

pub fn inject_host_api<'js>(
    ctx: &Ctx<'js>,
    base_plugin_id: &str,
    instance_id: &str,
    account: Option<&ProviderAccountContext>,
    app_data_dir: &PathBuf,
    app_version: &str,
) -> rquickjs::Result<()> {
    inject_host_api_with_deadline(
        ctx,
        base_plugin_id,
        instance_id,
        account,
        app_data_dir,
        app_version,
        ProbeDeadline::none(),
    )
}

pub(crate) fn inject_host_api_with_deadline<'js>(
    ctx: &Ctx<'js>,
    base_plugin_id: &str,
    instance_id: &str,
    account: Option<&ProviderAccountContext>,
    app_data_dir: &PathBuf,
    app_version: &str,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let globals = ctx.globals();
    let probe_ctx = Object::new(ctx.clone())?;

    probe_ctx.set("nowIso", iso_now())?;

    let app_obj = Object::new(ctx.clone())?;
    app_obj.set("version", app_version)?;
    app_obj.set("platform", std::env::consts::OS)?;
    app_obj.set("appDataDir", app_data_dir.to_string_lossy().to_string())?;
    let plugin_data_dir = app_data_dir.join("plugins_data").join(instance_id);
    if let Err(err) = std::fs::create_dir_all(&plugin_data_dir) {
        log::warn!(
            "[plugin:{}] failed to create plugin data dir: {}",
            instance_id,
            err
        );
    }
    app_obj.set(
        "pluginDataDir",
        plugin_data_dir.to_string_lossy().to_string(),
    )?;
    probe_ctx.set("app", app_obj)?;

    let account_obj = Object::new(ctx.clone())?;
    account_obj.set("instanceId", instance_id)?;
    account_obj.set("baseProviderId", base_plugin_id)?;
    account_obj.set("label", account.map(|a| a.label.as_str()).unwrap_or(""))?;
    probe_ctx.set("account", account_obj)?;

    let host = Object::new(ctx.clone())?;
    let host_account_obj = Object::new(ctx.clone())?;
    host_account_obj.set("instanceId", instance_id)?;
    host_account_obj.set("baseProviderId", base_plugin_id)?;
    host_account_obj.set("label", account.map(|a| a.label.as_str()).unwrap_or(""))?;
    host.set("account", host_account_obj)?;
    inject_log(ctx, &host, instance_id)?;
    inject_fs(ctx, &host)?;
    inject_cursor_paths(ctx, &host, base_plugin_id)?;
    inject_crypto(ctx, &host)?;
    inject_env(ctx, &host, base_plugin_id)?;
    inject_http(ctx, &host, instance_id, deadline)?;
    inject_credentials(ctx, &host, account)?;
    inject_keychain(ctx, &host, instance_id)?;
    inject_sqlite(ctx, &host)?;
    inject_chromium_cookies(ctx, &host, instance_id)?;
    inject_ls(ctx, &host, base_plugin_id)?;
    inject_usage_daily(ctx, &host, instance_id, app_data_dir)?;
    inject_cursor_logs(ctx, &host, base_plugin_id, deadline)?;
    inject_claude_logs(ctx, &host, deadline)?;
    inject_codex_logs(ctx, &host, deadline)?;
    inject_antigravity_logs(ctx, &host, deadline)?;
    inject_grok_logs(ctx, &host, deadline)?;
    inject_cursor_usage_export(ctx, &host, account, deadline)?;
    inject_fireworks(ctx, &host, base_plugin_id)?;

    probe_ctx.set("host", host)?;
    globals.set("__openusage_ctx", probe_ctx)?;

    Ok(())
}

fn inject_log<'js>(ctx: &Ctx<'js>, host: &Object<'js>, plugin_id: &str) -> rquickjs::Result<()> {
    let log_obj = Object::new(ctx.clone())?;

    let pid = plugin_id.to_string();
    log_obj.set(
        "info",
        Function::new(ctx.clone(), move |msg: String| {
            log::info!("[plugin:{}] {}", pid, redact_log_message(&msg));
        })?,
    )?;

    let pid = plugin_id.to_string();
    log_obj.set(
        "warn",
        Function::new(ctx.clone(), move |msg: String| {
            log::warn!("[plugin:{}] {}", pid, redact_log_message(&msg));
        })?,
    )?;

    let pid = plugin_id.to_string();
    log_obj.set(
        "error",
        Function::new(ctx.clone(), move |msg: String| {
            log::error!("[plugin:{}] {}", pid, redact_log_message(&msg));
        })?,
    )?;

    host.set("log", log_obj)?;
    Ok(())
}

fn home_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir()
        .or_else(|| std::env::var_os("HOME").map(std::path::PathBuf::from))
        .or_else(|| {
            #[cfg(windows)]
            {
                std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)
            }
            #[cfg(not(windows))]
            {
                None
            }
        })
}

/// Tilde paths for VS Code–style app data under Linux XDG, macOS Library, and Windows Roaming.
fn app_support_path_candidates(relative: &str) -> Vec<String> {
    let rel = relative.trim_start_matches(['/', '\\']);
    vec![
        format!("~/.config/{rel}"),
        format!("~/Library/Application Support/{rel}"),
        format!("~/AppData/Roaming/{rel}"),
    ]
}

fn first_existing_path(paths: &[String]) -> Option<String> {
    for path in paths {
        let expanded = expand_path(path);
        if std::path::Path::new(&expanded).exists() {
            return Some(path.clone());
        }
    }
    None
}

fn first_existing_app_support_path(relative: &str) -> Option<String> {
    first_existing_path(&app_support_path_candidates(relative))
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

/// Windows Credential Manager target for [zalando/go-keyring] (`agy`, Antigravity CLI): `service:username`.
/// The Rust `keyring` crate default is `username.service` instead — try go-keyring layout first.
#[cfg(target_os = "windows")]
fn windows_go_keyring_target(service: &str, user: &str) -> String {
    format!("{service}:{user}")
}

/// `zalando/go-keyring` writes raw UTF-8 bytes to Windows Credential Manager.
/// Rust `keyring::Entry::get_password` / `set_password` use UTF-16LE instead.
#[cfg(any(target_os = "windows", test))]
fn decode_windows_go_keyring_secret(secret: Vec<u8>) -> Result<String, String> {
    let value = String::from_utf8(secret)
        .map_err(|_| "go-keyring credential is not valid UTF-8".to_string())?;
    if value.trim().is_empty() {
        return Err("go-keyring credential is empty".to_string());
    }
    if value.contains('\0') {
        return Err("go-keyring credential unexpectedly contains NUL bytes".to_string());
    }
    Ok(value)
}

/// Decode a blob written by Rust `keyring` `set_password` (UTF-16LE, no BOM).
#[cfg(any(target_os = "windows", test))]
fn decode_windows_keyring_utf16le_secret(secret: &[u8]) -> Result<String, String> {
    if secret.is_empty() {
        return Err("UTF-16LE credential is empty".to_string());
    }
    if secret.len() % 2 != 0 {
        return Err("UTF-16LE credential has odd length".to_string());
    }
    let units: Vec<u16> = secret
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let value = String::from_utf16(&units)
        .map_err(|_| "credential is not valid UTF-16LE".to_string())?;
    if value.trim().is_empty() {
        return Err("UTF-16LE credential is empty".to_string());
    }
    if value.contains('\0') {
        return Err("UTF-16LE credential unexpectedly contains NUL bytes".to_string());
    }
    Ok(value)
}

/// Prefer go-keyring UTF-8, then keyring-crate UTF-16LE (same CM target can be either).
#[cfg(any(target_os = "windows", test))]
fn decode_windows_credential_blob(secret: Vec<u8>) -> Result<String, String> {
    match decode_windows_go_keyring_secret(secret.clone()) {
        Ok(value) => Ok(value),
        Err(utf8_err) => decode_windows_keyring_utf16le_secret(&secret)
            .map_err(|utf16_err| format!("{utf8_err}; then UTF-16LE: {utf16_err}")),
    }
}

#[cfg(target_os = "windows")]
fn read_windows_keyring_password(service: &str, account: Option<&str>) -> Result<String, String> {
    let user = account.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("");
    let mut errors: Vec<String> = Vec::new();

    if !user.is_empty() {
        let go_target = windows_go_keyring_target(service, user);
        match keyring::Entry::new_with_target(&go_target, service, user) {
            Ok(entry) => {
                // Prefer raw bytes: agy stores UTF-8; CrossUsage refresh may have stored UTF-16LE.
                match entry.get_secret() {
                    Ok(secret) => match decode_windows_credential_blob(secret) {
                        Ok(password) => return Ok(password),
                        Err(e) => errors.push(format!("go-keyring target {go_target} get_secret: {e}")),
                    },
                    Err(e) => errors.push(format!("go-keyring target {go_target} get_secret: {e}")),
                }
                // Same target via get_password (UTF-16LE path inside the crate).
                match entry.get_password() {
                    Ok(password) if !password.trim().is_empty() => return Ok(password),
                    Ok(_) => errors.push(format!(
                        "go-keyring target {go_target} get_password: empty"
                    )),
                    Err(e) => errors.push(format!("go-keyring target {go_target} get_password: {e}")),
                }
            }
            Err(e) => errors.push(format!("go-keyring target {go_target}: {e}")),
        }
    }

    match keyring::Entry::new(service, user) {
        Ok(entry) => match entry.get_password() {
            Ok(password) => return Ok(password),
            Err(e) => errors.push(format!("keyring crate default: {e}")),
        },
        Err(e) => errors.push(format!("keyring crate default: {e}")),
    }

    Err(errors.join("; "))
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
            // Write raw UTF-8 so `agy` / go-keyring can still read the same target.
            if entry.set_secret(value.as_bytes()).is_ok() {
                return Ok(());
            }
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

/// Reads a generic password from the platform store (Keychain, Secret Service, Credential Manager).
/// Matches [zalando/go-keyring](https://github.com/zalando/go-keyring) (`service` + `username` on Linux).
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

fn read_platform_keyring_password(service: &str, account: Option<&str>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return read_windows_keyring_password(service, account);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let user = account.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("");
        let keyring_err = match keyring::Entry::new(service, user) {
            Ok(entry) => match entry.get_password() {
                Ok(password) => return Ok(password),
                Err(e) => e.to_string(),
            },
            Err(e) => e.to_string(),
        };

        #[cfg(target_os = "linux")]
        {
            return read_linux_secret_tool_password(service, account)
                .map_err(|secret_tool_err| format!("{keyring_err}; {secret_tool_err}"));
        }

        #[cfg(not(target_os = "linux"))]
        {
            let _ = keyring_err;
            Err("keyring read failed".to_string())
        }
    }
}

fn inject_fs<'js>(ctx: &Ctx<'js>, host: &Object<'js>) -> rquickjs::Result<()> {
    let fs_obj = Object::new(ctx.clone())?;

    if let Some(home) = home_dir() {
        fs_obj.set("homeDir", home.to_string_lossy().to_string())?;
    }

    fs_obj.set(
        "exists",
        Function::new(ctx.clone(), move |path: String| -> bool {
            let expanded = expand_path(&path);
            std::path::Path::new(&expanded).exists()
        })?,
    )?;

    fs_obj.set(
        "readText",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, path: String| -> rquickjs::Result<String> {
                reject_path_traversal(&ctx_inner, &path)?;
                let expanded = expand_path(&path);
                std::fs::read_to_string(&expanded)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))
            },
        )?,
    )?;

    fs_obj.set(
        "writeText",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, path: String, content: String| -> rquickjs::Result<()> {
                reject_path_traversal(&ctx_inner, &path)?;
                let expanded = expand_path(&path);
                if let Some(parent) = std::path::Path::new(&expanded).parent() {
                    if !parent.as_os_str().is_empty() {
                        std::fs::create_dir_all(parent).map_err(|e| {
                            Exception::throw_message(&ctx_inner, &e.to_string())
                        })?;
                    }
                }
                std::fs::write(&expanded, &content)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;
                // Keep plugin credential/cache files private on Unix (#910).
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &expanded,
                        std::fs::Permissions::from_mode(0o600),
                    );
                }
                Ok(())
            },
        )?,
    )?;

    fs_obj.set(
        "listDir",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, path: String| -> rquickjs::Result<Vec<String>> {
                reject_path_traversal(&ctx_inner, &path)?;
                let expanded = expand_path(&path);
                let entries = std::fs::read_dir(&expanded)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                let mut names = Vec::new();
                for entry in entries {
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(_) => continue,
                    };
                    let name_os = entry.file_name();
                    let name = name_os.to_string_lossy().to_string();
                    if !name.is_empty() {
                        names.push(name);
                    }
                }
                names.sort();
                Ok(names)
            },
        )?,
    )?;

    fs_obj.set(
        "firstExisting",
        Function::new(ctx.clone(), move |paths: Vec<String>| -> Option<String> {
            first_existing_path(&paths)
        })?,
    )?;

    fs_obj.set(
        "firstExistingAppSupport",
        Function::new(ctx.clone(), move |relative: String| -> Option<String> {
            first_existing_app_support_path(&relative)
        })?,
    )?;

    host.set("fs", fs_obj)?;
    Ok(())
}

fn inject_cursor_paths<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    base_plugin_id: &str,
) -> rquickjs::Result<()> {
    let paths_obj = Object::new(ctx.clone())?;
    let plugin_id = base_plugin_id.to_string();
    paths_obj.set(
        "resolveStateDb",
        Function::new(ctx.clone(), move || -> Option<String> {
            crate::cursor_paths::resolve_cursor_state_db_for_plugin_id(&plugin_id)
                .map(|p| p.to_string_lossy().to_string())
        })?,
    )?;
    host.set("cursorPaths", paths_obj)?;
    Ok(())
}

fn inject_crypto<'js>(ctx: &Ctx<'js>, host: &Object<'js>) -> rquickjs::Result<()> {
    let crypto_obj = Object::new(ctx.clone())?;

    crypto_obj.set(
        "decryptAes256Gcm",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  envelope: String,
                  key_b64: String|
                  -> rquickjs::Result<String> {
                decrypt_aes_256_gcm_envelope(&envelope, &key_b64)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e))
            },
        )?,
    )?;

    crypto_obj.set(
        "encryptAes256Gcm",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  plaintext: String,
                  key_b64: String|
                  -> rquickjs::Result<String> {
                encrypt_aes_256_gcm_envelope(&plaintext, &key_b64)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e))
            },
        )?,
    )?;

    crypto_obj.set(
        "sha256Hex",
        Function::new(ctx.clone(), move |text: String| -> String {
            let digest = Sha256::digest(text.as_bytes());
            // Lowercase hex, matches Node's `crypto.createHash("sha256").update(x).digest("hex")`
            // and the upstream Claude Code keychain helper.
            let mut out = String::with_capacity(digest.len() * 2);
            for byte in digest.iter() {
                use std::fmt::Write as _;
                let _ = write!(&mut out, "{:02x}", byte);
            }
            out
        })?,
    )?;

    crypto_obj.set(
        "sha1Hex",
        Function::new(ctx.clone(), move |text: String| -> String {
            let digest = Sha1::digest(text.as_bytes());
            let mut out = String::with_capacity(digest.len() * 2);
            for byte in digest.iter() {
                use std::fmt::Write as _;
                let _ = write!(&mut out, "{:02x}", byte);
            }
            out
        })?,
    )?;

    host.set("crypto", crypto_obj)?;
    Ok(())
}

fn inject_env<'js>(ctx: &Ctx<'js>, host: &Object<'js>, _plugin_id: &str) -> rquickjs::Result<()> {
    let env_obj = Object::new(ctx.clone())?;
    env_obj.set(
        "get",
        Function::new(ctx.clone(), move |name: String| -> Option<String> {
            if !WHITELISTED_ENV_VARS.contains(&name.as_str()) {
                return None;
            }

            resolve_env_value(&name)
        })?,
    )?;
    host.set("env", env_obj)?;
    Ok(())
}

fn inject_credentials<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    account: Option<&ProviderAccountContext>,
) -> rquickjs::Result<()> {
    let credentials_obj = Object::new(ctx.clone())?;
    let credential_json = account
        .and_then(|account| account.credential.as_ref())
        .and_then(|credential| serde_json::to_string(credential).ok());
    credentials_obj.set(
        "get",
        Function::new(ctx.clone(), move || -> Option<String> {
            credential_json.clone()
        })?,
    )?;

    let store_path = account.and_then(|account| account.store_path.clone());
    let instance_id = account.map(|account| account.instance_id.clone());
    credentials_obj.set(
        "update",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, update_json: String| -> rquickjs::Result<Option<String>> {
                let Some(path) = store_path.as_ref() else {
                    return Ok(None);
                };
                let Some(id) = instance_id.as_ref() else {
                    return Ok(None);
                };
                let update: ProviderCredential = serde_json::from_str(&update_json).map_err(|e| {
                    Exception::throw_message(
                        &ctx_inner,
                        &format!("invalid credential update: {}", e),
                    )
                })?;
                let updated = provider_accounts::update_credential_at_path(path, id, update)
                    .map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("credential update failed: {}", e),
                        )
                    })?;
                match updated {
                    Some(credential) => serde_json::to_string(&credential)
                        .map(Some)
                        .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string())),
                    None => Ok(None),
                }
            },
        )?,
    )?;

    host.set("credentials", credentials_obj)?;
    Ok(())
}

fn probe_timeout_error<'js>(ctx: &Ctx<'js>) -> rquickjs::Error {
    Exception::throw_message(ctx, "probe timed out")
}

fn inject_http<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let http_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    http_obj.set(
        "_requestRaw",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, req_json: String| -> rquickjs::Result<String> {
                let req: HttpReqParams = serde_json::from_str(&req_json).map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("invalid request: {}", e))
                })?;

                if deadline.has_elapsed() {
                    return Err(probe_timeout_error(&ctx_inner));
                }

                let method_str = req.method.as_deref().unwrap_or("GET");
                let redacted_url = redact_url(&req.url);
                log::info!("[plugin:{}] HTTP {} {}", pid, method_str, redacted_url);

                let mut header_map = reqwest::header::HeaderMap::new();
                if let Some(headers) = &req.headers {
                    for (key, val) in headers {
                        let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                            .map_err(|e| {
                                Exception::throw_message(
                                    &ctx_inner,
                                    &format!("invalid header name '{}': {}", key, e),
                                )
                            })?;
                        let value = reqwest::header::HeaderValue::from_str(val).map_err(|e| {
                            Exception::throw_message(
                                &ctx_inner,
                                &format!("invalid header value for '{}': {}", key, e),
                            )
                        })?;
                        header_map.insert(name, value);
                    }
                }

                #[cfg(test)]
                {
                    let lock = HTTP_MOCK_STATE.get_or_init(|| Mutex::new(None));
                    let mut guard = lock.lock().unwrap();
                    if let Some(state) = guard.as_mut() {
                        state.requests.push(CapturedHttpRequest {
                            url: req.url.clone(),
                            method: method_str.to_string(),
                            headers: req.headers.clone().unwrap_or_default(),
                            body_text: req.body_text.clone(),
                        });
                        let resp = state.responses.pop_front().unwrap_or(HttpRespParams {
                            status: 200,
                            headers: std::collections::HashMap::new(),
                            body_text: "{}".to_string(),
                        });
                        return serde_json::to_string(&resp)
                            .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()));
                    }
                }

                let timeout_ms = req.timeout_ms.unwrap_or(10_000);
                let Some(timeout) = deadline.clamp_duration(Duration::from_millis(timeout_ms))
                else {
                    return Err(probe_timeout_error(&ctx_inner));
                };
                let mut builder = reqwest::blocking::Client::builder()
                    .timeout(timeout)
                    .connect_timeout(timeout)
                    .redirect(reqwest::redirect::Policy::none())
                    // Dual-stack hosts with no working IPv6 (AAAA exists, no route) fail
                    // in reqwest before falling back to A. Bind IPv4 so Google/etc still work.
                    .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
                if let Some(resolved) = crate::proxy_config::get_resolved_proxy() {
                    builder = builder.proxy(resolved.proxy.clone());
                }
                if req.dangerously_ignore_tls.unwrap_or(false) {
                    builder = builder.danger_accept_invalid_certs(true);
                }
                if req.http1_only.unwrap_or(false) {
                    builder = builder.http1_only();
                }
                let client = builder
                    .build()
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                let method = req.method.as_deref().unwrap_or("GET");
                let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| {
                    Exception::throw_message(
                        &ctx_inner,
                        &format!("invalid http method '{}': {}", method, e),
                    )
                })?;
                let mut builder = client.request(method, &req.url);
                builder = builder.headers(header_map);
                if let Some(body) = req.body_text {
                    builder = builder.body(body);
                }

                let response = builder
                    .send()
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                let status = response.status().as_u16();
                let mut resp_headers = std::collections::HashMap::new();
                for (key, value) in response.headers().iter() {
                    let header_value = value.to_str().map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("invalid response header '{}': {}", key, e),
                        )
                    })?;
                    resp_headers.insert(key.to_string(), header_value.to_string());
                }
                let body = response
                    .text()
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                // Redact BEFORE truncation to ensure sensitive values are caught while intact
                let redacted_body = redact_body(&body);
                let body_preview = if redacted_body.len() > 500 {
                    // UTF-8 safe truncation: find valid char boundary at or before 500
                    let truncated: String = redacted_body
                        .char_indices()
                        .take_while(|(i, _)| *i < 500)
                        .map(|(_, c)| c)
                        .collect();
                    format!("{}... ({} bytes total)", truncated, body.len())
                } else {
                    redacted_body
                };
                log::info!(
                    "[plugin:{}] HTTP {} {} -> {} | {}",
                    pid,
                    method_str,
                    redacted_url,
                    status,
                    body_preview
                );

                let resp = HttpRespParams {
                    status,
                    headers: resp_headers,
                    body_text: body,
                };

                serde_json::to_string(&resp)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))
            },
        )?,
    )?;

    ctx.eval::<(), _>(
        r#"
        (function() {
            // Will be patched after __openusage_ctx is set.
            if (typeof __openusage_ctx !== "undefined") {
                void 0;
            }
        })();
        "#
        .as_bytes(),
    )
    .map_err(|e| Exception::throw_message(ctx, &format!("http wrapper init failed: {}", e)))?;

    host.set("http", http_obj)?;
    Ok(())
}

pub fn patch_http_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.http._requestRaw;
            __openusage_ctx.host.http.request = function(req) {
                var json = JSON.stringify({
                    url: req.url,
                    method: req.method || "GET",
                    headers: req.headers || null,
                    bodyText: req.bodyText || null,
                    timeoutMs: req.timeoutMs || 10000,
                    dangerouslyIgnoreTls: req.dangerouslyIgnoreTls || false,
                    http1Only: req.http1Only || false
                });
                var respJson = rawFn(json);
                return JSON.parse(respJson);
            };
        })();
        "#
        .as_bytes(),
    )
}

/// Inject utility APIs (line builders, formatters, base64, jwt) onto __openusage_ctx
pub fn inject_utils(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var ctx = __openusage_ctx;

            // Line builders (options object API)
            ctx.line = {
                text: function(opts) {
                    var line = { type: "text", label: opts.label, value: opts.value };
                    if (opts.color) line.color = opts.color;
                    if (opts.subtitle) line.subtitle = opts.subtitle;
                    if (opts.modelBreakdown) line.modelBreakdown = opts.modelBreakdown;
                    if (opts.statusDot) line.statusDot = opts.statusDot;
                    if (opts.expiryTooltip) line.expiryTooltip = opts.expiryTooltip;
                    if (opts.resetCreditExpiries) line.resetCreditExpiries = opts.resetCreditExpiries;
                    return line;
                },
                progress: function(opts) {
                    var line = { type: "progress", label: opts.label, used: opts.used, limit: opts.limit, format: opts.format };
                    if (opts.resetsAt) line.resetsAt = opts.resetsAt;
                    if (opts.periodDurationMs) line.periodDurationMs = opts.periodDurationMs;
                    if (opts.color) line.color = opts.color;
                    if (opts.sessionStartSignal) line.sessionStartSignal = opts.sessionStartSignal;
                    return line;
                },
                badge: function(opts) {
                    var line = { type: "badge", label: opts.label, text: opts.text };
                    if (opts.color) line.color = opts.color;
                    if (opts.subtitle) line.subtitle = opts.subtitle;
                    return line;
                },
                barChart: function(opts) {
                    var line = { type: "barChart", label: opts.label, points: opts.points || [] };
                    if (opts.note) line.note = opts.note;
                    if (opts.color) line.color = opts.color;
                    return line;
                }
            };

            // Formatters
            ctx.fmt = {
                planLabel: function(value) {
                    var text = String(value || "").trim();
                    if (!text) return "";
                    return text.replace(/(^|\s)([a-z])/g, function(match, space, letter) {
                        return space + letter.toUpperCase();
                    });
                },
                resetIn: function(secondsUntil) {
                    if (!Number.isFinite(secondsUntil) || secondsUntil < 0) return null;
                    var totalMinutes = Math.floor(secondsUntil / 60);
                    var totalHours = Math.floor(totalMinutes / 60);
                    var days = Math.floor(totalHours / 24);
                    var hours = totalHours % 24;
                    var minutes = totalMinutes % 60;
                    if (days > 0) return days + "d " + hours + "h";
                    if (totalHours > 0) return totalHours + "h " + minutes + "m";
                    if (totalMinutes > 0) return totalMinutes + "m";
                    return "<1m";
                },
                dollars: function(cents) {
                    var d = cents / 100;
                    return Math.round(d * 100) / 100;
                },
                date: function(unixMs) {
                    var d = new Date(Number(unixMs));
                    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    return months[d.getMonth()] + " " + String(d.getDate());
                }
            };

            // Shared utilities
            ctx.util = {
                tryParseJson: function(text) {
                    if (text === null || text === undefined) return null;
                    var trimmed = String(text).replace(/^\uFEFF/, "").trim();
                    if (!trimmed) return null;
                    try {
                        return JSON.parse(trimmed);
                    } catch (e) {
                        return null;
                    }
                },
                safeJsonParse: function(text) {
                    if (text === null || text === undefined) return { ok: false };
                    var trimmed = String(text).replace(/^\uFEFF/, "").trim();
                    if (!trimmed) return { ok: false };
                    try {
                        return { ok: true, value: JSON.parse(trimmed) };
                    } catch (e) {
                        return { ok: false };
                    }
                },
                request: function(opts) {
                    return ctx.host.http.request(opts);
                },
                requestJson: function(opts) {
                    var resp = ctx.util.request(opts);
                    var parsed = ctx.util.safeJsonParse(resp.bodyText);
                    return { resp: resp, json: parsed.ok ? parsed.value : null };
                },
                isAuthStatus: function(status) {
                    return status === 401 || status === 403;
                },
                readProviderCredential: function() {
                    try {
                        if (!ctx.host.credentials || typeof ctx.host.credentials.get !== "function") return null;
                        var raw = ctx.host.credentials.get();
                        if (!raw) return null;
                        var credential = ctx.util.tryParseJson(String(raw));
                        if (!credential) return null;
                        var accessToken = String(credential.accessToken || credential.sessionKey || "").trim();
                        var refreshToken = String(credential.refreshToken || "").trim();
                        var sessionKey = credential.sessionKey ? String(credential.sessionKey).trim() : "";
                        if (!accessToken && !refreshToken) return null;
                        return {
                            accessToken: accessToken || null,
                            refreshToken: refreshToken || null,
                            sessionKey: sessionKey || null,
                            expiresAt: typeof credential.expiresAt === "number" ? credential.expiresAt : null
                        };
                    } catch (e) {
                        return null;
                    }
                },
                writeProviderCredential: function(partial) {
                    try {
                        if (!ctx.host.credentials || typeof ctx.host.credentials.update !== "function") return false;
                        var current = ctx.util.readProviderCredential() || {};
                        var update = Object.assign({}, current, partial || {});
                        ctx.host.credentials.update(JSON.stringify({
                            accessToken: update.accessToken || null,
                            refreshToken: update.refreshToken || null,
                            sessionKey: update.sessionKey || null,
                            expiresAt: update.expiresAt || null
                        }));
                        return true;
                    } catch (e) {
                        return false;
                    }
                },
                providerApiKey: function() {
                    var credential = ctx.util.readProviderCredential();
                    return credential && credential.accessToken ? credential.accessToken : null;
                },
                retryOnceOnAuth: function(opts) {
                    var resp = opts.request();
                    if (ctx.util.isAuthStatus(resp.status)) {
                        var token = opts.refresh();
                        if (token) {
                            resp = opts.request(token);
                        }
                    }
                    return resp;
                },
                parseDateMs: function(value) {
                    if (value instanceof Date) {
                        var dateMs = value.getTime();
                        return Number.isFinite(dateMs) ? dateMs : null;
                    }
                    if (typeof value === "number") {
                        return Number.isFinite(value) ? value : null;
                    }
                    if (typeof value === "string") {
                        var parsed = Date.parse(value);
                        if (Number.isFinite(parsed)) return parsed;
                        var n = Number(value);
                        return Number.isFinite(n) ? n : null;
                    }
                    return null;
                },
                toIso: function(value) {
                    if (value === null || value === undefined) return null;

                    if (typeof value === "string") {
                        var s = String(value).trim();
                        if (!s) return null;

                        // Common variants
                        // - "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
                        // - "... UTC" -> "...Z"
                        if (s.indexOf(" ") !== -1 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
                            s = s.replace(" ", "T");
                        }
                        if (s.endsWith(" UTC")) {
                            s = s.slice(0, -4) + "Z";
                        }

                        // Numeric strings: treat as seconds/ms.
                        if (/^-?\d+(\.\d+)?$/.test(s)) {
                            var n = Number(s);
                            if (!Number.isFinite(n)) return null;
                            var msNum = Math.abs(n) < 1e10 ? n * 1000 : n;
                            var dn = new Date(msNum);
                            var tn = dn.getTime();
                            if (!Number.isFinite(tn)) return null;
                            return dn.toISOString();
                        }

                        // Normalize timezone offsets without colon: "+0000" -> "+00:00"
                        if (/[+-]\d{4}$/.test(s)) {
                            s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
                        }

                        // Some APIs return RFC3339 with >3 fractional digits (e.g. .123456Z).
                        // Normalize to milliseconds so Date.parse can understand it.
                        var m = s.match(
                            /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
                        );
                        if (m) {
                            var head = m[1];
                            var frac = m[2] || "";
                            var tz = m[3];
                            if (frac) {
                                var digits = frac.slice(1);
                                if (digits.length > 3) digits = digits.slice(0, 3);
                                while (digits.length < 3) digits = digits + "0";
                                frac = "." + digits;
                            }
                            s = head + frac + tz;
                        } else {
                            // ISO-like but missing timezone: assume UTC.
                            var mNoTz = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/);
                            if (mNoTz) {
                                var head2 = mNoTz[1];
                                var frac2 = mNoTz[2] || "";
                                if (frac2) {
                                    var digits2 = frac2.slice(1);
                                    if (digits2.length > 3) digits2 = digits2.slice(0, 3);
                                    while (digits2.length < 3) digits2 = digits2 + "0";
                                    frac2 = "." + digits2;
                                }
                                s = head2 + frac2 + "Z";
                            }
                        }

                        var parsed = Date.parse(s);
                        if (!Number.isFinite(parsed)) return null;
                        return new Date(parsed).toISOString();
                    }

                    if (typeof value === "number") {
                        if (!Number.isFinite(value)) return null;
                        var ms = Math.abs(value) < 1e10 ? value * 1000 : value;
                        var d = new Date(ms);
                        var t = d.getTime();
                        if (!Number.isFinite(t)) return null;
                        return d.toISOString();
                    }

                    if (value instanceof Date) {
                        var t = value.getTime();
                        if (!Number.isFinite(t)) return null;
                        return value.toISOString();
                    }

                    return null;
                },
                needsRefreshByExpiry: function(opts) {
                    if (!opts) return true;
                    if (opts.expiresAtMs === null || opts.expiresAtMs === undefined) return true;
                    var nowMs = Number(opts.nowMs);
                    var expiresAtMs = Number(opts.expiresAtMs);
                    var bufferMs = Number(opts.bufferMs);
                    if (!Number.isFinite(nowMs)) return true;
                    if (!Number.isFinite(expiresAtMs)) return true;
                    if (!Number.isFinite(bufferMs)) bufferMs = 0;
                    return nowMs + bufferMs >= expiresAtMs;
                }
            };

            // Base64
            var b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            ctx.base64 = {
                decode: function(str) {
                    str = str.replace(/-/g, "+").replace(/_/g, "/");
                    while (str.length % 4) str += "=";
                    str = str.replace(/=+$/, "");
                    var result = "";
                    var len = str.length;
                    var i = 0;
                    while (i < len) {
                        var remaining = len - i;
                        var a = b64chars.indexOf(str.charAt(i++));
                        var b = b64chars.indexOf(str.charAt(i++));
                        var c = remaining > 2 ? b64chars.indexOf(str.charAt(i++)) : 0;
                        var d = remaining > 3 ? b64chars.indexOf(str.charAt(i++)) : 0;
                        var n = (a << 18) | (b << 12) | (c << 6) | d;
                        result += String.fromCharCode((n >> 16) & 0xff);
                        if (remaining > 2) result += String.fromCharCode((n >> 8) & 0xff);
                        if (remaining > 3) result += String.fromCharCode(n & 0xff);
                    }
                    return result;
                },
                encode: function(str) {
                    var result = "";
                    var len = str.length;
                    var i = 0;
                    while (i < len) {
                        var chunkStart = i;
                        var a = str.charCodeAt(i++);
                        var b = i < len ? str.charCodeAt(i++) : 0;
                        var c = i < len ? str.charCodeAt(i++) : 0;
                        var bytesInChunk = i - chunkStart;
                        var n = (a << 16) | (b << 8) | c;
                        result += b64chars.charAt((n >> 18) & 63);
                        result += b64chars.charAt((n >> 12) & 63);
                        result += bytesInChunk < 2 ? "=" : b64chars.charAt((n >> 6) & 63);
                        result += bytesInChunk < 3 ? "=" : b64chars.charAt(n & 63);
                    }
                    return result;
                }
            };

            // JWT
            ctx.jwt = {
                decodePayload: function(token) {
                    try {
                        var parts = token.split(".");
                        if (parts.length !== 3) return null;
                        var decoded = ctx.base64.decode(parts[1]);
                        return JSON.parse(decoded);
                    } catch (e) {
                        return null;
                    }
                }
            };
        })();
        "#
        .as_bytes(),
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpReqParams {
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body_text: Option<String>,
    timeout_ms: Option<u64>,
    dangerously_ignore_tls: Option<bool>,
    http1_only: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpRespParams {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body_text: String,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CapturedHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body_text: Option<String>,
}

#[cfg(test)]
struct HttpMockState {
    responses: VecDeque<HttpRespParams>,
    requests: Vec<CapturedHttpRequest>,
}

#[cfg(test)]
static HTTP_MOCK_STATE: OnceLock<Mutex<Option<HttpMockState>>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn install_http_mock(responses: Vec<(u16, &str)>) {
    let state = HttpMockState {
        responses: responses
            .into_iter()
            .map(|(status, body)| HttpRespParams {
                status,
                headers: std::collections::HashMap::new(),
                body_text: body.to_string(),
            })
            .collect(),
        requests: Vec::new(),
    };
    let lock = HTTP_MOCK_STATE.get_or_init(|| Mutex::new(None));
    *lock.lock().unwrap() = Some(state);
}

#[cfg(test)]
pub(crate) fn take_http_mock_requests() -> Vec<CapturedHttpRequest> {
    let lock = HTTP_MOCK_STATE.get_or_init(|| Mutex::new(None));
    lock.lock()
        .unwrap()
        .take()
        .map(|state| state.requests)
        .unwrap_or_default()
}

// --- Language Server Discovery ---

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LsDiscoverOpts {
    process_name: String,
    markers: Vec<String>,
    csrf_flag: String,
    port_flag: Option<String>,
    extra_flags: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LsDiscoverResult {
    pid: i32,
    csrf: String,
    ports: Vec<i32>,
    extra: std::collections::HashMap<String, String>,
    extension_port: Option<i32>,
}

fn inject_ls<'js>(ctx: &Ctx<'js>, host: &Object<'js>, plugin_id: &str) -> rquickjs::Result<()> {
    let ls_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    ls_obj.set(
        "_discoverRaw",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
                let opts: LsDiscoverOpts = serde_json::from_str(&opts_json).map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("invalid discover opts: {}", e))
                })?;

                log::info!(
                    "[plugin:{}] LS discover: processName={}, markers={:?}",
                    pid,
                    opts.process_name,
                    opts.markers
                );

                // Windows: no ps command; plugins fall back to SQLite/Cloud API
                #[cfg(windows)]
                return Ok("null".to_string());

                #[cfg(not(windows))]
                {
                // Use ps -e on Linux (GNU ps); -ax on macOS/BSD
                let (ps_path, ps_args): (&str, &[&str]) = if std::env::consts::OS == "linux" {
                    ("ps", &["-e", "-o", "pid=,args="][..])
                } else {
                    ("/bin/ps", &["-ax", "-o", "pid=,command="][..])
                };
                let ps_output = match std::process::Command::new(ps_path).args(ps_args).output() {
                    Ok(o) => o,
                    Err(e) => {
                        log::warn!("[plugin:{}] ps failed: {}", pid, e);
                        return Ok("null".to_string());
                    }
                };

                if !ps_output.status.success() {
                    log::warn!("[plugin:{}] ps returned non-zero", pid);
                    return Ok("null".to_string());
                }

                let ps_stdout = String::from_utf8_lossy(&ps_output.stdout);
                let process_name_lower = opts.process_name.to_lowercase();
                let markers_lower: Vec<String> =
                    opts.markers.iter().map(|m| m.to_lowercase()).collect();

                // Find the target process. Marker patterns are Codeium-derived.
                // Matching priority:
                //   1. Exact --ide_name / --app_data_dir flag value (prevents
                //      "windsurf" matching "windsurf-next")
                //   2. Path substring (/<marker>/) as fallback when no flags found
                let mut found: Option<(i32, String)> = None;

                for line in ps_stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    let mut parts = trimmed.splitn(2, char::is_whitespace);
                    let pid_str = match parts.next() {
                        Some(s) => s.trim(),
                        None => continue,
                    };
                    let command = match parts.next() {
                        Some(s) => s.trim(),
                        None => continue,
                    };

                    let command_lower = command.to_lowercase();

                    if !command_lower.contains(&process_name_lower) {
                        continue;
                    }

                    let ide_name = ls_extract_flag(command, "--ide_name").map(|v| v.to_lowercase());
                    let app_data =
                        ls_extract_flag(command, "--app_data_dir").map(|v| v.to_lowercase());

                    let has_marker = markers_lower.iter().any(|m| {
                        // Prefer exact flag match; skip path fallback when
                        // a distinguishing flag exists.
                        if let Some(ref name) = ide_name {
                            return *name == *m;
                        }
                        if let Some(ref dir) = app_data {
                            return *dir == *m;
                        }
                        // Fallback: path substring
                        command_lower.contains(&format!("/{}/", m))
                    });
                    if !has_marker {
                        continue;
                    }

                    if let Ok(p) = pid_str.parse::<i32>() {
                        found = Some((p, command.to_string()));
                        break;
                    }
                }

                let (process_pid, command) = match found {
                    Some(pair) => pair,
                    None => {
                        log::info!("[plugin:{}] LS process not found", pid);
                        return Ok("null".to_string());
                    }
                };

                // Extract CSRF token
                let csrf = match ls_extract_flag(&command, &opts.csrf_flag) {
                    Some(c) => c,
                    None => {
                        log::warn!("[plugin:{}] CSRF token not found in process args", pid);
                        return Ok("null".to_string());
                    }
                };

                // Extract extension port (optional)
                let extension_port = opts.port_flag.as_ref().and_then(|flag| {
                    ls_extract_flag(&command, flag).and_then(|v| v.parse::<i32>().ok())
                });

                // Extract extra flags (optional)
                let mut extra = std::collections::HashMap::new();
                if let Some(ref flags) = opts.extra_flags {
                    for flag in flags {
                        if let Some(val) = ls_extract_flag(&command, flag) {
                            // Use flag name without leading dashes as key
                            let key = flag.trim_start_matches('-').to_string();
                            extra.insert(key, val);
                        }
                    }
                }

                // Find lsof binary
                let lsof_path = ["/usr/sbin/lsof", "/usr/bin/lsof"]
                    .iter()
                    .find(|p| std::path::Path::new(p).exists())
                    .copied();

                let ports = if let Some(lsof) = lsof_path {
                    match std::process::Command::new(lsof)
                        .args([
                            "-nP",
                            "-iTCP",
                            "-sTCP:LISTEN",
                            "-a",
                            "-p",
                            &process_pid.to_string(),
                        ])
                        .output()
                    {
                        Ok(o) if o.status.success() => {
                            ls_parse_listening_ports(&String::from_utf8_lossy(&o.stdout))
                        }
                        Ok(_) => {
                            log::warn!("[plugin:{}] lsof returned non-zero", pid);
                            Vec::new()
                        }
                        Err(e) => {
                            log::warn!("[plugin:{}] lsof failed: {}", pid, e);
                            Vec::new()
                        }
                    }
                } else {
                    log::warn!("[plugin:{}] lsof not found", pid);
                    Vec::new()
                };

                if ports.is_empty() && extension_port.is_none() {
                    log::warn!(
                        "[plugin:{}] no listening ports found for pid {}",
                        pid,
                        process_pid
                    );
                    return Ok("null".to_string());
                }

                log::info!(
                    "[plugin:{}] LS found: pid={}, ports={:?}, csrf=[REDACTED]",
                    pid,
                    process_pid,
                    ports
                );

                let result = LsDiscoverResult {
                    pid: process_pid,
                    csrf,
                    ports,
                    extra,
                    extension_port,
                };

                serde_json::to_string(&result).map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("serialize failed: {}", e))
                })
                }
            },
        )?,
    )?;

    host.set("ls", ls_obj)?;
    Ok(())
}

pub fn patch_ls_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.ls._discoverRaw;
            __openusage_ctx.host.ls.discover = function(opts) {
                var optsJson;
                try { optsJson = JSON.stringify(opts); } catch (e) { return null; }
                var json = rawFn(optsJson);
                if (json === "null") return null;
                return JSON.parse(json);
            };
        })();
        "#
        .as_bytes(),
    )
}

/// Extract value of a CLI flag from a command string.
/// Handles both `--flag value` and `--flag=value` forms.
fn ls_extract_flag(command: &str, flag: &str) -> Option<String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    let flag_eq = format!("{}=", flag);
    for (i, part) in parts.iter().enumerate() {
        if *part == flag {
            if i + 1 < parts.len() {
                return Some(parts[i + 1].to_string());
            }
        } else if part.starts_with(&flag_eq) {
            return Some(part[flag_eq.len()..].to_string());
        }
    }
    None
}

/// Parse listening port numbers from `lsof -nP -iTCP -sTCP:LISTEN` output.
fn ls_parse_listening_ports(output: &str) -> Vec<i32> {
    let mut ports = std::collections::BTreeSet::new();
    for line in output.lines() {
        if !line.contains("LISTEN") {
            continue;
        }
        // lsof -nP output: ... TCP 127.0.0.1:PORT (LISTEN)  or  ... TCP *:PORT
        // Scan tokens in reverse to find the address:port token.
        for token in line.split_whitespace().rev() {
            if let Some(colon_pos) = token.rfind(':') {
                let port_str = &token[colon_pos + 1..];
                if let Ok(port) = port_str.parse::<i32>() {
                    if port > 0 && port < 65536 {
                        ports.insert(port);
                        break;
                    }
                }
            }
        }
    }
    ports.into_iter().collect()
}

fn inject_usage_daily<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    instance_id: &str,
    app_data_dir: &PathBuf,
) -> rquickjs::Result<()> {
    let usage_daily_obj = Object::new(ctx.clone())?;
    let app_data = app_data_dir.clone();
    let iid = instance_id.to_string();

    usage_daily_obj.set(
        "_ingestRaw",
        Function::new(
            ctx.clone(),
            move |_ctx_inner: Ctx<'_>, payload_json: String| -> rquickjs::Result<()> {
                if let Err(e) = crate::usage_daily::ingest_json(&app_data, &iid, &payload_json) {
                    log::warn!("[plugin:{}] usageDaily.ingest failed: {}", iid, e);
                }
                Ok(())
            },
        )?,
    )?;

    host.set("usageDaily", usage_daily_obj)?;
    Ok(())
}

fn inject_cursor_logs<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let cursor_logs_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    cursor_logs_obj.set(
        "_queryRaw",
        Function::new(
            ctx.clone(),
            move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
                if deadline.has_elapsed() {
                    log_probe_deadline_skip(&pid, "cursorLogs");
                    return Ok(
                        serde_json::json!({ "status": "no_data", "data": { "daily": [] } })
                            .to_string(),
                    );
                }
                let since = serde_json::from_str::<serde_json::Value>(&opts_json)
                    .ok()
                    .and_then(|v| {
                        v.get("since")
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_default();
                let since = if since.is_empty() {
                    (chrono::Utc::now().date_naive() - chrono::Duration::days(30))
                        .format("%Y%m%d")
                        .to_string()
                } else {
                    since
                };
                let (status, daily) = crate::cursor_usage_logs::query_daily_since(&since);
                let status_str = match status {
                    crate::cursor_usage_logs::CursorLogsStatus::Ok => "ok",
                    crate::cursor_usage_logs::CursorLogsStatus::NoData => "no_data",
                };
                Ok(serde_json::json!({
                    "status": status_str,
                    "data": { "daily": daily }
                })
                .to_string())
            },
        )?,
    )?;

    host.set("cursorLogs", cursor_logs_obj)?;
    Ok(())
}

fn inject_claude_logs<'js>(ctx: &Ctx<'js>, host: &Object<'js>, deadline: ProbeDeadline) -> rquickjs::Result<()> {
    let obj = Object::new(ctx.clone())?;
    obj.set(
        "_queryRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(
                    serde_json::json!({ "status": "no_data", "data": { "daily": [] } }).to_string(),
                );
            }
            Ok(crate::claude_usage_scanner::query_daily_host_json(&opts_json))
        })?,
    )?;
    host.set("claudeLogs", obj)?;
    Ok(())
}

fn inject_codex_logs<'js>(ctx: &Ctx<'js>, host: &Object<'js>, deadline: ProbeDeadline) -> rquickjs::Result<()> {
    let obj = Object::new(ctx.clone())?;
    obj.set(
        "_queryRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(
                    serde_json::json!({ "status": "no_data", "data": { "daily": [] } }).to_string(),
                );
            }
            Ok(crate::codex_usage_scanner::query_daily_host_json(&opts_json))
        })?,
    )?;
    host.set("codexLogs", obj)?;
    Ok(())
}

fn inject_antigravity_logs<'js>(ctx: &Ctx<'js>, host: &Object<'js>, deadline: ProbeDeadline) -> rquickjs::Result<()> {
    let obj = Object::new(ctx.clone())?;
    obj.set(
        "_queryRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(
                    serde_json::json!({ "status": "no_data", "data": { "daily": [] } }).to_string(),
                );
            }
            Ok(crate::antigravity_db_usage_scanner::query_daily_host_json(&opts_json))
        })?,
    )?;
    host.set("antigravityLogs", obj)?;
    Ok(())
}

fn inject_grok_logs<'js>(ctx: &Ctx<'js>, host: &Object<'js>, deadline: ProbeDeadline) -> rquickjs::Result<()> {
    let obj = Object::new(ctx.clone())?;
    obj.set(
        "_queryRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(
                    serde_json::json!({ "status": "no_data", "data": { "daily": [] } }).to_string(),
                );
            }
            Ok(crate::grok_usage_scanner::query_daily_host_json(&opts_json))
        })?,
    )?;
    host.set("grokLogs", obj)?;
    Ok(())
}

fn inject_cursor_usage_export<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    account: Option<&ProviderAccountContext>,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let export_obj = Object::new(ctx.clone())?;
    let account_for_mtd = account.cloned();
    export_obj.set(
        "_queryMtdRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(serde_json::json!({
                    "status": "error",
                    "message": "probe deadline exceeded"
                })
                .to_string());
            }
            let export_account = account_for_mtd
                .as_ref()
                .and_then(crate::cursor_usage_export::CursorExportAccount::from_provider_account);
            Ok(crate::cursor_usage_export::query_mtd_host_json_for_account(
                &opts,
                export_account.as_ref(),
            ))
        })?,
    )?;
    let account_for_stats = account.cloned();
    export_obj.set(
        "_queryStatsRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(serde_json::json!({
                    "status": "error",
                    "message": "probe deadline exceeded"
                })
                .to_string());
            }
            let export_account = account_for_stats
                .as_ref()
                .and_then(crate::cursor_usage_export::CursorExportAccount::from_provider_account);
            Ok(crate::cursor_usage_export::query_usage_stats_host_json_for_account(
                &opts,
                export_account.as_ref(),
            ))
        })?,
    )?;
    let account_for_daily = account.cloned();
    export_obj.set(
        "_queryDailyRaw",
        Function::new(ctx.clone(), move |_ctx_inner: Ctx<'_>, opts: String| -> rquickjs::Result<String> {
            if deadline.has_elapsed() {
                return Ok(serde_json::json!({
                    "status": "error",
                    "message": "probe deadline exceeded"
                })
                .to_string());
            }
            let export_account = account_for_daily
                .as_ref()
                .and_then(crate::cursor_usage_export::CursorExportAccount::from_provider_account);
            Ok(crate::cursor_usage_export::query_daily_billing_host_json_for_account(
                &opts,
                export_account.as_ref(),
            ))
        })?,
    )?;
    host.set("cursorUsageExport", export_obj)?;
    Ok(())
}

pub fn patch_cursor_usage_export_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            function cursorExportOpts(opts) {
                var o = opts && typeof opts === "object" ? Object.assign({}, opts) : {};
                if (!o.pluginId && __openusage_ctx.account && __openusage_ctx.account.baseProviderId) {
                    o.pluginId = __openusage_ctx.account.baseProviderId;
                }
                return JSON.stringify(o);
            }
            var rawFn = __openusage_ctx.host.cursorUsageExport._queryMtdRaw;
            __openusage_ctx.host.cursorUsageExport.queryMtd = function(opts) {
                var result = rawFn(cursorExportOpts(opts));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "error", message: "invalid MTD response" };
            };
            var statsRawFn = __openusage_ctx.host.cursorUsageExport._queryStatsRaw;
            __openusage_ctx.host.cursorUsageExport.queryStats = function(opts) {
                var result = statsRawFn(cursorExportOpts(opts));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "error", message: "invalid usage stats response" };
            };
            var dailyRawFn = __openusage_ctx.host.cursorUsageExport._queryDailyRaw;
            __openusage_ctx.host.cursorUsageExport.queryDaily = function(opts) {
                var result = dailyRawFn(cursorExportOpts(opts));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "error", message: "invalid daily billing response" };
            };
        })();
        "#
        .as_bytes(),
    )
}

pub fn patch_cursor_logs_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.cursorLogs._queryRaw;
            __openusage_ctx.host.cursorLogs.queryDaily = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "no_data", data: { daily: [] } };
            };
        })();
        "#
        .as_bytes(),
    )
}

pub fn patch_claude_logs_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.claudeLogs._queryRaw;
            __openusage_ctx.host.claudeLogs.queryDaily = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "no_data", data: { daily: [] } };
            };
        })();
        "#
        .as_bytes(),
    )
}

pub fn patch_codex_logs_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.codexLogs._queryRaw;
            __openusage_ctx.host.codexLogs.queryDaily = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "no_data", data: { daily: [] } };
            };
        })();
        "#
        .as_bytes(),
    )
}

pub fn patch_antigravity_logs_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.antigravityLogs._queryRaw;
            __openusage_ctx.host.antigravityLogs.queryDaily = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "no_data", data: { daily: [] } };
            };
        })();
        "#
        .as_bytes(),
    )
}

pub fn patch_grok_logs_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.grokLogs._queryRaw;
            __openusage_ctx.host.grokLogs.queryDaily = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "no_data", data: { daily: [] } };
            };
        })();
        "#
        .as_bytes(),
    )
}

pub fn patch_usage_daily_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.usageDaily._ingestRaw;
            __openusage_ctx.host.usageDaily.ingest = function(opts) {
                rawFn(JSON.stringify(opts || {}));
            };
        })();
        "#
        .as_bytes(),
    )
}

#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct FireworksBillingExportOpts {
    api_key: String,
    account_id: String,
    start_time: String,
    end_time: String,
}

fn firectl_runner_candidates() -> [&'static str; 3] {
    ["firectl", "/opt/homebrew/bin/firectl", "/usr/local/bin/firectl"]
}

fn resolve_firectl_runner() -> Option<String> {
    static FIRECTL_RUNNER: OnceLock<Option<String>> = OnceLock::new();
    FIRECTL_RUNNER
        .get_or_init(|| {
            for candidate in firectl_runner_candidates() {
                if Command::new(candidate)
                    .arg("--help")
                    .status()
                    .map(|status| status.success())
                    .unwrap_or(false)
                {
                    return Some(candidate.to_string());
                }
            }
            None
        })
        .clone()
}

fn fireworks_auth_ini_contents(api_key: &str) -> String {
    format!("[fireworks]\napi_key = {}\n", api_key)
}

fn write_fireworks_auth_ini(auth_root: &Path, api_key: &str) -> std::io::Result<PathBuf> {
    let fireworks_dir = auth_root.join(".fireworks");
    std::fs::create_dir_all(&fireworks_dir)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fireworks_dir, std::fs::Permissions::from_mode(0o700))?;
    }

    let auth_ini_path = fireworks_dir.join("auth.ini");
    std::fs::write(&auth_ini_path, fireworks_auth_ini_contents(api_key))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&auth_ini_path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(auth_ini_path)
}

fn cleanup_fireworks_export_dir(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

fn run_fireworks_billing_export_timeout(
    command: &mut Command,
    plugin_id: &str,
    timeout: std::time::Duration,
) -> Result<std::process::Output, &'static str> {
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            log::warn!(
                "[plugin:{}] failed to spawn firectl billing export: {}",
                plugin_id,
                err
            );
            return Err("runner_failed");
        }
    };

    let mut stdout_reader = child.stdout.take().map(|mut stdout| {
        std::thread::spawn(move || {
            let mut v = Vec::new();
            let _ = std::io::Read::read_to_end(&mut stdout, &mut v);
            v
        })
    });
    let mut stderr_reader = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut v = Vec::new();
            let _ = std::io::Read::read_to_end(&mut stderr, &mut v);
            v
        })
    });

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_reader
                    .take()
                    .and_then(|reader| reader.join().ok())
                    .unwrap_or_default();
                let stderr = stderr_reader
                    .take()
                    .and_then(|reader| reader.join().ok())
                    .unwrap_or_default();
                return Ok(std::process::Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.take().and_then(|reader| reader.join().ok());
                    let _ = stderr_reader.take().and_then(|reader| reader.join().ok());
                    log::warn!(
                        "[plugin:{}] firectl billing export timed out after {}s",
                        plugin_id,
                        timeout.as_secs()
                    );
                    return Err("timed_out");
                }
                std::thread::sleep(std::time::Duration::from_millis(
                    FIRECTL_POLL_INTERVAL_MS,
                ));
            }
            Err(err) => {
                log::warn!(
                    "[plugin:{}] firectl billing export wait failed: {}",
                    plugin_id,
                    err
                );
                let _ = stdout_reader.take().and_then(|reader| reader.join().ok());
                let _ = stderr_reader.take().and_then(|reader| reader.join().ok());
                return Err("runner_failed");
            }
        }
    }
}

fn run_fireworks_billing_export(
    opts: &FireworksBillingExportOpts,
    plugin_id: &str,
) -> serde_json::Value {
    if opts.api_key.trim().is_empty()
        || opts.account_id.trim().is_empty()
        || opts.start_time.trim().is_empty()
        || opts.end_time.trim().is_empty()
    {
        return serde_json::json!({ "status": "invalid_opts" });
    }

    let Some(program) = resolve_firectl_runner() else {
        log::warn!("[plugin:{}] firectl not found for billing export", plugin_id);
        return serde_json::json!({ "status": "no_runner" });
    };

    let workspace_name = format!(
        "openusage-fireworks-{}-{}",
        std::process::id(),
        iso_now().replace([':', '.'], "-")
    );
    let temp_dir = std::env::temp_dir().join(&workspace_name);
    if let Err(err) = std::fs::create_dir_all(&temp_dir) {
        log::warn!(
            "[plugin:{}] failed to create Fireworks export temp dir: {}",
            plugin_id,
            err
        );
        return serde_json::json!({ "status": "runner_failed" });
    }

    if let Err(err) = write_fireworks_auth_ini(&temp_dir, opts.api_key.trim()) {
        cleanup_fireworks_export_dir(&temp_dir);
        log::warn!(
            "[plugin:{}] failed to prepare Fireworks auth config: {}",
            plugin_id,
            err
        );
        return serde_json::json!({ "status": "runner_failed" });
    }

    let file_name = format!("{}.csv", workspace_name);
    let output_path = temp_dir.join(&file_name);
    let mut command = Command::new(&program);
    command
        .current_dir(&temp_dir)
        .env("HOME", &temp_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .args([
            "billing",
            "export-metrics",
            "--account-id",
            opts.account_id.trim(),
            "--start-time",
            opts.start_time.trim(),
            "--end-time",
            opts.end_time.trim(),
            "--filename",
            file_name.as_str(),
        ]);
    let result = run_fireworks_billing_export_timeout(
        &mut command,
        plugin_id,
        std::time::Duration::from_secs(FIRECTL_TIMEOUT_SECS),
    );

    let read_csv = || std::fs::read_to_string(&output_path).ok();
    let cleanup = || cleanup_fireworks_export_dir(&temp_dir);

    match result {
        Ok(output) if output.status.success() => {
            let csv = read_csv();
            cleanup();
            match csv {
                Some(text) if !text.trim().is_empty() => {
                    serde_json::json!({ "status": "ok", "csv": text })
                }
                _ => {
                    log::warn!(
                        "[plugin:{}] billing export succeeded but no CSV was produced",
                        plugin_id
                    );
                    serde_json::json!({ "status": "empty" })
                }
            }
        }
        Ok(output) => {
            cleanup();
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!(
                "[plugin:{}] firectl billing export failed: {}",
                plugin_id,
                stderr.lines().next().unwrap_or("unknown error").trim()
            );
            serde_json::json!({ "status": "runner_failed" })
        }
        Err(status) => {
            cleanup();
            serde_json::json!({ "status": status })
        }
    }
}

fn inject_fireworks<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
) -> rquickjs::Result<()> {
    let fireworks_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    fireworks_obj.set(
        "_exportBillingMetricsRaw",
        Function::new(
            ctx.clone(),
            move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
                let opts: FireworksBillingExportOpts =
                    serde_json::from_str(&opts_json).unwrap_or_default();
                Ok(run_fireworks_billing_export(&opts, &pid).to_string())
            },
        )?,
    )?;

    host.set("fireworks", fireworks_obj)?;
    Ok(())
}

pub fn patch_fireworks_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.fireworks._exportBillingMetricsRaw;
            __openusage_ctx.host.fireworks.exportBillingMetrics = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "runner_failed" };
            };
        })();
        "#
        .as_bytes(),
    )
}

fn inject_keychain<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
) -> rquickjs::Result<()> {
    let keychain_obj = Object::new(ctx.clone())?;
    let pid_read = plugin_id.to_string();

    keychain_obj.set(
        "readGenericPassword",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  service: String,
                  account_args: Rest<Option<String>>|
                  -> rquickjs::Result<String> {
                let account = account_args
                    .0
                    .into_iter()
                    .next()
                    .flatten()
                    .and_then(|value| {
                        let trimmed = value.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_string())
                        }
                    });
                let redacted_account = account.as_deref().map(redact_value);
                if let Some(ref redacted) = redacted_account {
                    log::info!(
                        "[plugin:{}] keychain read: service={}, account={}",
                        pid_read,
                        service,
                        redacted
                    );
                } else {
                    log::info!("[plugin:{}] keychain read: service={}", pid_read, service);
                }

                if cfg!(target_os = "macos") {
                    let args = if let Some(ref account) = account {
                        keychain_find_generic_password_args_for_account(&service, account)
                    } else {
                        keychain_find_generic_password_args(&service)
                    };
                    let output = std::process::Command::new("security")
                        .args(args)
                        .output()
                        .map_err(|e| {
                            Exception::throw_message(
                                &ctx_inner,
                                &format!("keychain read failed: {}", e),
                            )
                        })?;

                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let first_line = stderr.lines().next().unwrap_or("").trim();
                        if let Some(ref redacted) = redacted_account {
                            log::warn!(
                                "[plugin:{}] keychain read miss: service={}, account={}, error={}",
                                pid_read,
                                service,
                                redacted,
                                first_line
                            );
                        } else {
                            log::warn!(
                                "[plugin:{}] keychain read miss: service={}, error={}",
                                pid_read,
                                service,
                                first_line
                            );
                        }
                        return Err(Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain item not found: {}", first_line),
                        ));
                    }

                    if let Some(ref redacted) = redacted_account {
                        log::info!(
                            "[plugin:{}] keychain read hit: service={}, account={}",
                            pid_read,
                            service,
                            redacted
                        );
                    } else {
                        log::info!(
                            "[plugin:{}] keychain read hit: service={}",
                            pid_read,
                            service
                        );
                    }
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }

                match read_platform_keyring_password(&service, account.as_deref()) {
                    Ok(value) => {
                        if let Some(ref redacted) = redacted_account {
                            log::info!(
                                "[plugin:{}] keyring read hit: service={}, account={}",
                                pid_read,
                                service,
                                redacted
                            );
                        } else {
                            log::info!(
                                "[plugin:{}] keyring read hit: service={}",
                                pid_read,
                                service
                            );
                        }
                        Ok(value)
                    }
                    Err(err) => {
                        if let Some(ref redacted) = redacted_account {
                            log::warn!(
                                "[plugin:{}] keyring read miss: service={}, account={}, error={}",
                                pid_read,
                                service,
                                redacted,
                                err
                            );
                        } else {
                            log::warn!(
                                "[plugin:{}] keyring read miss: service={}, error={}",
                                pid_read,
                                service,
                                err
                            );
                        }
                        Err(Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain item not found: {}", err),
                        ))
                    }
                }
            },
        )?,
    )?;

    let pid_read_current_user = plugin_id.to_string();
    keychain_obj.set(
        "readGenericPasswordForCurrentUser",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, service: String| -> rquickjs::Result<String> {
                let account = if cfg!(target_os = "macos") {
                    current_macos_keychain_account()
                } else {
                    current_macos_keychain_account_from_user_env(
                        read_env_from_process("USER")
                            .or_else(|| read_env_from_process("USERNAME")),
                    )
                };
                let redacted_account = redact_value(&account);
                log::info!(
                    "[plugin:{}] keychain read: service={}, account={}",
                    pid_read_current_user,
                    service,
                    redacted_account
                );

                if cfg!(target_os = "macos") {
                    let args =
                        keychain_find_generic_password_args_for_account(&service, &account);
                    let output = std::process::Command::new("security")
                        .args(&args)
                        .output()
                        .map_err(|e| {
                            Exception::throw_message(
                                &ctx_inner,
                                &format!("keychain read failed: {}", e),
                            )
                        })?;

                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let first_line = stderr.lines().next().unwrap_or("").trim();
                        log::warn!(
                            "[plugin:{}] keychain read miss: service={}, account={}, error={}",
                            pid_read_current_user,
                            service,
                            redacted_account,
                            first_line
                        );
                        return Err(Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain item not found: {}", first_line),
                        ));
                    }

                    log::info!(
                        "[plugin:{}] keychain read hit: service={}, account={}",
                        pid_read_current_user,
                        service,
                        redacted_account
                    );
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }

                match read_platform_keyring_password(&service, Some(&account)) {
                    Ok(value) => {
                        log::info!(
                            "[plugin:{}] keyring read hit: service={}, account={}",
                            pid_read_current_user,
                            service,
                            redacted_account
                        );
                        Ok(value)
                    }
                    Err(err) => {
                        log::warn!(
                            "[plugin:{}] keyring read miss: service={}, account={}, error={}",
                            pid_read_current_user,
                            service,
                            redacted_account,
                            err
                        );
                        Err(Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain item not found: {}", err),
                        ))
                    }
                }
            },
        )?,
    )?;

    let pid_write_account = plugin_id.to_string();
    keychain_obj.set(
        "writeGenericPasswordForAccount",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  service: String,
                  account: String,
                  value: String|
                  -> rquickjs::Result<()> {
                let account = account.trim().to_string();
                if account.is_empty() {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "keychain account must not be empty",
                    ));
                }
                let redacted_account = redact_value(&account);
                log::info!(
                    "[plugin:{}] keychain write: service={}, account={}",
                    pid_write_account,
                    service,
                    redacted_account
                );

                if cfg!(target_os = "macos") {
                    let output = std::process::Command::new("security")
                        .args(keychain_add_generic_password_args_for_account(
                            &service, &account, &value,
                        ))
                        .output()
                        .map_err(|e| {
                            Exception::throw_message(
                                &ctx_inner,
                                &format!("keychain write failed: {}", e),
                            )
                        })?;
                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let first_line = stderr.lines().next().unwrap_or("").trim();
                        return Err(Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain write failed: {}", first_line),
                        ));
                    }
                    return Ok(());
                }

                write_platform_keyring_password(&service, Some(&account), &value).map_err(
                    |err| Exception::throw_message(&ctx_inner, &format!("keychain write failed: {}", err)),
                )
            },
        )?,
    )?;

    let pid_write = plugin_id.to_string();
    keychain_obj.set(
        "writeGenericPassword",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, service: String, value: String| -> rquickjs::Result<()> {
                if !cfg!(target_os = "macos") {
                    return write_platform_keyring_password(&service, None, &value).map_err(|err| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain write failed: {}", err),
                        )
                    });
                }
                log::info!("[plugin:{}] keychain write: service={}", pid_write, service);

                let mut account_arg: Option<String> = None;
                let find_output = std::process::Command::new("security")
                    .args(["find-generic-password", "-s", &service])
                    .output();

                if let Ok(output) = find_output {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        for line in stdout.lines() {
                            if let Some(start) = line.find("\"acct\"<blob>=\"") {
                                let rest = &line[start + 14..];
                                if let Some(end) = rest.find('"') {
                                    account_arg = Some(rest[..end].to_string());
                                    break;
                                }
                            }
                        }
                    }
                }

                let output = if let Some(ref acct) = account_arg {
                    std::process::Command::new("security")
                        .args(keychain_add_generic_password_args_for_account(
                            &service, acct, &value,
                        ))
                        .output()
                } else {
                    std::process::Command::new("security")
                        .args(keychain_add_generic_password_args(&service, &value))
                        .output()
                }
                .map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("keychain write failed: {}", e))
                })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let first_line = stderr.lines().next().unwrap_or("").trim();
                    log::warn!(
                        "[plugin:{}] keychain write failed: service={}, error={}",
                        pid_write,
                        service,
                        first_line
                    );
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!("keychain write failed: {}", first_line),
                    ));
                }

                log::info!(
                    "[plugin:{}] keychain write succeeded: service={}",
                    pid_write,
                    service
                );
                Ok(())
            },
        )?,
    )?;

    host.set("keychain", keychain_obj)?;
    Ok(())
}

fn rusqlite_value_to_json(v: rusqlite::types::Value) -> JsonValue {
    match v {
        rusqlite::types::Value::Null => JsonValue::Null,
        rusqlite::types::Value::Integer(i) => JsonValue::Number(serde_json::Number::from(i)),
        rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        rusqlite::types::Value::Text(s) => JsonValue::String(s),
        rusqlite::types::Value::Blob(b) => JsonValue::String(String::from_utf8_lossy(&b).into_owned()),
    }
}

fn sqlite_query_impl(expanded: &str, sql: &str) -> Result<String, String> {
    // Prefer normal read-only open so WAL contents are visible (common for app state DBs).
    let conn = match Connection::open_with_flags(expanded, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(e) => {
            // Fall back to immutable=1 to bypass WAL/SHM lock issues after macOS sleep.
            let encoded = expanded
                .replace('%', "%25")
                .replace(' ', "%20")
                .replace('#', "%23")
                .replace('?', "%3F");
            let uri = format!("file:{}?immutable=1", encoded);
            Connection::open_with_flags(&uri, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI)
                .map_err(|e2| format!("sqlite open failed: {} (fallback: {})", e, e2))?
        }
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let col_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let rows = stmt
        .query_map([], |row| {
            let mut obj = Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let v: rusqlite::types::Value = row.get(i).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
                obj.insert(name.clone(), rusqlite_value_to_json(v));
            }
            Ok(JsonValue::Object(obj))
        })
        .map_err(|e| e.to_string())?;
    let arr: Result<Vec<_>, _> = rows.collect();
    let arr = arr.map_err(|e| e.to_string())?;
    serde_json::to_string(&arr).map_err(|e| e.to_string())
}

fn sqlite_exec_impl(expanded: &str, sql: &str) -> Result<(), String> {
    let conn = Connection::open(expanded).map_err(|e| e.to_string())?;
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

fn inject_sqlite<'js>(ctx: &Ctx<'js>, host: &Object<'js>) -> rquickjs::Result<()> {
    let sqlite_obj = Object::new(ctx.clone())?;

    sqlite_obj.set(
        "query",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, db_path: String, sql: String| -> rquickjs::Result<String> {
                reject_path_traversal(&ctx_inner, &db_path)?;
                if sql.lines().any(|line| line.trim_start().starts_with('.')) {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "sqlite3 dot-commands are not allowed",
                    ));
                }
                let expanded = expand_path(&db_path);
                sqlite_query_impl(&expanded, &sql).map_err(|e| Exception::throw_message(&ctx_inner, &e))
            },
        )?,
    )?;

    sqlite_obj.set(
        "exec",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, db_path: String, sql: String| -> rquickjs::Result<()> {
                reject_path_traversal(&ctx_inner, &db_path)?;
                if sql.lines().any(|line| line.trim_start().starts_with('.')) {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "sqlite3 dot-commands are not allowed",
                    ));
                }
                let expanded = expand_path(&db_path);
                sqlite_exec_impl(&expanded, &sql).map_err(|e| Exception::throw_message(&ctx_inner, &e))
            },
        )?,
    )?;

    host.set("sqlite", sqlite_obj)?;
    Ok(())
}

fn inject_chromium_cookies<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
) -> rquickjs::Result<()> {
    let cookies_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    cookies_obj.set(
        "_readRaw",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
                let opts: crate::chromium_cookies::ChromiumCookiesReadOpts =
                    serde_json::from_str(&opts_json).map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("invalid chromiumCookies.read args: {}", e),
                        )
                    })?;
                log::info!(
                    "[plugin:{}] chromiumCookies.read: {} names, {} hosts",
                    pid,
                    opts.names.len(),
                    opts.hosts.len()
                );
                let map = crate::chromium_cookies::read_chromium_cookies(&opts)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e))?;
                serde_json::to_string(&map).map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("serialize cookies failed: {}", e))
                })
            },
        )?,
    )?;

    host.set("chromiumCookies", cookies_obj)?;
    Ok(())
}

pub fn patch_chromium_cookies_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.chromiumCookies._readRaw;
            __openusage_ctx.host.chromiumCookies.read = function(opts) {
                var json = JSON.stringify({
                    hosts: (opts && opts.hosts) || [],
                    names: (opts && opts.names) || []
                });
                var respJson = rawFn(json);
                return JSON.parse(respJson);
            };
        })();
        "#
        .as_bytes(),
    )
}

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn path_has_parent_segment(path: &str) -> bool {
    path.split(&['/', '\\']).any(|segment| segment == "..")
}

fn reject_path_traversal<'js>(ctx: &Ctx<'js>, path: &str) -> rquickjs::Result<()> {
    if path_has_parent_segment(path) {
        return Err(Exception::throw_message(ctx, "path traversal is not allowed"));
    }
    Ok(())
}

fn expand_path(path: &str) -> String {
    if path == "~" {
        if let Some(home) = home_dir() {
            return home.to_string_lossy().to_string();
        }
    }
    if path.starts_with("~/") {
        if let Some(home) = home_dir() {
            return home.join(&path[2..]).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rquickjs::{Context, Function, Object, Runtime};

    fn encrypt_aes_256_gcm_envelope_for_test(key: &[u8], plaintext: &str) -> String {
        let iv = [7_u8; 16];
        type Aes256Gcm16 = AesGcm<Aes256, U16>;
        let cipher = Aes256Gcm16::new_from_slice(key).expect("encrypt init");
        let nonce = Nonce::<U16>::from_slice(&iv);
        let ciphertext_and_tag = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .expect("encrypt finalize");
        let split_at = ciphertext_and_tag.len() - 16;
        let (ciphertext, tag) = ciphertext_and_tag.split_at(split_at);

        format!(
            "{}:{}:{}",
            BASE64_STANDARD.encode(iv),
            BASE64_STANDARD.encode(tag),
            BASE64_STANDARD.encode(ciphertext)
        )
    }

    #[test]
    fn app_support_path_candidates_cover_linux_macos_windows() {
        let paths = app_support_path_candidates("Kiro/User/globalStorage/state.vscdb");
        assert_eq!(paths.len(), 3);
        assert!(paths[0].starts_with("~/.config/Kiro/"));
        assert!(paths[1].contains("Library/Application Support/Kiro/"));
        assert!(paths[2].contains("AppData/Roaming/Kiro/"));
    }

    #[test]
    fn windows_go_keyring_secret_decodes_raw_utf8() {
        let raw = br#"{"token":{"access_token":"test-token"}}"#.to_vec();
        assert_eq!(
            decode_windows_go_keyring_secret(raw).expect("raw go-keyring secret"),
            r#"{"token":{"access_token":"test-token"}}"#
        );
    }

    #[test]
    fn windows_go_keyring_secret_rejects_utf16_password_bytes() {
        let utf16le = vec![b'{', 0, b'}', 0];
        assert!(decode_windows_go_keyring_secret(utf16le).is_err());
    }

    #[test]
    fn windows_credential_blob_prefers_utf8_then_utf16le() {
        let utf8 = br#"{"token":{"access_token":"from-agy"}}"#.to_vec();
        assert_eq!(
            decode_windows_credential_blob(utf8).expect("utf8"),
            r#"{"token":{"access_token":"from-agy"}}"#
        );

        // `{` `}` as UTF-16LE → "{}"
        let utf16le = vec![b'{', 0, b'}', 0];
        assert_eq!(
            decode_windows_credential_blob(utf16le).expect("utf16"),
            "{}"
        );
    }

    #[test]
    fn windows_utf16le_secret_decodes_json_payload() {
        let json = r#"{"token":{"access_token":"refreshed"}}"#;
        let mut utf16le = Vec::new();
        for unit in json.encode_utf16() {
            utf16le.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(
            decode_windows_keyring_utf16le_secret(&utf16le).expect("utf16 json"),
            json
        );
    }

    #[test]
    fn first_existing_path_returns_first_match() {
        let dir = tempfile::tempdir().expect("tempdir");
        let existing = dir.path().join("found.txt");
        std::fs::write(&existing, "ok").expect("write");
        let missing = dir.path().join("missing.txt");
        let paths = vec![
            missing.to_string_lossy().to_string(),
            existing.to_string_lossy().to_string(),
        ];
        let found = first_existing_path(&paths).expect("found");
        assert_eq!(found, existing.to_string_lossy());
    }

    #[test]
    fn last_non_empty_trimmed_line_uses_final_value_when_stdout_is_noisy() {
        let stdout = "banner line\nanother message\n  sk-test-key-12345  \n";
        let value = last_non_empty_trimmed_line(stdout);
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn last_non_empty_trimmed_line_returns_none_for_empty_stdout() {
        let stdout = "  \n\n\t\n";
        let value = last_non_empty_trimmed_line(stdout);
        assert!(value.is_none());
    }

    #[test]
    fn decrypt_aes_256_gcm_envelope_round_trips_plaintext() {
        let key = [11_u8; 32];
        let key_b64 = BASE64_STANDARD.encode(key);
        let plaintext = r#"{"access_token":"token","refresh_token":"refresh"}"#;
        let envelope = encrypt_aes_256_gcm_envelope_for_test(&key, plaintext);

        let decrypted =
            decrypt_aes_256_gcm_envelope(&envelope, &key_b64).expect("decrypt envelope");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_aes_256_gcm_envelope_round_trips_plaintext() {
        let key = [21_u8; 32];
        let key_b64 = BASE64_STANDARD.encode(key);
        let plaintext = r#"{"access_token":"token-2","refresh_token":"refresh-2"}"#;

        let envelope = encrypt_aes_256_gcm_envelope(plaintext, &key_b64).expect("encrypt envelope");
        let decrypted =
            decrypt_aes_256_gcm_envelope(&envelope, &key_b64).expect("decrypt envelope");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_aes_256_gcm_envelope_rejects_invalid_component_lengths() {
        let key_b64 = BASE64_STANDARD.encode([9_u8; 32]);
        let short_key_b64 = BASE64_STANDARD.encode([7_u8; 31]);
        let iv_b64 = BASE64_STANDARD.encode([1_u8; 15]);
        let tag_b64 = BASE64_STANDARD.encode([2_u8; 16]);
        let ciphertext_b64 = BASE64_STANDARD.encode([3_u8; 8]);

        let key_err =
            decrypt_aes_256_gcm_envelope("AQ==:AQ==:AQ==", &short_key_b64).expect_err("key length");
        assert!(key_err.contains("expected 32 bytes"));

        let iv_err = decrypt_aes_256_gcm_envelope(
            &format!("{}:{}:{}", iv_b64, tag_b64, ciphertext_b64),
            &key_b64,
        )
        .expect_err("iv length");
        assert!(iv_err.contains("iv length"));

        let short_tag_b64 = BASE64_STANDARD.encode([2_u8; 15]);
        let tag_err = decrypt_aes_256_gcm_envelope(
            &format!(
                "{}:{}:{}",
                BASE64_STANDARD.encode([1_u8; 16]),
                short_tag_b64,
                ciphertext_b64
            ),
            &key_b64,
        )
        .expect_err("tag length");
        assert!(tag_err.contains("auth tag length"));
    }

    #[test]
    fn path_has_parent_segment_detects_dot_dot() {
        assert!(path_has_parent_segment("~/../../etc/passwd"));
        assert!(path_has_parent_segment("/tmp/../etc/passwd"));
        assert!(!path_has_parent_segment("~/.config/Cursor/User/globalStorage/state.vscdb"));
    }

    #[test]
    fn sanitize_env_value_strips_ansi_and_control_sequences() {
        let raw = "\u{1b}[?1000l\n  sk-test-key-12345\u{1b}[?2004h\r\n";
        let value = sanitize_env_value(raw);
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn extract_marked_value_accepts_banner_glued_to_start_marker() {
        let stdout = "memory 34 GiB __OPENUSAGE_ENV_START__\n/home/dev/.codex\n__OPENUSAGE_ENV_END__\n";
        assert_eq!(
            parse_interactive_shell_env_output(
                stdout,
                "__OPENUSAGE_ENV_START__",
                "__OPENUSAGE_ENV_END__"
            )
            .as_deref(),
            Some("/home/dev/.codex")
        );
    }

    #[test]
    fn extract_marked_value_ignores_noisy_shell_output() {
        let stdout = concat!(
            "startup banner\n",
            "\u{1b}[31mplugin failed\u{1b}[0m\n",
            "__OPENUSAGE_ENV_START__\n",
            "  sk-test-key-12345  \n",
            "__OPENUSAGE_ENV_END__\n",
            "\u{1b}[32muser@host\u{1b}[0m\n"
        );
        let value =
            extract_marked_value(stdout, "__OPENUSAGE_ENV_START__", "__OPENUSAGE_ENV_END__");
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn extract_marked_value_strips_inline_terminal_sequences_from_marked_value() {
        let stdout = concat!(
            "__OPENUSAGE_ENV_START__\n",
            "\u{1b}[?1000l\n",
            "  sk-test-key-12345\u{1b}[?2004h\r\n",
            "__OPENUSAGE_ENV_END__\n"
        );
        let value =
            extract_marked_value(stdout, "__OPENUSAGE_ENV_START__", "__OPENUSAGE_ENV_END__");
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn extract_marked_value_returns_none_when_marked_value_is_empty() {
        let stdout = "__OPENUSAGE_ENV_START__\n  \n__OPENUSAGE_ENV_END__\n";
        let value =
            extract_marked_value(stdout, "__OPENUSAGE_ENV_START__", "__OPENUSAGE_ENV_END__");
        assert!(value.is_none());
    }

    #[test]
    fn parse_interactive_shell_env_output_does_not_fallback_to_end_marker_for_empty_value() {
        let stdout = "__OPENUSAGE_ENV_START__\n  \n__OPENUSAGE_ENV_END__\n";
        let value = parse_interactive_shell_env_output(
            stdout,
            "__OPENUSAGE_ENV_START__",
            "__OPENUSAGE_ENV_END__",
        );
        assert!(value.is_none());
    }

    #[test]
    fn parse_interactive_shell_env_output_falls_back_without_markers() {
        let stdout = "\u{1b}[?1000l\n  sk-test-key-12345\u{1b}[?2004h\r\n";
        let value = parse_interactive_shell_env_output(
            stdout,
            "__OPENUSAGE_ENV_START__",
            "__OPENUSAGE_ENV_END__",
        );
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn crypto_api_exposes_decrypt() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let crypto: Object = host.get("crypto").expect("crypto");
            let _decrypt: Function = crypto.get("decryptAes256Gcm").expect("decryptAes256Gcm");
            let _encrypt: Function = crypto.get("encryptAes256Gcm").expect("encryptAes256Gcm");
        });
    }

    #[test]
    fn keychain_api_exposes_write() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let keychain: Object = host.get("keychain").expect("keychain");
            let _read: Function = keychain
                .get("readGenericPassword")
                .expect("readGenericPassword");
            let _write: Function = keychain
                .get("writeGenericPassword")
                .expect("writeGenericPassword");
        });
    }

    #[test]
    fn keychain_read_generic_password_accepts_optional_account_arg_from_js() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");

            let message: String = ctx
                .eval(
                    r#"
                    try {
                        __openusage_ctx.host.keychain.readGenericPassword("__openusage_missing_service__");
                        "ok";
                    } catch (e) {
                        String(e);
                    }
                    "#,
                )
                .expect("js eval");

            assert!(
                !message.contains("2 where expected"),
                "single-arg call should reach the keychain implementation, got: {}",
                message
            );
        });
    }

    #[test]
    fn cursor_paths_resolve_state_db_accepts_zero_args_from_js() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "cursor", "cursor", None, &app_data, "0.0.0")
                .expect("inject host api");

            let message: String = ctx
                .eval(
                    r#"
                    try {
                        var res = __openusage_ctx.host.cursorPaths.resolveStateDb();
                        res === null || typeof res === "string" ? "ok" : "unexpected:" + typeof res;
                    } catch (e) {
                        String(e);
                    }
                    "#,
                )
                .expect("js eval");

            assert_eq!(
                message, "ok",
                "zero-arg cursorPaths.resolveStateDb() should succeed without arity TypeError, got: {}",
                message
            );
        });
    }

    #[test]
    fn crypto_api_exposes_sha256_hex() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            let result: String = ctx
                .eval(r#"__openusage_ctx.host.crypto.sha256Hex("hello")"#)
                .expect("js sha256");
            assert_eq!(
                result,
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
            );
        });
    }

    #[test]
    fn crypto_api_exposes_sha1_hex() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            let result: String = ctx
                .eval(r#"__openusage_ctx.host.crypto.sha1Hex("hello")"#)
                .expect("js sha1");
            assert_eq!(result, "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
        });
    }

    #[test]
    fn chromium_cookies_api_exposes_read() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            patch_chromium_cookies_wrapper(&ctx).expect("patch chromium cookies");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let cookies: Object = host.get("chromiumCookies").expect("chromiumCookies");
            let _raw: Function = cookies.get("_readRaw").expect("_readRaw");
            let _read: Function = cookies.get("read").expect("read");
        });
    }

    #[test]
    fn fireworks_api_exposes_billing_export_helper() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            patch_fireworks_wrapper(&ctx).expect("patch fireworks wrapper");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let fireworks: Object = host.get("fireworks").expect("fireworks");
            let _raw: Function = fireworks
                .get("_exportBillingMetricsRaw")
                .expect("_exportBillingMetricsRaw");
            let _wrapped: Function = fireworks
                .get("exportBillingMetrics")
                .expect("exportBillingMetrics");
        });
    }

    #[test]
    fn antigravity_logs_query_daily_returns_status() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            patch_antigravity_logs_wrapper(&ctx).expect("patch antigravity logs wrapper");
            let json: String = ctx
                .eval(r#"JSON.stringify(__openusage_ctx.host.antigravityLogs.queryDaily({}))"#)
                .expect("queryDaily");
            let v: serde_json::Value = serde_json::from_str(&json).expect("json");
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("");
            assert!(status == "ok" || status == "no_data", "got {status}");
            assert!(v.get("data").and_then(|d| d.get("daily")).and_then(|d| d.as_array()).is_some());
        });
    }

    #[test]
    fn grok_logs_query_daily_returns_status() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            patch_grok_logs_wrapper(&ctx).expect("patch grok logs wrapper");
            let json: String = ctx
                .eval(r#"JSON.stringify(__openusage_ctx.host.grokLogs.queryDaily({}))"#)
                .expect("queryDaily");
            let v: serde_json::Value = serde_json::from_str(&json).expect("json");
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("");
            assert!(status == "ok" || status == "no_data", "got {status}");
            assert!(v.get("data").and_then(|d| d.get("daily")).and_then(|d| d.as_array()).is_some());
        });
    }

    #[test]
    fn env_api_respects_allowlist_in_host_and_js() {
        let claude_env_vars = [
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "USER_TYPE",
            "USE_STAGING_OAUTH",
            "USE_LOCAL_OAUTH",
            "CLAUDE_CODE_CUSTOM_OAUTH_URL",
            "CLAUDE_CODE_OAUTH_CLIENT_ID",
            "CLAUDE_LOCAL_OAUTH_API_BASE",
        ];

        for name in claude_env_vars {
            assert!(
                WHITELISTED_ENV_VARS.contains(&name),
                "{name} must be whitelisted for Claude auth compatibility"
            );
        }
        for name in [
            "OLLAMA_API_KEY",
            "OLLAMA_HOST",
            "OLLAMA_SESSION_COOKIE",
            "OLLAMA_COOKIE",
            "GEMINI_COOKIE",
        ] {
            assert!(
                WHITELISTED_ENV_VARS.contains(&name),
                "{name} must be whitelisted for Ollama/Gemini auth compatibility"
            );
        }

        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let env: Object = host.get("env").expect("env");
            let get: Function = env.get("get").expect("get");

            for name in WHITELISTED_ENV_VARS {
                let expected = resolve_env_value(name);
                let value: Option<String> =
                    get.call((name.to_string(),)).expect("get whitelisted var");
                assert_eq!(value, expected, "{name} should match host env resolver");

                let js_expr = format!(r#"__openusage_ctx.host.env.get("{}")"#, name);
                let js_value: Option<String> = ctx.eval(js_expr).expect("js get whitelisted var");
                assert_eq!(
                    js_value, expected,
                    "{name} should match host env resolver from JS"
                );
            }

            let blocked: Option<String> = get
                .call(("__OPENUSAGE_TEST_NOT_WHITELISTED__".to_string(),))
                .expect("get blocked var");
            assert!(
                blocked.is_none(),
                "non-whitelisted vars must not be exposed"
            );

            let js_blocked: Option<String> = ctx
                .eval(r#"__openusage_ctx.host.env.get("__OPENUSAGE_TEST_NOT_WHITELISTED__")"#)
                .expect("js get blocked var");
            assert!(
                js_blocked.is_none(),
                "non-whitelisted vars must not be exposed from JS"
            );
        });
    }

    #[test]
    fn env_api_prefers_process_env() {
        struct RestoreEnvVar {
            name: &'static str,
            old: Option<String>,
        }

        impl Drop for RestoreEnvVar {
            fn drop(&mut self) {
                if let Some(value) = self.old.take() {
                    // SAFETY: tests serialize env changes via this guard; value is restored on drop.
                    unsafe { std::env::set_var(self.name, value) };
                } else {
                    // SAFETY: tests serialize env changes via this guard; var is restored/removed on drop.
                    unsafe { std::env::remove_var(self.name) };
                }
            }
        }

        let name = "ZAI_API_KEY";
        let old = std::env::var(name).ok();
        let _restore = RestoreEnvVar { name, old };
        // SAFETY: this test restores the previous value in `Drop`.
        unsafe { std::env::set_var(name, "sk-process-env-test-1234567890") };

        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", "test", None, &app_data, "0.0.0")
                .expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let env: Object = host.get("env").expect("env");
            let get: Function = env.get("get").expect("get");

            let value: Option<String> = get.call((name.to_string(),)).expect("get");
            assert_eq!(
                value.as_deref(),
                Some("sk-process-env-test-1234567890"),
                "process env should be preferred over shell lookup"
            );

            let js_value: Option<String> = ctx
                .eval(r#"__openusage_ctx.host.env.get("ZAI_API_KEY")"#)
                .expect("js get");
            assert_eq!(
                js_value.as_deref(),
                Some("sk-process-env-test-1234567890"),
                "process env should be preferred from JS"
            );
        });
    }

    #[test]
    fn env_api_exposes_fireworks_api_key() {
        struct RestoreEnvVar {
            name: &'static str,
            old: Option<String>,
        }

        impl Drop for RestoreEnvVar {
            fn drop(&mut self) {
                if let Some(value) = self.old.take() {
                    unsafe { std::env::set_var(self.name, value) };
                } else {
                    unsafe { std::env::remove_var(self.name) };
                }
            }
        }

        let name = "FIREWORKS_API_KEY";
        let old = std::env::var(name).ok();
        let _restore = RestoreEnvVar { name, old };
        unsafe { std::env::set_var(name, "fw-process-env-test-1234567890") };

        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "fireworks", "fireworks", None, &app_data, "0.0.0")
                .expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let env: Object = host.get("env").expect("env");
            let get: Function = env.get("get").expect("get");

            let value: Option<String> = get.call((name.to_string(),)).expect("get");
            assert_eq!(
                value.as_deref(),
                Some("fw-process-env-test-1234567890"),
                "fireworks env should be exposed to plugins"
            );

            let js_value: Option<String> = ctx
                .eval(r#"__openusage_ctx.host.env.get("FIREWORKS_API_KEY")"#)
                .expect("js get");
            assert_eq!(
                js_value.as_deref(),
                Some("fw-process-env-test-1234567890"),
                "fireworks env should be exposed from JS"
            );
        });
    }

    #[test]
    fn redact_value_shows_first_and_last_four() {
        assert_eq!(redact_value("sk-1234567890abcdef"), "sk-1...cdef");
        assert_eq!(redact_value("short"), "[REDACTED]");
    }

    #[test]
    fn redact_url_redacts_api_key_param() {
        let url = "https://api.example.com/v1?api_key=sk-1234567890abcdef&other=value";
        let redacted = redact_url(url);
        assert!(redacted.contains("api_key=sk-1...cdef"));
        assert!(redacted.contains("other=value"));
    }

    #[test]
    fn redact_url_redacts_user_query_param() {
        let url = "https://cursor.com/api/usage?user=user_abcdefghijklmnopqrstuvwxyz&limit=10";
        let redacted = redact_url(url);
        assert!(
            redacted.contains("user=user...wxyz"),
            "user query param should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("limit=10"),
            "non-sensitive params should be preserved, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_url_preserves_non_sensitive_params() {
        let url = "https://api.example.com/v1?limit=10&offset=20";
        assert_eq!(redact_url(url), url);
    }

    #[test]
    fn redact_url_redacts_profile_arn_query_param() {
        let url = "https://q.us-east-1.amazonaws.com/getUsageLimits?profileArn=arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK&origin=AI_EDITOR";
        let redacted = redact_url(url);
        assert!(
            !redacted.contains("699475941385"),
            "profileArn should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("origin=AI_EDITOR"),
            "non-sensitive params should remain visible, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_url_redacts_account_id_path_segment() {
        let url =
            "https://api.fireworks.ai/v1/accounts/acct_1234567890abcdef/quotas?pageSize=200";
        let redacted = redact_url(url);
        assert!(
            !redacted.contains("acct_1234567890abcdef"),
            "account path segment should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("/quotas?pageSize=200"),
            "non-sensitive path/query parts should remain visible, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_jwt() {
        let body = r#"{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"}"#;
        let redacted = redact_body(body);
        // JWT gets redacted to first4...last4 format
        assert!(
            !redacted.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
            "full JWT should be redacted, got: {}",
            redacted
        );

        let jwe_body = r#"{"cookie": "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccc.dddddddddddddddddddd"}"#;
        let redacted_jwe = redact_body(jwe_body);
        assert!(
            !redacted_jwe.contains("bbbbbbbbbbbbbbbbbbbb"),
            "5-segment JWE should be redacted, got: {}",
            redacted_jwe
        );
    }

    #[test]
    fn redact_body_redacts_api_keys() {
        let body = r#"{"key": "sk-1234567890abcdefghij"}"#;
        let redacted = redact_body(body);
        assert!(redacted.contains("sk-1...ghij"));
    }

    #[test]
    fn redact_body_redacts_email_in_html() {
        let body = r#"<html><body><p>person@example.com</p></body></html>"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("person@example.com"),
            "email should be redacted from HTML body, got: {}",
            redacted
        );
        assert!(redacted.contains("pers....com"));
    }

    #[test]
    fn redact_body_redacts_devin_session_token() {
        let body = r#"metadata apiKey=devin-session-token$abcdefghijklmnopqrstuvwxyz123456"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("devin-session-token$abcdefghijklmnopqrstuvwxyz123456"),
            "Devin session token should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("devi...3456"),
            "Devin session token should use first4...last4 redaction, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_json_password_field() {
        let body = r#"{"password": "supersecretpassword123"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("supersecretpassword123"),
            "password should be redacted, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_jetbrains_junie_username_and_tokens() {
        let body = r#"{"username":"pmarti9","rpc_token":"secret_rpc_token_12345","simpleToken":"junie_token_abcdef123456","balanceLeft":600000.0}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("pmarti9"),
            "username should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("secret_rpc_token_12345"),
            "rpc_token should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("junie_token_abcdef123456"),
            "simpleToken should be redacted, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_user_id_and_email() {
        let body = r#"{"user_id": "user-iupzZ7KFykMLrnzpkHSq7wjo", "email": "rob@sunstory.com"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("user-iupzZ7KFykMLrnzpkHSq7wjo"),
            "user_id should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("rob@sunstory.com"),
            "email should be redacted, got: {}",
            redacted
        );
        // Should show first4...last4
        assert!(
            redacted.contains("user...7wjo"),
            "user_id should show first4...last4, got: {}",
            redacted
        );
        assert!(
            redacted.contains("rob@....com"),
            "email should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_profile_arn_fields() {
        let body = r#"{"profileArn":"arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK","profile_arn":"arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("699475941385"),
            "profile arn should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("arn:...QMUK"),
            "profile arn should use first4...last4 redaction, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_camel_case_user_and_account_ids() {
        let body = r#"{"userId": "user_abcdefghijklmnopqrstuvwxyz", "accountId": "acct_1234567890abcdef"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("user_abcdefghijklmnopqrstuvwxyz"),
            "userId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("acct_1234567890abcdef"),
            "accountId should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("user...wxyz"),
            "userId should show first4...last4, got: {}",
            redacted
        );
        assert!(
            redacted.contains("acct...cdef"),
            "accountId should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_devin_org_and_account_display_name() {
        let body = r#"{"orgId":"org-6b6e9de248db472bb25b296599ea3dc0","accountDisplayName":"rob@sunstory.com","devinInfo":{"org_id":"org-abcdef1234567890","account_display_name":"team@example.com"}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("org-6b6e9de248db472bb25b296599ea3dc0"),
            "orgId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("rob@sunstory.com"),
            "accountDisplayName should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("org-abcdef1234567890"),
            "org_id should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("team@example.com"),
            "account_display_name should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("org-...3dc0"),
            "orgId should show first4...last4, got: {}",
            redacted
        );
        assert!(
            redacted.contains("rob@....com"),
            "accountDisplayName should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_team_id_payment_id_and_paths() {
        let body = r#"{"teamId":"cc1ac023-9ff5-4c1f-a5a4-ae2a82df4243","paymentId":"cus_S5m1PGxjLWoc1c","binaryPath":"/opt/homebrew/bin/bunx","homePath":"/Users/rebers/.claude"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("cc1ac023-9ff5-4c1f-a5a4-ae2a82df4243"),
            "teamId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("cus_S5m1PGxjLWoc1c"),
            "paymentId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/opt/homebrew/bin/bunx"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/Users/rebers/.claude"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("[PATH]"),
            "expected path marker, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_log_message_redacts_jwt_and_api_key() {
        let msg = "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U key=sk-1234567890abcdef";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
            "JWT should be redacted"
        );
        assert!(
            !redacted.contains("sk-1234567890abcdef"),
            "API key should be redacted"
        );
    }

    #[test]
    fn redact_log_message_redacts_email() {
        let msg = "settings page contained person@example.com";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("person@example.com"),
            "email should be redacted"
        );
        assert!(redacted.contains("pers....com"));
    }

    #[test]
    fn redact_log_message_redacts_devin_session_token() {
        let msg = "auth=devin-session-token$abcdefghijklmnopqrstuvwxyz123456";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("devin-session-token$abcdefghijklmnopqrstuvwxyz123456"),
            "Devin session token should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("devi...3456"),
            "Devin session token should use first4...last4 redaction, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_log_message_redacts_account_and_paths() {
        let msg = "keychain read: service=Claude Code-credentials, account=rebers path=/opt/homebrew/bin/bunx home=/Users/rebers/.claude";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("account=rebers"),
            "account should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/opt/homebrew/bin/bunx"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/Users/rebers/.claude"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("account=[REDACTED]"),
            "expected redacted account, got: {}",
            redacted
        );
        assert!(
            redacted.contains("[PATH]"),
            "expected redacted path, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_login_and_analytics_tracking_id() {
        let body =
            r#"{"login":"robinebers","analytics_tracking_id":"c9df3f012bb8c2eb7aae6868ee8da6cf"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("robinebers"),
            "login should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("c9df3f012bb8c2eb7aae6868ee8da6cf"),
            "analytics_tracking_id should be redacted, got: {}",
            redacted
        );
        // login is short (<=12 chars) so becomes [REDACTED]; analytics_tracking_id is long so first4...last4
        assert!(
            redacted.contains("[REDACTED]"),
            "login should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("c9df...a6cf"),
            "analytics_tracking_id should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_name_field() {
        let body =
            r#"{"userStatus":{"name":"Robin Ebers","email":"rob@sunstory.com","planStatus":{}}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("Robin Ebers"),
            "name should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("rob@sunstory.com"),
            "email should be redacted, got: {}",
            redacted
        );
        // "Robin Ebers" is 11 chars (<=12) so becomes [REDACTED]
        assert!(
            redacted.contains("\"name\": \"[REDACTED]\""),
            "name should show [REDACTED], got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_google_session_cookies() {
        let body = r#"{"Cookie":"SID=g.a000sidvaluehere; SAPISID=sapsidvaluehere; __Secure-1PSID=psidvaluehereok"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("g.a000sidvaluehere"),
            "SID value should be redacted, got: {redacted}"
        );
        assert!(
            !redacted.contains("sapsidvaluehere"),
            "SAPISID value should be redacted, got: {redacted}"
        );
        assert!(
            !redacted.contains("psidvaluehereok"),
            "__Secure-1PSID value should be redacted, got: {redacted}"
        );
    }

    #[test]
    fn redact_log_message_redacts_google_cookie_pairs() {
        let msg = "Cookie: SID=g.a000sidvaluehere; SAPISID=sapsidvaluehere";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("g.a000sidvaluehere"),
            "SID should be redacted, got: {redacted}"
        );
        assert!(
            !redacted.contains("sapsidvaluehere"),
            "SAPISID should be redacted, got: {redacted}"
        );
    }

    #[test]
    fn redact_body_redacts_claude_profile_uuids() {
        let body = r#"{"account":{"uuid":"acct-1234567890abcdef"},"organization":{"uuid":"org-abcdef1234567890","organization_type":"claude_max"}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("acct-1234567890abcdef"),
            "account uuid should be redacted, got: {redacted}"
        );
        assert!(
            !redacted.contains("org-abcdef1234567890"),
            "organization uuid should be redacted, got: {redacted}"
        );
        assert!(
            redacted.contains("claude_max"),
            "organization_type should stay visible, got: {redacted}"
        );
    }

}
