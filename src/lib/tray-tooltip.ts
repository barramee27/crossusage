import type { PluginMeta } from "@/lib/plugin-types"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"

const TRAY_APP_LABEL = "CrossUsage"

/**
 * Formats a fraction (0.0 - 1.0) into a percentage string (0% - 100%).
 */
export function formatTrayPercentText(fraction: number | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "--%"
  const clampedFraction = Math.max(0, Math.min(1, fraction))
  return `${Math.round(clampedFraction * 100)}%`
}

/**
 * Multi-line native tray tooltip: app name, then enabled providers and usage percentages.
 */
export function formatTrayTooltip(bars: TrayPrimaryBar[], pluginsMeta: PluginMeta[]): string {
  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const contentLines: string[] = []

  for (const bar of bars) {
    const meta = metaById.get(bar.id)
    if (!meta || bar.items.length === 0) continue

    if (bar.items.length === 1) {
      const percent = formatTrayPercentText(bar.items[0]!.fraction)
      contentLines.push(`${meta.name}: ${percent}`)
    } else {
      for (const item of bar.items) {
        const percent = formatTrayPercentText(item.fraction)
        contentLines.push(`${meta.name} · ${item.label}: ${percent}`)
      }
    }
  }

  if (contentLines.length === 0) return TRAY_APP_LABEL
  return [TRAY_APP_LABEL, ...contentLines].join("\n")
}
