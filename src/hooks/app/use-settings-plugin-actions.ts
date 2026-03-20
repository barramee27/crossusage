import { useCallback } from "react"
import { track } from "@/lib/analytics"
import type { PluginMeta } from "@/lib/plugin-types"
import { getEffectiveTrayLines } from "@/lib/tray-line-selection"
import { savePluginSettings, type PluginSettings } from "@/lib/settings"

const TRAY_SETTINGS_DEBOUNCE_MS = 2000

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type UseSettingsPluginActionsArgs = {
  pluginSettings: PluginSettings | null
  pluginsMeta: PluginMeta[]
  setPluginSettings: (value: PluginSettings | null) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsPluginActions({
  pluginSettings,
  pluginsMeta,
  setPluginSettings,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
  scheduleTrayIconUpdate,
}: UseSettingsPluginActionsArgs) {
  const handleReorder = useCallback((orderedIds: string[]) => {
    if (!pluginSettings) return
    track("providers_reordered", { count: orderedIds.length })
    // orderedIds may be a subset (e.g. nav-only, excluding disabled plugins).
    // Re-insert any missing IDs from the previous order at their original
    // relative positions so disabled plugins are not dropped.
    const orderedSet = new Set(orderedIds)
    const missing = (pluginSettings.order ?? []).filter((id) => !orderedSet.has(id))
    const merged = [...orderedIds]
    for (const id of missing) {
      const prevIdx = (pluginSettings.order ?? []).indexOf(id)
      // Insert after the last merged entry whose original index < prevIdx
      let insertAt = 0 // default: prepend if id originally preceded all visible entries
      for (let i = merged.length - 1; i >= 0; i--) {
        const mergedPrevIdx = (pluginSettings.order ?? []).indexOf(merged[i])
        if (mergedPrevIdx < prevIdx) {
          insertAt = i + 1
          break
        }
      }
      merged.splice(insertAt, 0, id)
    }
    const nextSettings: PluginSettings = {
      ...pluginSettings,
      order: merged,
    }
    setPluginSettings(nextSettings)
    scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    void savePluginSettings(nextSettings).catch((error) => {
      console.error("Failed to save plugin order:", error)
    })
  }, [pluginSettings, scheduleTrayIconUpdate, setPluginSettings])

  const handleToggle = useCallback((id: string) => {
    if (!pluginSettings) return
    const wasDisabled = pluginSettings.disabled.includes(id)
    track("provider_toggled", { provider_id: id, enabled: wasDisabled ? "true" : "false" })
    const disabled = new Set(pluginSettings.disabled)

    if (wasDisabled) {
      disabled.delete(id)
      setLoadingForPlugins([id])
      startBatch([id]).catch((error) => {
        console.error("Failed to start probe for enabled plugin:", error)
        setErrorForPlugins([id], "Failed to start probe")
      })
    } else {
      disabled.add(id)
    }

    const nextSettings: PluginSettings = {
      ...pluginSettings,
      disabled: Array.from(disabled),
    }
    setPluginSettings(nextSettings)
    scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    void savePluginSettings(nextSettings).catch((error) => {
      console.error("Failed to save plugin toggle:", error)
    })
  }, [
    pluginSettings,
    scheduleTrayIconUpdate,
    setErrorForPlugins,
    setLoadingForPlugins,
    setPluginSettings,
    startBatch,
  ])

  const handleTrayLineToggle = useCallback((id: string, lineLabel: string, checked: boolean) => {
    if (!pluginSettings) return
    const prevTrayLines = pluginSettings.trayLines || {}
    const primaryCandidates =
      pluginsMeta.find((p) => p.id === id)?.primaryCandidates ?? []
    // Baseline matches Settings UI + tray default when trayLines[id] is undefined.
    const currentLinesForPlugin = getEffectiveTrayLines(
      id,
      pluginSettings,
      primaryCandidates
    )

    let nextLinesForPlugin: string[]
    if (checked) {
      if (!currentLinesForPlugin.includes(lineLabel)) {
        nextLinesForPlugin = [...currentLinesForPlugin, lineLabel]
      } else {
        nextLinesForPlugin = currentLinesForPlugin
      }
    } else {
      nextLinesForPlugin = currentLinesForPlugin.filter(l => l !== lineLabel)
    }

    // Use sentinel ['__NONE__'] when empty to prevent store from stripping empty arrays
    const nextTrayLines = {
      ...prevTrayLines,
      [id]: nextLinesForPlugin.length === 0 ? ['__NONE__'] : nextLinesForPlugin,
    }

    const nextSettings: PluginSettings = {
      ...pluginSettings,
      trayLines: nextTrayLines,
    }
    
    setPluginSettings(nextSettings)
    scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    void savePluginSettings(nextSettings).catch((error) => {
      console.error("Failed to save tray line toggle:", error)
    })
  }, [
    pluginSettings,
    pluginsMeta,
    scheduleTrayIconUpdate,
    setPluginSettings,
  ])

  return {
    handleReorder,
    handleToggle,
    handleTrayLineToggle,
  }
}
