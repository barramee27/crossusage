import { trackEvent } from "@aptabase/tauri"
import { isTauri } from "@tauri-apps/api/core"

/**
 * Aptabase analytics (string/number props only). Requires `aptabase:allow-track-event` in Tauri capabilities.
 */
export function track(
  event: string,
  props?: Record<string, string | number>,
) {
  if (!isTauri()) {
    return
  }

  void trackEvent(event, props)
}
