import { useCallback, useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { HistoryInsightsSummary } from "@/lib/usage-history-insights"

export function useHistoryInsights(persistEnabled: boolean) {
  const [summary, setSummary] = useState<HistoryInsightsSummary | null>(null)
  const debounceRef = useRef<number | null>(null)

  const reload = useCallback(async () => {
    if (!isTauri() || !persistEnabled) {
      setSummary(null)
      return
    }
    try {
      const data = await invoke<HistoryInsightsSummary>("get_usage_insights", { limit: 3 })
      setSummary(data)
    } catch (e) {
      console.error("get_usage_insights:", e)
      setSummary(null)
    }
  }, [persistEnabled])

  const scheduleReload = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void reload()
    }, 32_000)
  }, [reload])

  useEffect(() => {
    void reload()
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [reload])

  return { summary, reload, scheduleReload }
}
