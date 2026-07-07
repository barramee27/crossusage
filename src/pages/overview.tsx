import { useEffect, useMemo } from "react"
import { ProviderCard } from "@/components/provider-card"
import { UsageInsightsBanner } from "@/components/usage-insights-banner"
import { useSpendSpikeAlert } from "@/hooks/use-spend-spike-alert"
import { useWeeklyRollup } from "@/hooks/use-weekly-rollup"
import { useHistoryInsights } from "@/hooks/use-history-insights"
import { usePersistUsageHistory } from "@/hooks/use-persist-usage-history"
import { useNowTicker } from "@/hooks/use-now-ticker"
import { useAppUiStore } from "@/stores/app-ui-store"
import type { PluginDisplayState } from "@/lib/plugin-types"
import { buildUsageInsights } from "@/lib/usage-insights"
import type { DisplayMode, PluginSettings, ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"

interface OverviewPageProps {
  plugins: PluginDisplayState[]
  pluginSettings: PluginSettings | null
  preferWeeklyLimit?: boolean
  onProbeComplete?: () => void
  onRetryPlugin?: (pluginId: string) => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  onResetTimerDisplayModeToggle?: () => void
  showAccountIdentity?: boolean
}

export function OverviewPage({
  plugins,
  pluginSettings,
  preferWeeklyLimit = false,
  onProbeComplete,
  onRetryPlugin,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  onResetTimerDisplayModeToggle,
  showAccountIdentity,
}: OverviewPageProps) {
  const nowMs = useNowTicker()
  const persistEnabled = usePersistUsageHistory()
  const { dailyRows, rollup, rollup30, scheduleReload } = useWeeklyRollup(persistEnabled)
  const { summary: historyInsights, scheduleReload: scheduleHistoryInsightsReload } =
    useHistoryInsights(persistEnabled)
  const { checkSpendSpike } = useSpendSpikeAlert()
  const setActiveView = useAppUiStore((state) => state.setActiveView)

  const probeStamp = plugins.map((p) => p.lastUpdatedAt ?? 0).join(",")
  useEffect(() => {
    onProbeComplete?.()
    scheduleReload()
    scheduleHistoryInsightsReload()
  }, [probeStamp, onProbeComplete, scheduleReload, scheduleHistoryInsightsReload])

  useEffect(() => {
    checkSpendSpike(rollup)
  }, [rollup, checkSpendSpike])

  const insights = useMemo(
    () =>
      buildUsageInsights({
        plugins,
        pluginSettings,
        preferWeeklyLimit,
        nowMs,
      }),
    [plugins, pluginSettings, preferWeeklyLimit, nowMs],
  )

  if (plugins.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No providers enabled
      </div>
    )
  }

  return (
    <div>
      <UsageInsightsBanner
        insights={insights}
        historyTightest={historyInsights?.tightest}
        rollup={rollup}
        rollup30={rollup30}
        dailyRows={dailyRows}
        persistEnabled={persistEnabled}
        nowMs={nowMs}
        onSelectProvider={setActiveView}
      />
      {plugins.map((plugin, index) => (
        <ProviderCard
          key={plugin.meta.id}
          name={plugin.meta.name}
          plan={plugin.data?.plan}
          showSeparator={index < plugins.length - 1}
          loading={plugin.loading}
          error={plugin.error}
          warning={plugin.data?.warning}
          lines={plugin.data?.lines ?? []}
          skeletonLines={plugin.meta.lines}
          lastManualRefreshAt={plugin.lastManualRefreshAt}
          lastUpdatedAt={plugin.lastUpdatedAt}
          onRetry={onRetryPlugin ? () => onRetryPlugin(plugin.meta.id) : undefined}
          scopeFilter="overview"
          displayMode={displayMode}
          resetTimerDisplayMode={resetTimerDisplayMode}
          onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
          timeFormatMode={timeFormatMode}
          showAccountIdentity={showAccountIdentity}
        />
      ))}
    </div>
  )
}
