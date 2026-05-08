import type { PluginMeta } from "@/lib/plugin-types"
import type { DisplayMode } from "@/lib/settings"
import { DEFAULT_DISPLAY_MODE } from "@/lib/settings"
import type { TrayPrimaryBar, TrayPrimaryBarItem } from "@/lib/tray-primary-progress"

const TRAY_APP_LABEL = "CrossUsage"

function formatUsdTrayAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "—"
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Formats a fraction (0.0 - 1.0) into a percentage string (0% - 100%).
 */
export function formatTrayPercentText(fraction: number | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "--%"
  const clampedFraction = Math.max(0, Math.min(1, fraction))
  return `${Math.round(clampedFraction * 100)}%`
}

/** One tray bar item: dollars (Credits, team Total usage, …) or percent. */
export function formatTrayItemCaption(
  item: TrayPrimaryBarItem,
  displayMode: DisplayMode = DEFAULT_DISPLAY_MODE
): string {
  if (
    item.valueKind === "dollars" &&
    typeof item.used === "number" &&
    Number.isFinite(item.used) &&
    typeof item.limit === "number" &&
    Number.isFinite(item.limit)
  ) {
    if (displayMode === "used") {
      return `${formatUsdTrayAmount(item.used)} / ${formatUsdTrayAmount(item.limit)}`
    }
    const left = Math.max(0, item.limit - item.used)
    return `${formatUsdTrayAmount(left)} left`
  }
  return formatTrayPercentText(item.fraction)
}

/**
 * Multi-line native tray tooltip: app name, then enabled providers and usage percentages.
 */
export function formatTrayTooltip(
  bars: TrayPrimaryBar[],
  pluginsMeta: PluginMeta[],
  displayMode: DisplayMode = DEFAULT_DISPLAY_MODE
): string {
  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const contentLines: string[] = []

  for (const bar of bars) {
    const meta = metaById.get(bar.id)
    if (!meta || bar.items.length === 0) continue

    if (bar.items.length === 1) {
      const caption = formatTrayItemCaption(bar.items[0]!, displayMode)
      contentLines.push(`${meta.name}: ${caption}`)
    } else {
      for (const item of bar.items) {
        const caption = formatTrayItemCaption(item, displayMode)
        contentLines.push(`${meta.name} · ${item.label}: ${caption}`)
      }
    }
  }

  if (contentLines.length === 0) return TRAY_APP_LABEL
  return [TRAY_APP_LABEL, ...contentLines].join("\n")
}
