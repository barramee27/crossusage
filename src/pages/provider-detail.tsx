import { CursorUsageStatsPanel } from "@/components/cursor-usage-stats-panel"
import { ProviderCard } from "@/components/provider-card"
import type { PluginDisplayState } from "@/lib/plugin-types"
import { getBaseProviderId, type DisplayMode, type PluginSettings, type ResetTimerDisplayMode, type TimeFormatMode } from "@/lib/settings"
import { useAppPluginStore } from "@/stores/app-plugin-store"

interface ProviderDetailPageProps {
  plugin: PluginDisplayState | null
  onRetry?: () => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  onResetTimerDisplayModeToggle?: () => void
  showAccountIdentity?: boolean
}

export function ProviderDetailPage({
  plugin,
  onRetry,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  onResetTimerDisplayModeToggle,
  showAccountIdentity,
}: ProviderDetailPageProps) {
  const pluginSettings = useAppPluginStore(state => state.pluginSettings)

  if (!plugin) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Provider not found
      </div>
    )
  }

  const rawLines = pluginSettings?.trayLines?.[plugin.meta.id]
  const allowedLabels = (rawLines == null || rawLines.length === 0) ? null
    : rawLines[0] === '__NONE__' ? []
    : rawLines

  const baseProviderId = getBaseProviderId(
    plugin.meta.id,
    pluginSettings as PluginSettings | null,
  )
  const isCursorFamily = baseProviderId === "cursor" || baseProviderId === "cursor-nightly"

  return (
    <div>
      <ProviderCard
        name={plugin.meta.name}
        plan={plugin.data?.plan}
        links={plugin.meta.links}
        showSeparator={false}
        loading={plugin.loading}
        error={plugin.error}
        warning={plugin.data?.warning}
        lines={plugin.data?.lines ?? []}
        skeletonLines={plugin.meta.lines}
        lastManualRefreshAt={plugin.lastManualRefreshAt}
        lastUpdatedAt={plugin.lastUpdatedAt}
        onRetry={onRetry}
        pluginId={plugin.meta.id}
        scopeFilter="all"
        displayMode={displayMode}
        resetTimerDisplayMode={resetTimerDisplayMode}
        onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
        timeFormatMode={timeFormatMode}
        allowedLabels={allowedLabels}
        showAccountIdentity={showAccountIdentity}
      />
      {isCursorFamily ? <CursorUsageStatsPanel pluginId={baseProviderId} /> : null}
    </div>
  )
}
