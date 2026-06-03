import { useCallback, useRef } from "react"
import { useProbeEvents } from "@/hooks/use-probe-events"
import type { PluginOutput } from "@/lib/plugin-types"
import {
  getProbeTargets,
  type AutoUpdateIntervalMinutes,
  type PluginSettings,
} from "@/lib/settings"
import { useProbeAutoUpdate } from "@/hooks/app/use-probe-auto-update"
import { useProbeRefreshActions } from "@/hooks/app/use-probe-refresh-actions"
import { useProbeState } from "@/hooks/app/use-probe-state"

type UseProbeArgs = {
  pluginSettings: PluginSettings | null
  autoUpdateInterval: AutoUpdateIntervalMinutes
  onProbeResult?: (output: PluginOutput) => void
}

export function useProbe({
  pluginSettings,
  autoUpdateInterval,
  onProbeResult,
}: UseProbeArgs) {
  const pluginSettingsRef = useRef(pluginSettings)
  pluginSettingsRef.current = pluginSettings

  const {
    pluginStates,
    pluginStatesRef,
    manualRefreshIdsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    finalizeStaleProbeLoading,
    handleProbeResult,
  } = useProbeState({ onProbeResult })

  const handleBatchComplete = useCallback(
    (pluginIds: string[]) => {
      finalizeStaleProbeLoading(pluginIds)
    },
    [finalizeStaleProbeLoading]
  )
  const resolveProbeTargets = useCallback(
    (pluginIds?: string[]) => getProbeTargets(pluginIds, pluginSettingsRef.current),
    []
  )

  const { startBatch } = useProbeEvents({
    onResult: handleProbeResult,
    onBatchComplete: handleBatchComplete,
    getProbeTargets: resolveProbeTargets,
  })

  const isPluginLoading = useCallback(
    (id: string) => Boolean(pluginStatesRef.current[id]?.loading),
    [pluginStatesRef]
  )

  const {
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    resetAutoUpdateSchedule,
  } = useProbeAutoUpdate({
    pluginSettings,
    autoUpdateInterval,
    setLoadingForPlugins,
    setErrorForPlugins,
    isPluginLoading,
    startBatch,
  })

  const { handleRetryPlugin, handleRefreshAll } = useProbeRefreshActions({
    pluginSettings,
    pluginStatesRef,
    manualRefreshIdsRef,
    resetAutoUpdateSchedule,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  })

  return {
    pluginStates,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    handleRetryPlugin,
    handleRefreshAll,
  }
}
