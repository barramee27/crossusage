import { buildMenuBarContent } from "@/lib/menu-bar-content"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { DisplayMode, PluginSettings, UILayout } from "@/lib/settings"
import { getTrayPrimaryBars, type TrayPrimaryBar } from "@/lib/tray-primary-progress"

type PluginState = {
  data: PluginOutput | null
  loading: boolean
  error: string | null
}

/** Modern: pinned metrics first; fall back to classic tray lines when pins are empty or still loading. */
export function resolveTrayBarsForLayout(args: {
  uiLayout: UILayout
  pinnedMetricIds: string[]
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings
  pluginStates: Record<string, PluginState | undefined>
  displayMode: DisplayMode
  preferWeeklyLimit: boolean
  maxBars?: number
  pluginId?: string
}): TrayPrimaryBar[] {
  const {
    uiLayout,
    pinnedMetricIds,
    pluginsMeta,
    pluginSettings,
    pluginStates,
    displayMode,
    preferWeeklyLimit,
    maxBars = 4,
    pluginId,
  } = args

  if (uiLayout === "modern") {
    const pinBars = buildMenuBarContent({
      pinnedMetricIds,
      pluginsMeta,
      pluginSettings,
      pluginStates,
      displayMode,
    })
    const scoped = pluginId ? pinBars.filter((bar) => bar.id === pluginId) : pinBars
    if (scoped.length > 0) return scoped.slice(0, maxBars)
  }

  return getTrayPrimaryBars({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars,
    displayMode,
    pluginId,
    preferWeeklyLimit,
  })
}
