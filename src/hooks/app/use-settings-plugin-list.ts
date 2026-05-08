import { useMemo } from "react"
import type { PluginMeta } from "@/lib/plugin-types"
import { getProviderInstanceMeta, type PluginSettings } from "@/lib/settings"
import { getEffectiveTrayLines } from "@/lib/tray-line-selection"

export type SettingsPluginState = {
  id: string
  baseProviderId: string
  instanceLabel?: string
  name: string
  enabled: boolean
  primaryCandidates: string[]
  trayLines: string[]
}

type UseSettingsPluginListArgs = {
  pluginSettings: PluginSettings | null
  pluginsMeta: PluginMeta[]
}

export function useSettingsPluginList({ pluginSettings, pluginsMeta }: UseSettingsPluginListArgs) {
  return useMemo<SettingsPluginState[]>(() => {
    if (!pluginSettings) return []

    return pluginSettings.order
      .flatMap((id) => {
        const meta = getProviderInstanceMeta(id, pluginSettings, pluginsMeta)
        if (!meta) return []
        const primaryCandidates = meta.primaryCandidates || []
        const trayLines = getEffectiveTrayLines(
          id,
          pluginSettings,
          primaryCandidates
        )
        return [{
          id,
          baseProviderId: meta.baseProviderId ?? meta.id,
          instanceLabel: meta.instanceLabel,
          name: meta.name,
          enabled: !pluginSettings.disabled.includes(id),
          primaryCandidates,
          trayLines,
        }]
      })
  }, [pluginSettings, pluginsMeta])
}
