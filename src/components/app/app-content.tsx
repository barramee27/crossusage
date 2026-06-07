import { useShallow } from "zustand/react/shallow"
import { OverviewPage } from "@/pages/overview"
import { ProviderDetailPage } from "@/pages/provider-detail"
import { SettingsPage, type ProviderAccountCredentialInput } from "@/pages/settings"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list"
import type { TraySettingsPreview } from "@/hooks/app/use-tray-icon"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppUiStore } from "@/stores/app-ui-store"
import type {
  AutoUpdateIntervalMinutes,
  DisplayMode,
  GlobalShortcut,
  MenubarIconStyle,
  ResetTimerDisplayMode,
  ThemeMode,
  TimeFormatMode,
  UIScale,
  UsageAlertSound,
  UsageAlertThreshold,
} from "@/lib/settings"

type AppContentDerivedProps = {
  displayPlugins: DisplayPluginState[]
  settingsPlugins: SettingsPluginState[]
  selectedPlugin: DisplayPluginState | null
}

export type AppContentActionProps = {
  onRetryPlugin: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onToggle: (id: string) => void
  onTrayLineToggle: (id: string, lineLabel: string, checked: boolean) => void
  onAddProviderAccount: (baseProviderId: string, input: ProviderAccountCredentialInput) => void
  onUpdateProviderAccountCredentials: (id: string, input: ProviderAccountCredentialInput) => void
  onRenameProviderAccount: (id: string, label: string) => void
  onRemoveProviderAccount: (id: string) => void
  onAutoUpdateIntervalChange: (value: AutoUpdateIntervalMinutes) => void
  onThemeModeChange: (mode: ThemeMode) => void
  onDisplayModeChange: (mode: DisplayMode) => void
  onResetTimerDisplayModeChange: (mode: ResetTimerDisplayMode) => void
  onResetTimerDisplayModeToggle: () => void
  onTimeFormatModeChange: (mode: TimeFormatMode) => void
  onMenubarIconStyleChange: (value: MenubarIconStyle) => void
  onPreferMenubarWeeklyLimitChange: (value: boolean) => void
  traySettingsPreview: TraySettingsPreview
  onGlobalShortcutChange: (value: GlobalShortcut) => void
  onStartOnLoginChange: (value: boolean) => void
  onUsageAlertEnabledChange: (value: boolean) => void
  onUsageAlertThresholdChange: (value: UsageAlertThreshold) => void
  onUsageAlertCustomThresholdChange: (value: number | null) => void
  onUsageAlertSoundChange: (value: UsageAlertSound) => void
  onUsagePaceAlertEnabledChange: (value: boolean) => void
  onUsageSpikeAlertEnabledChange: (value: boolean) => void
  onUsageSpikeAlertThresholdPctChange: (value: import("@/lib/settings").UsageSpikeAlertThresholdPct) => void
  onUIScaleChange: (value: UIScale) => void
  onShowAccountIdentityChange: (value: boolean) => void
  onSetCursorTrayMetricForAllAccounts: (lineLabel: string) => void
  cursorRequestsLineAvailable: boolean | null
}

export type AppContentProps = AppContentDerivedProps & AppContentActionProps

export function AppContent({
  displayPlugins,
  settingsPlugins,
  selectedPlugin,
  onRetryPlugin,
  onReorder,
  onToggle,
  onTrayLineToggle,
  onAddProviderAccount,
  onUpdateProviderAccountCredentials,
  onRenameProviderAccount,
  onRemoveProviderAccount,
  onAutoUpdateIntervalChange,
  onThemeModeChange,
  onDisplayModeChange,
  onResetTimerDisplayModeChange,
  onResetTimerDisplayModeToggle,
  onTimeFormatModeChange,
  onMenubarIconStyleChange,
  onPreferMenubarWeeklyLimitChange,
  traySettingsPreview,
  onGlobalShortcutChange,
  onStartOnLoginChange,
  onUsageAlertEnabledChange,
  onUsageAlertThresholdChange,
  onUsageAlertCustomThresholdChange,
  onUsageAlertSoundChange,
  onUsagePaceAlertEnabledChange,
  onUsageSpikeAlertEnabledChange,
  onUsageSpikeAlertThresholdPctChange,
  onUIScaleChange,
  onShowAccountIdentityChange,
  onSetCursorTrayMetricForAllAccounts,
  cursorRequestsLineAvailable,
}: AppContentProps) {
  const { activeView } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
    }))
  )

  const pluginSettings = useAppPluginStore((state) => state.pluginSettings)

  const {
    displayMode,
    resetTimerDisplayMode,
    timeFormatMode,
    menubarIconStyle,
    preferMenubarWeeklyLimit,
    autoUpdateInterval,
    globalShortcut,
    themeMode,
    startOnLogin,
    usageAlertEnabled,
    usageAlertThreshold,
    customUsageAlertThreshold,
    usageAlertSound,
    usagePaceAlertEnabled,
    usageSpikeAlertEnabled,
    usageSpikeAlertThresholdPct,
    uiScale,
    showAccountIdentity,
  } = useAppPreferencesStore(
    useShallow((state) => ({
      displayMode: state.displayMode,
      resetTimerDisplayMode: state.resetTimerDisplayMode,
      timeFormatMode: state.timeFormatMode,
      menubarIconStyle: state.menubarIconStyle,
      preferMenubarWeeklyLimit: state.preferMenubarWeeklyLimit,
      autoUpdateInterval: state.autoUpdateInterval,
      globalShortcut: state.globalShortcut,
      themeMode: state.themeMode,
      startOnLogin: state.startOnLogin,
      usageAlertEnabled: state.usageAlertEnabled,
      usageAlertThreshold: state.usageAlertThreshold,
      customUsageAlertThreshold: state.customUsageAlertThreshold,
      usageAlertSound: state.usageAlertSound,
      usagePaceAlertEnabled: state.usagePaceAlertEnabled,
      usageSpikeAlertEnabled: state.usageSpikeAlertEnabled,
      usageSpikeAlertThresholdPct: state.usageSpikeAlertThresholdPct,
      uiScale: state.uiScale,
      showAccountIdentity: state.showAccountIdentity,
    }))
  )

  if (activeView === "home") {
    return (
      <OverviewPage
        plugins={displayPlugins}
        pluginSettings={pluginSettings}
        preferWeeklyLimit={preferMenubarWeeklyLimit}
        onRetryPlugin={onRetryPlugin}
        displayMode={displayMode}
        resetTimerDisplayMode={resetTimerDisplayMode}
        timeFormatMode={timeFormatMode}
        onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
        showAccountIdentity={showAccountIdentity}
      />
    )
  }

  if (activeView === "settings") {
    return (
      <SettingsPage
        plugins={settingsPlugins}
        onReorder={onReorder}
        onToggle={onToggle}
        onTrayLineToggle={onTrayLineToggle}
        onAddProviderAccount={onAddProviderAccount}
        onUpdateProviderAccountCredentials={onUpdateProviderAccountCredentials}
        onRenameProviderAccount={onRenameProviderAccount}
        onRemoveProviderAccount={onRemoveProviderAccount}
        autoUpdateInterval={autoUpdateInterval}
        onAutoUpdateIntervalChange={onAutoUpdateIntervalChange}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        displayMode={displayMode}
        onDisplayModeChange={onDisplayModeChange}
        resetTimerDisplayMode={resetTimerDisplayMode}
        onResetTimerDisplayModeChange={onResetTimerDisplayModeChange}
        timeFormatMode={timeFormatMode}
        onTimeFormatModeChange={onTimeFormatModeChange}
        menubarIconStyle={menubarIconStyle}
        onMenubarIconStyleChange={onMenubarIconStyleChange}
        preferMenubarWeeklyLimit={preferMenubarWeeklyLimit}
        onPreferMenubarWeeklyLimitChange={onPreferMenubarWeeklyLimitChange}
        traySettingsPreview={traySettingsPreview}
        globalShortcut={globalShortcut}
        onGlobalShortcutChange={onGlobalShortcutChange}
        startOnLogin={startOnLogin}
        onStartOnLoginChange={onStartOnLoginChange}
        usageAlertEnabled={usageAlertEnabled}
        onUsageAlertEnabledChange={onUsageAlertEnabledChange}
        usageAlertThreshold={usageAlertThreshold}
        onUsageAlertThresholdChange={onUsageAlertThresholdChange}
        customUsageAlertThreshold={customUsageAlertThreshold}
        onUsageAlertCustomThresholdChange={onUsageAlertCustomThresholdChange}
        usageAlertSound={usageAlertSound}
        onUsageAlertSoundChange={onUsageAlertSoundChange}
        usagePaceAlertEnabled={usagePaceAlertEnabled}
        onUsagePaceAlertEnabledChange={onUsagePaceAlertEnabledChange}
        usageSpikeAlertEnabled={usageSpikeAlertEnabled}
        onUsageSpikeAlertEnabledChange={onUsageSpikeAlertEnabledChange}
        usageSpikeAlertThresholdPct={usageSpikeAlertThresholdPct}
        onUsageSpikeAlertThresholdPctChange={onUsageSpikeAlertThresholdPctChange}
        uiScale={uiScale}
        onUIScaleChange={onUIScaleChange}
        showAccountIdentity={showAccountIdentity}
        onShowAccountIdentityChange={onShowAccountIdentityChange}
        onSetCursorTrayMetricForAllAccounts={onSetCursorTrayMetricForAllAccounts}
        cursorRequestsLineAvailable={cursorRequestsLineAvailable}
      />
    )
  }

  const handleRetry = selectedPlugin
    ? () => onRetryPlugin(selectedPlugin.meta.id)
    : /* v8 ignore next */ undefined

  return (
    <ProviderDetailPage
      plugin={selectedPlugin}
      onRetry={handleRetry}
      displayMode={displayMode}
      resetTimerDisplayMode={resetTimerDisplayMode}
      timeFormatMode={timeFormatMode}
      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
      showAccountIdentity={showAccountIdentity}
    />
  )
}
