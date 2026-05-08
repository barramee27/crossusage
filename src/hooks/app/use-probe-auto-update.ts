import { useCallback, useEffect, useRef, useState } from "react"
import {
  getEnabledPluginIds,
  type AutoUpdateIntervalMinutes,
  type PluginSettings,
} from "@/lib/settings"

type UseProbeAutoUpdateArgs = {
  pluginSettings: PluginSettings | null
  autoUpdateInterval: AutoUpdateIntervalMinutes
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

export function useProbeAutoUpdate({
  pluginSettings,
  autoUpdateInterval,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
}: UseProbeAutoUpdateArgs) {
  const [autoUpdateNextAt, setAutoUpdateNextAt] = useState<number | null>(null)
  const [autoUpdateResetToken, setAutoUpdateResetToken] = useState(0)
  const pluginSettingsRef = useRef(pluginSettings)
  pluginSettingsRef.current = pluginSettings

  /** Tray line / unrelated settings changes must not reset the interval (was re-probing constantly). */
  const autoProbeScheduleKey = pluginSettings
    ? `${autoUpdateInterval}|${getEnabledPluginIds(pluginSettings).join("\u0001")}`
    : ""

  useEffect(() => {
    const current = pluginSettingsRef.current
    if (!current) {
      setAutoUpdateNextAt(null)
      return
    }

    const enabledIds = getEnabledPluginIds(current)
    if (enabledIds.length === 0) {
      setAutoUpdateNextAt(null)
      return
    }

    const intervalMs = autoUpdateInterval * 60_000
    const scheduleNext = () => setAutoUpdateNextAt(Date.now() + intervalMs)
    scheduleNext()

    const interval = setInterval(() => {
      const latest = pluginSettingsRef.current
      if (!latest) return
      const ids = getEnabledPluginIds(latest)
      if (ids.length === 0) return
      setLoadingForPlugins(ids)
      startBatch(ids).catch((error) => {
        console.error("Failed to start auto-update batch:", error)
        setErrorForPlugins(ids, "Failed to start probe")
      })
      scheduleNext()
    }, intervalMs)

    return () => clearInterval(interval)
  }, [
    autoProbeScheduleKey,
    autoUpdateResetToken,
    autoUpdateInterval,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  ])

  const resetAutoUpdateSchedule = useCallback(() => {
    if (!pluginSettings) return
    const enabledIds = getEnabledPluginIds(pluginSettings)
    /* v8 ignore start */
    if (enabledIds.length === 0) {
      setAutoUpdateNextAt(null)
      return
    }
    /* v8 ignore stop */

    setAutoUpdateNextAt(Date.now() + autoUpdateInterval * 60_000)
    setAutoUpdateResetToken((value) => value + 1)
  }, [autoUpdateInterval, pluginSettings])

  return {
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    resetAutoUpdateSchedule,
  }
}
