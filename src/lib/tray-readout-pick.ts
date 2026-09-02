import type { ManifestLine } from "@/lib/plugin-types"
import type { MenubarIconStyle } from "@/lib/settings"

export const TRAY_STYLES_NEED_READOUT_PICK: ReadonlySet<MenubarIconStyle> = new Set([
  "provider",
  "donut",
  "logoBar",
  "logoGrid",
])

export type TrayReadoutPlugin = {
  id: string
  name: string
  enabled: boolean
  trayReadoutLabels: string[]
  trayLines: string[]
}

/** Progress lines from plugin.json, in file order. Text / badge / charts are not tray meters. */
export function trayReadoutLabelsFromManifest(lines: ManifestLine[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    if (line.type !== "progress") continue
    if (seen.has(line.label)) continue
    seen.add(line.label)
    out.push(line.label)
  }
  return out
}

export function enabledTrayReadoutPlugins<T extends TrayReadoutPlugin>(plugins: T[]): T[] {
  return plugins.filter((p) => p.enabled && p.trayReadoutLabels.length > 0)
}

/** Open the picker when more than one plugin can drive the icon, or one plugin has several meters. */
export function shouldOpenTrayReadoutDialog(
  style: MenubarIconStyle,
  plugins: TrayReadoutPlugin[],
): boolean {
  if (!TRAY_STYLES_NEED_READOUT_PICK.has(style)) return false
  const enabled = enabledTrayReadoutPlugins(plugins)
  if (enabled.length === 0) return false
  if (enabled.length > 1) return true
  return enabled[0].trayReadoutLabels.length > 1
}

export function defaultTrayReadoutPluginId(
  plugins: TrayReadoutPlugin[],
  preferredId?: string | null,
): string | null {
  const enabled = enabledTrayReadoutPlugins(plugins)
  if (preferredId && enabled.some((p) => p.id === preferredId)) return preferredId
  return enabled[0]?.id ?? null
}

export function defaultTrayReadoutLine(plugin: TrayReadoutPlugin | undefined): string {
  if (!plugin) return ""
  const labels = plugin.trayReadoutLabels
  const current = plugin.trayLines[0]
  if (current && labels.includes(current)) return current
  return labels[0] ?? ""
}
