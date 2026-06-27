import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { LiquidGlassFilter } from "@/components/liquid-glass-filter"
import { OnboardingWizard } from "@/components/onboarding-wizard"
import { PanelFooter } from "@/components/panel-footer"
import { CustomizeView } from "@/components/modern/customize-view"
import {
  WidgetGroupedList,
  buildProviderWidgetGroups,
} from "@/components/modern/widget-grouped-list"
import { UsageInsightsBanner } from "@/components/usage-insights-banner"
import { AppContent, type AppContentActionProps } from "@/components/app/app-content"
import { Button } from "@/components/ui/button"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list"
import { useAppVersion } from "@/hooks/app/use-app-version"
import { useTrayRestartBridge } from "@/hooks/app/use-tray-restart-bridge"
import { useWeeklyRollup } from "@/hooks/use-weekly-rollup"
import { useHistoryInsights } from "@/hooks/use-history-insights"
import { usePersistUsageHistory } from "@/hooks/use-persist-usage-history"
import { useNowTicker } from "@/hooks/use-now-ticker"
import type { UpdateStatus } from "@/hooks/use-app-update"
import { buildMetricDescriptors, findMetricLine } from "@/lib/metric-registry"
import { pinnedIdsFromTrayLines } from "@/lib/modern-layout"
import { resolveWidgetData } from "@/lib/widget-data"
import { buildUsageInsights } from "@/lib/usage-insights"
import { getProviderInstanceMeta } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppUiStore } from "@/stores/app-ui-store"
import { useModernLayoutStore } from "@/stores/modern-layout-store"
import type { UILayout } from "@/lib/settings"

type ModernScreen = "dashboard" | "customize" | "settings"

type ModernShellProps = {
  onRefreshAll: () => void
  displayPlugins: DisplayPluginState[]
  settingsPlugins: SettingsPluginState[]
  autoUpdateNextAt: number | null
  updateStatus: UpdateStatus
  onUpdateInstall: () => void
  onUpdateCheck: () => void
  appContentProps: AppContentActionProps
  showOnboardingWizard: boolean
  onOnboardingComplete: (layout: UILayout) => void
  onOnboardingSkip: () => void
  preferWeeklyLimit: boolean
}

export function ModernShell({
  onRefreshAll,
  displayPlugins,
  settingsPlugins,
  autoUpdateNextAt,
  updateStatus,
  onUpdateInstall,
  onUpdateCheck,
  appContentProps,
  showOnboardingWizard,
  onOnboardingComplete,
  onOnboardingSkip,
  preferWeeklyLimit,
}: ModernShellProps) {
  const [screen, setScreen] = useState<ModernScreen>("dashboard")
  const appVersion = useAppVersion()
  useTrayRestartBridge(updateStatus, onUpdateInstall)

  const { themeMode, displayMode, resetTimerDisplayMode, modernDensity } = useAppPreferencesStore(
    useShallow((s) => ({
      themeMode: s.themeMode,
      displayMode: s.displayMode,
      resetTimerDisplayMode: s.resetTimerDisplayMode,
      modernDensity: s.modernDensity,
    })),
  )

  const { showAbout, setShowAbout } = useAppUiStore(
    useShallow((s) => ({
      showAbout: s.showAbout,
      setShowAbout: s.setShowAbout,
    })),
  )

  const { pluginsMeta, pluginSettings } = useAppPluginStore(
    useShallow((s) => ({
      pluginsMeta: s.pluginsMeta,
      pluginSettings: s.pluginSettings,
    })),
  )

  const layout = useModernLayoutStore(
    useShallow((s) => ({
      placedMetricIds: s.placedMetricIds,
      providerOrder: s.providerOrder,
      metricOrderByProvider: s.metricOrderByProvider,
      pinnedMetricIds: s.pinnedMetricIds,
      hydrated: s.hydrated,
      ensureInitialized: s.ensureInitialized,
      setMetricEnabled: s.setMetricEnabled,
      setProviderMetricsEnabled: s.setProviderMetricsEnabled,
      setProviderOrder: s.setProviderOrder,
      setMetricOrder: s.setMetricOrder,
      syncDescriptors: s.syncDescriptors,
    })),
  )

  const compact = modernDensity === "compact"
  const nowMs = useNowTicker()
  const persistEnabled = usePersistUsageHistory()
  const { dailyRows, rollup, rollup30, scheduleReload: scheduleRollupReload } = useWeeklyRollup(persistEnabled)
  const { summary: historyInsights, scheduleReload: scheduleHistoryInsightsReload } =
    useHistoryInsights(persistEnabled)

  const probeStamp = displayPlugins.map((p) => p.lastUpdatedAt ?? 0).join(",")
  useEffect(() => {
    scheduleRollupReload()
    scheduleHistoryInsightsReload()
  }, [probeStamp, scheduleRollupReload, scheduleHistoryInsightsReload])

  const setActiveView = useAppUiStore((s) => s.setActiveView)

  useEffect(() => {
    if (!pluginSettings || !layout.hydrated) return
    const pluginStates = Object.fromEntries(
      displayPlugins.map((p) => [p.meta.id, { data: p.data }]),
    )
    const descriptors = buildMetricDescriptors(pluginsMeta, pluginSettings, pluginStates)
    const state = useModernLayoutStore.getState()
    if (!state.initialized) {
      state.ensureInitialized(descriptors, pinnedIdsFromTrayLines(pluginSettings.trayLines))
      return
    }
    state.syncDescriptors(descriptors)
  }, [pluginSettings, pluginsMeta, layout.hydrated, displayPlugins])

  const pluginStatesForDescriptors = useMemo(
    () =>
      Object.fromEntries(displayPlugins.map((p) => [p.meta.id, { data: p.data }])),
    [displayPlugins],
  )

  const descriptors = useMemo(
    () => buildMetricDescriptors(pluginsMeta, pluginSettings, pluginStatesForDescriptors),
    [pluginsMeta, pluginSettings, pluginStatesForDescriptors],
  )

  const widgetDataById = useMemo(() => {
    const map = new Map<string, import("@/lib/widget-data").WidgetData>()
    if (!pluginSettings) return map
    for (const d of descriptors) {
      const state = displayPlugins.find((p) => p.meta.id === d.pluginId)
      const line = findMetricLine(state?.data?.lines, d.lineLabel)
      const data = resolveWidgetData({
        metricId: d.id,
        displayName: d.displayName,
        line,
        displayMode,
        resetTimerDisplayMode,
        nowMs,
      })
      if (data) map.set(d.id, data)
    }
    return map
  }, [descriptors, displayPlugins, displayMode, resetTimerDisplayMode, nowMs, pluginSettings])

  const groups = useMemo(
    () =>
      buildProviderWidgetGroups({
        placedMetricIds: layout.placedMetricIds,
        providerOrder: layout.providerOrder,
        metricOrderByProvider: layout.metricOrderByProvider,
        widgetDataById,
        getMeta: (id) => getProviderInstanceMeta(id, pluginSettings, pluginsMeta) ?? undefined,
      }),
    [
      layout.placedMetricIds,
      layout.providerOrder,
      layout.metricOrderByProvider,
      widgetDataById,
      pluginSettings,
      pluginsMeta,
    ],
  )

  const insights = useMemo(
    () =>
      buildUsageInsights({
        plugins: displayPlugins,
        pluginSettings,
        preferWeeklyLimit,
        nowMs,
      }),
    [displayPlugins, pluginSettings, preferWeeklyLimit, nowMs],
  )

  return (
    <div
      className="app-popover-shell w-full bg-transparent"
      data-density={modernDensity}
    >
      <LiquidGlassFilter active={themeMode === "glass"} />
      <div className="app-panel-surface relative w-full overflow-hidden rounded-[18px] select-none flex flex-col min-h-[320px]">
        <nav
          className="flex gap-1 px-3 pt-2 pb-1 border-b border-border/50"
          aria-label="Modern navigation"
        >
          {(
            [
              ["dashboard", "Dashboard"],
              ["customize", "Customize"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={screen === id ? "default" : "ghost"}
              className="flex-1"
              onClick={() => {
                if (id === "settings") setActiveView("settings")
                else setActiveView("home")
                setScreen(id)
              }}
            >
              {label}
            </Button>
          ))}
        </nav>

        <div className="relative flex min-h-0 flex-1 flex-col px-3 pt-2 pb-1.5">
          {showOnboardingWizard ? (
            <OnboardingWizard
              onComplete={onOnboardingComplete}
              onSkip={onOnboardingSkip}
            />
          ) : null}

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto scrollbar-none",
              compact ? "text-sm" : "text-base",
            )}
          >
            {screen === "dashboard" ? (
              <div className="space-y-2 pb-2">
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
                <WidgetGroupedList groups={groups} compact={compact} />
              </div>
            ) : null}

            {screen === "customize" ? (
              <CustomizeView
                descriptors={descriptors}
                providerOrder={layout.providerOrder}
                metricOrderByProvider={layout.metricOrderByProvider}
                placedMetricIds={layout.placedMetricIds}
                onTogglePlaced={layout.setMetricEnabled}
                onSetProviderMetricsEnabled={layout.setProviderMetricsEnabled}
                onProviderReorder={layout.setProviderOrder}
                onMetricReorder={layout.setMetricOrder}
                compact={compact}
              />
            ) : null}

            {screen === "settings" ? (
              <AppContent
                {...appContentProps}
                displayPlugins={displayPlugins}
                settingsPlugins={settingsPlugins}
                selectedPlugin={null}
                viewOverride="settings"
              />
            ) : null}
          </div>

          <PanelFooter
            version={appVersion}
            autoUpdateNextAt={autoUpdateNextAt}
            updateStatus={updateStatus}
            onUpdateInstall={onUpdateInstall}
            onUpdateCheck={onUpdateCheck}
            onRefreshAll={onRefreshAll}
            showAbout={showAbout}
            onShowAbout={() => setShowAbout(true)}
            onCloseAbout={() => setShowAbout(false)}
          />
        </div>
      </div>
    </div>
  )
}
