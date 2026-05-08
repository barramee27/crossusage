/**
 * UI-side Aptabase custom events were removed (OpenUsage v0.6.23 parity).
 * Rust still may emit lifecycle events (e.g. `app_started`); the frontend does not call Aptabase.
 */
export function track(
  _event: string,
  _props?: Record<string, string | number>,
): void {}
