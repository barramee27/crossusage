import { ProviderCard } from "@/components/provider-card"
import type { PluginDisplayState } from "@/lib/plugin-types"
import type { DisplayMode, ResetTimerDisplayMode } from "@/lib/settings"
import { useAppPluginStore } from "@/stores/app-plugin-store"

interface OverviewPageProps {
  plugins: PluginDisplayState[]
  onRetryPlugin?: (pluginId: string) => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  onResetTimerDisplayModeToggle?: () => void
}

export function OverviewPage({
  plugins,
  onRetryPlugin,
  displayMode,
  resetTimerDisplayMode,
  onResetTimerDisplayModeToggle,
}: OverviewPageProps) {
  const pluginSettings = useAppPluginStore((state) => state.pluginSettings)

  if (plugins.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No providers enabled
      </div>
    )
  }

  return (
    <div>
      {plugins.map((plugin, index) => {
        const rawLines = pluginSettings?.trayLines?.[plugin.meta.id]
        const allowedLabels =
          rawLines == null || rawLines.length === 0
            ? null
            : rawLines[0] === "__NONE__"
              ? []
              : rawLines

        return (
          <ProviderCard
            key={plugin.meta.id}
            name={plugin.meta.name}
            plan={plugin.data?.plan}
            showSeparator={index < plugins.length - 1}
            loading={plugin.loading}
            error={plugin.error}
            lines={plugin.data?.lines ?? []}
            skeletonLines={plugin.meta.lines}
            lastManualRefreshAt={plugin.lastManualRefreshAt}
            lastUpdatedAt={plugin.lastUpdatedAt ?? null}
            onRetry={onRetryPlugin ? () => onRetryPlugin(plugin.meta.id) : undefined}
            scopeFilter="overview"
            allowedLabels={allowedLabels}
            displayMode={displayMode}
            resetTimerDisplayMode={resetTimerDisplayMode}
            onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
          />
        )
      })}
    </div>
  )
}
