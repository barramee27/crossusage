import { useCallback, useRef } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import type { PluginOutput } from "@/lib/plugin-types"
import { calculatePaceStatus } from "@/lib/pace-status"
import { sendNotificationAsync } from "@/lib/notification"
import { resolvePrimaryProgressLine } from "@/lib/primary-progress-line"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

export function useUsageAlert() {
  const {
    usageAlertEnabled,
    usageAlertThreshold,
    customUsageAlertThreshold,
    usageAlertSound,
    usagePaceAlertEnabled,
    preferMenubarWeeklyLimit,
  } = useAppPreferencesStore()

  const { pluginsMeta, pluginSettings } = useAppPluginStore()

  const lowRemainingNotifiedRef = useRef<Record<string, boolean>>({})
  const paceNotifiedRef = useRef<Record<string, boolean>>({})

  const sendAlert = useCallback(
    (providerId: string, _displayName: string, body: string) => {
      const meta = pluginsMeta.find((plugin) => plugin.id === providerId)
      const iconFilePath = meta?.iconFilePath

      void sendNotificationAsync({
        title: "Usage Alert",
        body,
        sound: usageAlertSound,
        ...(iconFilePath
          ? { attachments: [{ id: "icon", url: convertFileSrc(iconFilePath) }] }
          : {}),
      }).catch((error) => {
        console.error("Failed to send usage alert notification:", error)
      })
    },
    [pluginsMeta, usageAlertSound],
  )

  const checkUsageAlert = useCallback(
    (output: PluginOutput) => {
      if (!usageAlertEnabled) return
      if (!pluginSettings) return

      const instanceId = output.providerId
      const meta = pluginsMeta.find((p) => p.id === instanceId)
      if (!meta) return

      const primary = resolvePrimaryProgressLine({
        meta,
        data: output,
        pluginSettings,
        instanceId,
        preferWeeklyLimit: preferMenubarWeeklyLimit,
      })

      if (!primary) return
      if (!Number.isFinite(primary.used) || !Number.isFinite(primary.limit)) return
      if (primary.limit <= 0) return

      const displayName = output.displayName
      const lineLabel = primary.label

      if (primary.format?.kind === "percent") {
        const usedPercent = (primary.used / primary.limit) * 100
        const remaining = 100 - usedPercent
        const effectiveThreshold =
          usageAlertThreshold === "custom" ? customUsageAlertThreshold : usageAlertThreshold

        if (effectiveThreshold != null) {
          if (remaining > effectiveThreshold) {
            lowRemainingNotifiedRef.current[instanceId] = false
          } else if (!lowRemainingNotifiedRef.current[instanceId]) {
            lowRemainingNotifiedRef.current[instanceId] = true
            sendAlert(
              instanceId,
              displayName,
              `Less than ${effectiveThreshold}% remaining on ${displayName} (${lineLabel})`,
            )
          }
        }

        if (usagePaceAlertEnabled) {
          const resetsAtMs = primary.resetsAt ? Date.parse(primary.resetsAt) : NaN
          const periodDurationMs = primary.periodDurationMs
          const paceKey = `${instanceId}:${resetsAtMs}:pace`

          if (
            Number.isFinite(resetsAtMs) &&
            periodDurationMs != null &&
            periodDurationMs > 0
          ) {
            const nowMs = Date.now()
            const pace = calculatePaceStatus(
              primary.used,
              primary.limit,
              resetsAtMs,
              periodDurationMs,
              nowMs,
            )
            if (pace?.status !== "behind") {
              paceNotifiedRef.current[paceKey] = false
            } else if (!paceNotifiedRef.current[paceKey]) {
              paceNotifiedRef.current[paceKey] = true
              sendAlert(
                instanceId,
                displayName,
                `${displayName} (${lineLabel}) — projected to run out before reset`,
              )
            }
          }
        }
      }
    },
    [
      customUsageAlertThreshold,
      pluginSettings,
      pluginsMeta,
      preferMenubarWeeklyLimit,
      sendAlert,
      usageAlertEnabled,
      usageAlertThreshold,
      usagePaceAlertEnabled,
    ],
  )

  return { checkUsageAlert }
}
