import { useMemo } from "react"
import type { PluginMeta } from "@/lib/plugin-types"
import { getProviderInstanceMeta, type PluginSettings } from "@/lib/settings"
import { getEffectiveTrayLines } from "@/lib/tray-line-selection"
import { trayReadoutLabelsFromManifest } from "@/lib/tray-readout-pick"

export type SettingsPluginState = {
  id: string
  baseProviderId: string
  instanceLabel?: string
  name: string
  enabled: boolean
  primaryCandidates: string[]
  trayReadoutLabels: string[]
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
        const trayReadoutLabels = trayReadoutLabelsFromManifest(meta.lines ?? [])
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
          trayReadoutLabels,
          trayLines,
        }]
      })
  }, [pluginSettings, pluginsMeta])
}
