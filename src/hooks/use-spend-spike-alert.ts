import { useCallback, useRef } from "react"
import { sendNotificationAsync } from "@/lib/notification"
import type { WeeklyRollupResult } from "@/lib/weekly-rollup"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

export function useSpendSpikeAlert() {
  const { usageSpikeAlertEnabled, usageSpikeAlertThresholdPct, usageAlertSound } =
    useAppPreferencesStore()
  const notifiedRef = useRef<Record<string, boolean>>({})

  const checkSpendSpike = useCallback(
    (rollup: WeeklyRollupResult | null) => {
      if (!usageSpikeAlertEnabled || !rollup) return
      if (rollup.windowDays !== 7) return

      const pct = rollup.costDeltaPct
      const cost = rollup.current.costUsd
      if (pct == null || pct < usageSpikeAlertThresholdPct) return
      if (cost < 1) return

      const dedupKey = `spike:${rollup.priorWindow.endDay}`
      if (notifiedRef.current[dedupKey]) return
      notifiedRef.current[dedupKey] = true

      void sendNotificationAsync({
        title: "Usage Alert",
        body: `Estimated 7-day spend ~$${cost.toFixed(2)} is up ${pct}% vs the prior 7 days (local logs).`,
        sound: usageAlertSound,
      }).catch((error) => {
        console.error("Failed to send spend spike alert:", error)
      })
    },
    [usageAlertSound, usageSpikeAlertEnabled, usageSpikeAlertThresholdPct],
  )

  return { checkSpendSpike }
}
