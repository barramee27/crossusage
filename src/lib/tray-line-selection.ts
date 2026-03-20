import type { PluginSettings } from "@/lib/settings"

/**
 * Effective tray line labels for Settings UI and toggles — matches the first branch of
 * getTrayPrimaryBars when trayLines[id] is undefined (default first primary).
 */
export function getEffectiveTrayLines(
  pluginId: string,
  pluginSettings: PluginSettings,
  primaryCandidates: string[]
): string[] {
  const raw = pluginSettings.trayLines?.[pluginId]
  if (raw === undefined) {
    return primaryCandidates.length > 0 ? [primaryCandidates[0]] : []
  }
  const real = raw.filter((l) => l !== "__NONE__")
  if (real.length > 0) {
    return real
  }
  return []
}
