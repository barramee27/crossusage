use std::path::Path;
use std::sync::{Mutex, OnceLock};

const TOKEN_FILE_NAME: &str = "local-http-api-token";

fn token_slot() -> &'static Mutex<String> {
    static TOKEN: OnceLock<Mutex<String>> = OnceLock::new();
    TOKEN.get_or_init(|| Mutex::new(String::new()))
}

pub fn init_api_token(app_data_dir: &Path) {
    let path = app_data_dir.join(TOKEN_FILE_NAME);
    let token = match std::fs::read_to_string(&path) {
        Ok(existing) => {
            let trimmed = existing.trim();
            if trimmed.len() >= 32 {
                trimmed.to_string()
            } else {
                write_token_file(&path)
            }
        }
        Err(_) => write_token_file(&path),
    };
    *token_slot().lock().expect("api token lock poisoned") = token;
}

pub fn api_token() -> String {
    token_slot()
        .lock()
        .expect("api token lock poisoned")
        .clone()
}

fn write_token_file(path: &Path) -> String {
    let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .unwrap_or_else(|e| panic!("failed to create {}: {}", path.display(), e));
        file.write_all(token.as_bytes())
            .unwrap_or_else(|e| panic!("failed to write {}: {}", path.display(), e));
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, &token)
            .unwrap_or_else(|e| panic!("failed to write {}: {}", path.display(), e));
    }
    token
}

/// `OPTIONS` is allowed without auth so browsers can complete CORS preflight.
pub fn is_authorized(request: &str, method: &str) -> bool {
    if method.eq_ignore_ascii_case("OPTIONS") {
        return true;
    }

    let expected = api_token();
    if expected.is_empty() {
        return false;
    }

    for line in request.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        let Some((_, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if value.len() < 7 || !value.as_bytes()[..7].eq_ignore_ascii_case(b"Bearer ") {
            continue;
        }
        if value[7..].trim() == expected {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_data(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("crossusage-local-http-auth-{name}-{nonce}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn init_api_token_persists_and_reuses_token() {
        let dir = temp_app_data("persist");
        init_api_token(&dir);
        let first = api_token();
        assert!(first.len() >= 32);

        init_api_token(&dir);
        assert_eq!(api_token(), first);
    }

    #[test]
    fn is_authorized_accepts_bearer_and_options() {
        let dir = temp_app_data("bearer");
        init_api_token(&dir);
        let token = api_token();

        let get = format!(
            "GET /v1/usage HTTP/1.1\r\nAuthorization: Bearer {token}\r\n\r\n"
        );
        assert!(is_authorized(&get, "GET"));

        let options = "OPTIONS /v1/usage HTTP/1.1\r\n\r\n";
        assert!(is_authorized(options, "OPTIONS"));
    }

    #[test]
    fn is_authorized_rejects_missing_or_wrong_token() {
        let dir = temp_app_data("reject");
        init_api_token(&dir);

        let no_auth = "GET /v1/usage HTTP/1.1\r\n\r\n";
        assert!(!is_authorized(no_auth, "GET"));

        let wrong = "GET /v1/usage HTTP/1.1\r\nAuthorization: Bearer wrong\r\n\r\n";
        assert!(!is_authorized(wrong, "GET"));
    }
}
