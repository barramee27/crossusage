//! OS / distro / kernel for UI and support bundles (best-effort, no shell injection).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsDiagnostics {
    pub family: String,
    pub arch: String,
    pub distro: Option<String>,
    pub kernel: Option<String>,
}

fn unquote_os_release_value(raw: &str) -> String {
    let t = raw.trim();
    if (t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')) {
        t[1..t.len().saturating_sub(1)].to_string()
    } else {
        t.to_string()
    }
}

fn linux_distro_pretty() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let content = std::fs::read_to_string("/etc/os-release").ok()?;
        let mut pretty: Option<String> = None;
        let mut name: Option<String> = None;
        let mut version_id: Option<String> = None;
        for line in content.lines() {
            if let Some(v) = line.strip_prefix("PRETTY_NAME=") {
                let u = unquote_os_release_value(v);
                if !u.is_empty() {
                    pretty = Some(u);
                    break;
                }
            }
            if let Some(v) = line.strip_prefix("NAME=") {
                let u = unquote_os_release_value(v);
                if !u.is_empty() && u != "Linux" {
                    name = Some(u);
                }
            }
            if let Some(v) = line.strip_prefix("VERSION_ID=") {
                let u = unquote_os_release_value(v);
                if !u.is_empty() {
                    version_id = Some(u);
                }
            }
        }
        if let Some(p) = pretty {
            return Some(p);
        }
        match (name, version_id) {
            (Some(n), Some(v)) => Some(format!("{n} {v}")),
            (Some(n), None) => Some(n),
            _ => None,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn kernel_release() -> Option<String> {
    #[cfg(unix)]
    {
        let out = std::process::Command::new("uname").arg("-r").output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
    #[cfg(not(unix))]
    None
}

pub fn collect() -> OsDiagnostics {
    OsDiagnostics {
        family: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        distro: linux_distro_pretty(),
        kernel: kernel_release(),
    }
}

/// One line for startup logs (distro + kernel on Linux).
pub fn log_summary_one_line() -> String {
    let d = collect();
    if d.family == "linux" {
        let mut parts: Vec<String> = Vec::new();
        if let Some(dist) = &d.distro {
            parts.push(dist.clone());
        }
        if let Some(k) = &d.kernel {
            parts.push(format!("kernel {k}"));
        }
        parts.push(d.arch.clone());
        return parts.join(" · ");
    }
    let mut parts = vec![d.family.clone()];
    if let Some(k) = &d.kernel {
        parts.push(format!("kernel {k}"));
    }
    parts.push(d.arch);
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::unquote_os_release_value;

    #[test]
    fn unquote_strips_double_quotes() {
        assert_eq!(unquote_os_release_value("\"Ubuntu 24.04 LTS\""), "Ubuntu 24.04 LTS");
    }
}
