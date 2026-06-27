import { parseMetricId } from "@/lib/metric-id"
import { isProgressLine } from "@/lib/primary-progress-line"
import type { MetricLine, PluginMeta } from "@/lib/plugin-types"
import type { DisplayMode } from "@/lib/settings"
import { getProviderInstanceMeta, type PluginSettings } from "@/lib/settings"
import type { TrayPrimaryBar, TrayPrimaryBarItem } from "@/lib/tray-primary-progress"
import { clamp01 } from "@/lib/utils"

type PluginState = {
  data: { lines?: MetricLine[] } | null
  loading: boolean
  error: string | null
}

function lineToTrayItem(
  line: MetricLine,
  label: string,
  displayMode: DisplayMode,
): TrayPrimaryBarItem | null {
  if (isProgressLine(line)) {
    let fraction: number | undefined
    if (line.limit > 0) {
      const shownAmount = displayMode === "used" ? line.used : line.limit - line.used
      fraction = clamp01(shownAmount / line.limit)
    }
    if (line.format?.kind === "dollars") {
      return {
        label,
        fraction,
        valueKind: "dollars",
        used: line.used,
        limit: line.limit,
      }
    }
    return { label, fraction }
  }
  if (line.type === "text") {
    return { label, fraction: undefined }
  }
  if (line.type === "badge") {
    return { label, fraction: undefined }
  }
  return null
}

/** Build tray bars from Modern layout pinned metrics (max 2 per provider enforced upstream of this). */
export function buildMenuBarContent(args: {
  pinnedMetricIds: string[]
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings
  pluginStates: Record<string, PluginState | undefined>
  displayMode: DisplayMode
}): TrayPrimaryBar[] {
  const { pinnedMetricIds, pluginsMeta, pluginSettings, pluginStates, displayMode } = args
  const disabled = new Set(pluginSettings.disabled)
  const bars: TrayPrimaryBar[] = []
  const barByProvider = new Map<string, TrayPrimaryBar>()

  for (const metricIdValue of pinnedMetricIds) {
    const parsed = parseMetricId(metricIdValue)
    if (!parsed) continue
    const { pluginId, lineLabel } = parsed
    if (disabled.has(pluginId)) continue

    const state = pluginStates[pluginId]
    const line = state?.data?.lines?.find((l) => l.label === lineLabel)
    if (!line) continue

    let bar = barByProvider.get(pluginId)
    if (!bar) {
      const meta = getProviderInstanceMeta(pluginId, pluginSettings, pluginsMeta)
      bar = { id: pluginId, color: meta?.brandColor, items: [] }
      barByProvider.set(pluginId, bar)
      bars.push(bar)
    }

    const item = lineToTrayItem(line, lineLabel, displayMode)
    if (item) bar.items.push(item)
  }

  return bars.filter((b) => b.items.length > 0)
}
