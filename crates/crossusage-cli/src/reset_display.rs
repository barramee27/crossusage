//! Human-friendly "resets in …" strings instead of raw ISO timestamps where possible.

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};

fn parse_reset_to_local(s: &str) -> Option<DateTime<Local>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Local));
    }
    if let Ok(dt) = s.parse::<DateTime<Utc>>() {
        return Some(dt.with_timezone(&Local));
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(s, fmt) {
            if let Some(dt) = Local.from_local_datetime(&ndt).single() {
                return Some(dt);
            }
        }
    }
    if let Ok(nd) = NaiveDate::parse_from_str(s.split('T').next().unwrap_or(s), "%Y-%m-%d") {
        if let Some(dt) = nd.and_hms_opt(0, 0, 0).and_then(|t| Local.from_local_datetime(&t).single()) {
            return Some(dt);
        }
    }
    None
}

fn format_duration_until(target: DateTime<Local>) -> Option<String> {
    let now = Local::now();
    if target <= now {
        return None;
    }
    let d = target.signed_duration_since(now);
    let secs = d.num_seconds().max(0);
    if secs < 60 {
        return Some("resets in <1 min".into());
    }
    let mins = secs / 60;
    if mins < 60 {
        return Some(format!("resets in {mins} min"));
    }
    let hours = mins / 60;
    if hours < 48 {
        let hm = mins % 60;
        if hm == 0 {
            return Some(format!("resets in {hours}h"));
        }
        return Some(format!("resets in {hours}h {hm}m"));
    }
    let days = hours / 24;
    if days < 60 {
        return Some(format!("resets in {days}d"));
    }
    let weeks = days / 7;
    Some(format!("resets in {weeks}w"))
}

/// Replace raw timestamps in progress lines with relative text when we can parse them.
pub fn format_resets_at_for_display(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    if let Some(dt) = parse_reset_to_local(t) {
        if let Some(rel) = format_duration_until(dt) {
            return rel;
        }
        return format!("resets {}", dt.format("%Y-%m-%d %H:%M"));
    }
    format!("resets {t}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_future_rfc3339() {
        let future = (Local::now() + chrono::Duration::hours(5)).to_rfc3339();
        let s = format_resets_at_for_display(&future);
        assert!(s.contains("resets in"), "{s}");
        assert!(s.contains('h') || s.contains("min"), "{s}");
    }
}
