//! Optional HTTP/SOCKS proxy from `~/.crossusage/config.json` (primary) or
//! `~/.openusage/config.json` (legacy OpenUsage path).

use reqwest::Proxy;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub proxy: Option<ProxyConfig>,
}

#[derive(Debug, Clone)]
pub struct ResolvedProxy {
    pub proxy: Proxy,
}

static RESOLVED_PROXY: OnceLock<Option<ResolvedProxy>> = OnceLock::new();

pub fn get_resolved_proxy() -> Option<&'static ResolvedProxy> {
    RESOLVED_PROXY.get_or_init(load_and_resolve_proxy).as_ref()
}

/// Config files checked in order for `proxy` settings (first file wins if it enables a proxy).
fn user_proxy_config_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    vec![
        home.join(".crossusage").join("config.json"),
        home.join(".openusage").join("config.json"),
    ]
}

fn resolve_proxy_from_config_contents(contents: &str, path: &Path) -> Option<ResolvedProxy> {
    let config: AppConfig = match serde_json::from_str(contents) {
        Ok(cfg) => cfg,
        Err(e) => {
            log::warn!(
                "[config] failed to parse {}: {}, skipping",
                path.display(),
                e
            );
            return None;
        }
    };

    let Some(proxy_cfg) = config.proxy.as_ref().filter(|p| p.enabled) else {
        log::debug!(
            "[config] proxy disabled or missing in {}",
            path.display()
        );
        return None;
    };

    match Proxy::all(&proxy_cfg.url) {
        Ok(proxy) => {
            let redacted = redact_proxy_url(&proxy_cfg.url);
            log::debug!(
                "[config] proxy enabled from {}: {}",
                path.display(),
                redacted
            );

            let no_proxy = reqwest::NoProxy::from_string("localhost,127.0.0.1,::1");
            let proxy = proxy.no_proxy(no_proxy);

            Some(ResolvedProxy { proxy })
        }
        Err(e) => {
            log::warn!(
                "[config] proxy invalid in {}: {}",
                path.display(),
                e
            );
            None
        }
    }
}

fn load_and_resolve_proxy() -> Option<ResolvedProxy> {
    let paths = user_proxy_config_paths();
    if paths.is_empty() {
        log::debug!("[config] no home directory, proxy disabled");
        return None;
    }

    for path in paths {
        let contents = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Some(resolved) = resolve_proxy_from_config_contents(&contents, &path) {
            return Some(resolved);
        }
    }

    log::debug!("[config] no enabled proxy in user config files");
    None
}

pub fn redact_proxy_url(url: &str) -> String {
    if let Some(at_pos) = url.find('@') {
        if let Some(scheme_end) = url.find("://") {
            let userinfo_start = scheme_end + 3;
            format!("{}***@{}", &url[..userinfo_start], &url[at_pos + 1..])
        } else {
            format!("***@{}", &url[at_pos + 1..])
        }
    } else {
        url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_proxy_url_with_credentials() {
        let url = "http://user:pass@127.0.0.1:10808";
        let redacted = redact_proxy_url(url);
        assert_eq!(redacted, "http://***@127.0.0.1:10808");
        assert!(!redacted.contains("user"));
        assert!(!redacted.contains("pass"));
    }

    #[test]
    fn redact_proxy_url_without_credentials() {
        let url = "http://127.0.0.1:10808";
        assert_eq!(redact_proxy_url(url), url);
    }
}
