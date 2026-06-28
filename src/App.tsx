import { useCallback, useEffect, useMemo, useRef } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { invoke } from "@tauri-apps/api/core"
import { useShallow } from "zustand/react/shallow"
import { AppShell } from "@/components/app/app-shell"
import { ModernShell } from "@/components/app/modern-shell"
import { useAppPluginViews } from "@/hooks/app/use-app-plugin-views"
import { useProbe } from "@/hooks/app/use-probe"
import { useSettingsBootstrap } from "@/hooks/app/use-settings-bootstrap"
import { useSettingsDisplayActions } from "@/hooks/app/use-settings-display-actions"
import { useSettingsPluginActions } from "@/hooks/app/use-settings-plugin-actions"
import { useSettingsPluginList } from "@/hooks/app/use-settings-plugin-list"
import { useSettingsSystemActions } from "@/hooks/app/use-settings-system-actions"
import { useSettingsTheme } from "@/hooks/app/use-settings-theme"
import { useSettingsUIScale } from "@/hooks/app/use-settings-ui-scale"
import { useTrayIcon } from "@/hooks/app/use-tray-icon"
import { useUsageAlert } from "@/hooks/app/use-usage-alert"
import { useAppUpdate } from "@/hooks/use-app-update"
import {
  buildProviderInstanceId,
  getBaseProviderId,
  getProviderInstanceLabel,
  REFRESH_COOLDOWN_MS,
  DEFAULT_UI_LAYOUT,
  saveDualUiOnboardingComplete,
  savePluginSettings,
  saveUILayout,
  type UILayout,
} from "@/lib/settings"
import { type PluginContextAction } from "@/components/side-nav"
import type { PluginOutput } from "@/lib/plugin-types"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppUiStore } from "@/stores/app-ui-store"

const TRAY_PROBE_DEBOUNCE_MS = 500
const TRAY_SETTINGS_DEBOUNCE_MS = 2000

type ProviderAccountCredentialInput = {
  label?: string
  accessToken: string
  refreshToken: string
  sessionKey: string
}

function App() {
  const {
    activeView,
    setActiveView,
  } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setActiveView: state.setActiveView,
    }))
  )

  const {
    pluginsMeta,
    setPluginsMeta,
    pluginSettings,
    setPluginSettings,
  } = useAppPluginStore(
    useShallow((state) => ({
      pluginsMeta: state.pluginsMeta,
      setPluginsMeta: state.setPluginsMeta,
      pluginSettings: state.pluginSettings,
      setPluginSettings: state.setPluginSettings,
    }))
  )

  const {
    autoUpdateInterval,
    setAutoUpdateInterval,
    themeMode,
    setThemeMode,
    uiLayout,
    setUILayout,
    setModernDensity,
    displayMode,
    setDisplayMode,
    menubarIconStyle,
    setMenubarIconStyle,
    preferMenubarWeeklyLimit,
    setPreferMenubarWeeklyLimit,
    resetTimerDisplayMode,
    setResetTimerDisplayMode,
    setTimeFormatMode,
    setShowAccountIdentity,
    uiScale,
    setUIScale,
    setGlobalShortcut,
    setStartOnLogin,
    setUsageAlertEnabled,
    setUsageAlertThreshold,
    setCustomUsageAlertThreshold,
    setUsageAlertSound,
    setUsagePaceAlertEnabled,
    setUsageSpikeAlertEnabled,
    setUsageSpikeAlertThresholdPct,
    setShowTrayIcon,
    setShowTrayInsight,
    onboardingComplete,
    setOnboardingComplete,
  } = useAppPreferencesStore(
    useShallow((state) => ({
      autoUpdateInterval: state.autoUpdateInterval,
      setAutoUpdateInterval: state.setAutoUpdateInterval,
      themeMode: state.themeMode,
      setThemeMode: state.setThemeMode,
      uiLayout: state.uiLayout,
      setUILayout: state.setUILayout,
      setModernDensity: state.setModernDensity,
      displayMode: state.displayMode,
      setDisplayMode: state.setDisplayMode,
      menubarIconStyle: state.menubarIconStyle,
      setMenubarIconStyle: state.setMenubarIconStyle,
      preferMenubarWeeklyLimit: state.preferMenubarWeeklyLimit,
      setPreferMenubarWeeklyLimit: state.setPreferMenubarWeeklyLimit,
      resetTimerDisplayMode: state.resetTimerDisplayMode,
      setResetTimerDisplayMode: state.setResetTimerDisplayMode,
      setTimeFormatMode: state.setTimeFormatMode,
      setShowAccountIdentity: state.setShowAccountIdentity,
      uiScale: state.uiScale,
      setUIScale: state.setUIScale,
      setGlobalShortcut: state.setGlobalShortcut,
      setStartOnLogin: state.setStartOnLogin,
      setUsageAlertEnabled: state.setUsageAlertEnabled,
      setUsageAlertThreshold: state.setUsageAlertThreshold,
      setCustomUsageAlertThreshold: state.setCustomUsageAlertThreshold,
      setUsageAlertSound: state.setUsageAlertSound,
      setUsagePaceAlertEnabled: state.setUsagePaceAlertEnabled,
      setUsageSpikeAlertEnabled: state.setUsageSpikeAlertEnabled,
      setUsageSpikeAlertThresholdPct: state.setUsageSpikeAlertThresholdPct,
      setShowTrayIcon: state.setShowTrayIcon,
      setShowTrayInsight: state.setShowTrayInsight,
      onboardingComplete: state.onboardingComplete,
      setOnboardingComplete: state.setOnboardingComplete,
    }))
  )

  const scheduleProbeTrayUpdateRef = useRef<() => void>(() => {})
  const { checkUsageAlert } = useUsageAlert()
  const handleProbeResult = useCallback((output: PluginOutput) => {
    scheduleProbeTrayUpdateRef.current()
    checkUsageAlert(output)
  }, [checkUsageAlert])

  const {
    pluginStates,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    handleRetryPlugin,
    handleRefreshAll,
  } = useProbe({
    pluginSettings,
    autoUpdateInterval,
    onProbeResult: handleProbeResult,
  })

  const pluginSettingsRef = useRef(pluginSettings)
  pluginSettingsRef.current = pluginSettings

  const { updateStatus, triggerInstall, checkForUpdates } = useAppUpdate()

  const { scheduleTrayIconUpdate, traySettingsPreview } = useTrayIcon({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    displayMode,
    menubarIconStyle,
    preferMenubarWeeklyLimit,
    activeView,
    uiLayout,
  })

  useEffect(() => {
    scheduleProbeTrayUpdateRef.current = () => {
      scheduleTrayIconUpdate("probe", TRAY_PROBE_DEBOUNCE_MS)
    }
  }, [scheduleTrayIconUpdate])

  const { applyStartOnLogin } = useSettingsBootstrap({
    setPluginSettings,
    setPluginsMeta,
    setAutoUpdateInterval,
    setThemeMode,
    setUILayout,
    setModernDensity,
    setDisplayMode,
    setMenubarIconStyle,
    setPreferMenubarWeeklyLimit,
    setResetTimerDisplayMode,
    setTimeFormatMode,
    setShowAccountIdentity,
    setUIScale,
    setShowTrayIcon,
    setShowTrayInsight,
    setGlobalShortcut,
    setStartOnLogin,
    setUsageAlertEnabled,
    setUsageAlertThreshold,
    setCustomUsageAlertThreshold,
    setUsageAlertSound,
    setUsagePaceAlertEnabled,
    setUsageSpikeAlertEnabled,
    setUsageSpikeAlertThresholdPct,
    setOnboardingComplete,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  })

  useSettingsTheme(themeMode)
  useSettingsUIScale(uiScale)

  const {
    handleThemeModeChange,
    handleUILayoutChange,
    handleModernDensityChange,
    handleDisplayModeChange,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleTimeFormatModeChange,
    handleShowAccountIdentityChange,
    handleMenubarIconStyleChange,
    handlePreferMenubarWeeklyLimitChange,
    handleUIScaleChange,
    handleUsageAlertEnabledChange,
    handleUsageAlertThresholdChange,
    handleUsageAlertCustomThresholdChange,
    handleUsageAlertSoundChange,
    handleUsagePaceAlertEnabledChange,
    handleUsageSpikeAlertEnabledChange,
    handleUsageSpikeAlertThresholdPctChange,
  } = useSettingsDisplayActions({
    setThemeMode,
    setUILayout,
    setModernDensity,
    setDisplayMode,
    resetTimerDisplayMode,
    setResetTimerDisplayMode,
    setTimeFormatMode,
    setShowAccountIdentity,
    setMenubarIconStyle,
    setPreferMenubarWeeklyLimit,
    setUIScale,
    setUsageAlertEnabled,
    setUsageAlertThreshold,
    setCustomUsageAlertThreshold,
    setUsageAlertSound,
    setUsagePaceAlertEnabled,
    setUsageSpikeAlertEnabled,
    setUsageSpikeAlertThresholdPct,
    scheduleTrayIconUpdate,
  })

  const {
    handleAutoUpdateIntervalChange,
    handleGlobalShortcutChange,
    handleStartOnLoginChange,
  } = useSettingsSystemActions({
    pluginSettings,
    setAutoUpdateInterval,
    setAutoUpdateNextAt,
    setGlobalShortcut,
    setStartOnLogin,
    applyStartOnLogin,
  })

  const {
    handleReorder,
    handleToggle,
    handleTrayLineToggle,
    handleSetCursorTrayMetricForAllAccounts,
    handleDashboardMetricToggle,
    handleProviderDashboardMetrics,
  } = useSettingsPluginActions({
    pluginSettings,
    pluginsMeta,
    setPluginSettings,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    scheduleTrayIconUpdate,
  })

  const settingsPlugins = useSettingsPluginList({
    pluginSettings,
    pluginsMeta,
  })

  /** null = still loading or no probe yet; true = API returned a Requests line; false = Pro-style response without Requests */
  const cursorRequestsLineAvailable = useMemo(() => {
    const st = pluginStates.cursor
    if (!st) return null
    if (st.loading) return null
    if (st.error) return null
    const lines = st.data?.lines ?? []
    return lines.some((l) => l.label === "Requests")
  }, [pluginStates])

  const cursorTrayLinesKey = JSON.stringify(pluginSettings?.trayLines?.cursor ?? null)

  useEffect(() => {
    if (cursorRequestsLineAvailable !== false) return
    const current = pluginSettingsRef.current
    if (!current?.trayLines?.cursor) return
    const cur = current.trayLines.cursor
    if (cur[0] === "__NONE__") return
    if (!cur.includes("Requests")) return
    const next = cur.filter((l) => l !== "Requests")
    const nextTrayLines = {
      ...current.trayLines,
      cursor: next.length === 0 ? ["__NONE__"] : next,
    }
    const nextSettings = { ...current, trayLines: nextTrayLines }
    setPluginSettings(nextSettings)
    void savePluginSettings(nextSettings).catch((e) => {
      console.error("Failed to prune Requests from tray lines:", e)
    })
    scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
  }, [
    cursorRequestsLineAvailable,
    cursorTrayLinesKey,
    setPluginSettings,
    scheduleTrayIconUpdate,
  ])

  const { displayPlugins, navPlugins, selectedPlugin } = useAppPluginViews({
    activeView,
    setActiveView,
    pluginSettings,
    pluginsMeta,
    pluginStates,
  })

  const showOnboardingWizard = onboardingComplete === false && pluginSettings !== null

  const handleOnboardingComplete = useCallback(
    (layout: UILayout) => {
      void getVersion()
        .then((appVersion) =>
          Promise.all([saveUILayout(layout), saveDualUiOnboardingComplete(appVersion)]),
        )
        .then(() => {
          setUILayout(layout)
          setOnboardingComplete(true)
          setActiveView("settings")
        })
        .catch((error) => {
          console.error("Failed to save onboarding completion:", error)
        })
    },
    [setActiveView, setOnboardingComplete, setUILayout],
  )

  const handleOnboardingSkip = useCallback(() => {
    void getVersion()
      .then((appVersion) =>
        Promise.all([
          saveUILayout(DEFAULT_UI_LAYOUT),
          saveDualUiOnboardingComplete(appVersion),
        ]),
      )
      .then(() => {
        setUILayout(DEFAULT_UI_LAYOUT)
        setOnboardingComplete(true)
      })
      .catch((error) => {
        console.error("Failed to save onboarding completion:", error)
      })
  }, [setOnboardingComplete, setUILayout])

  const handlePluginContextAction = useCallback(
    (pluginId: string, action: PluginContextAction) => {
      if (action === "reload") {
        handleRetryPlugin(pluginId)
        return
      }

      const currentSettings = pluginSettingsRef.current
      if (!currentSettings) return
      const alreadyDisabled = currentSettings.disabled.includes(pluginId)
      if (alreadyDisabled) return

      const nextSettings = {
        ...currentSettings,
        disabled: [...currentSettings.disabled, pluginId],
      }
      setPluginSettings(nextSettings)
      scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
      void savePluginSettings(nextSettings).catch((error) => {
        console.error("Failed to save plugin toggle:", error)
      })

      if (activeView === pluginId) {
        setActiveView("home")
      }
    },
    [activeView, handleRetryPlugin, scheduleTrayIconUpdate, setActiveView, setPluginSettings]
  )

  const isPluginRefreshAvailable = useCallback(
    (pluginId: string) => {
      const pluginState = pluginStates[pluginId]
      if (!pluginState) return true
      if (pluginState.loading) return false
      if (!pluginState.lastManualRefreshAt) return true
      return Date.now() - pluginState.lastManualRefreshAt >= REFRESH_COOLDOWN_MS
    },
    [pluginStates]
  )

  const saveProviderAccountCredentials = useCallback(
    async (args: {
      instanceId: string
      baseProviderId: string
      label: string
      accessToken?: string | null
      refreshToken?: string | null
      sessionKey?: string | null
    }) => {
      await invoke("save_provider_account", {
        account: {
          instanceId: args.instanceId,
          baseProviderId: args.baseProviderId,
          label: args.label,
          accessToken: args.accessToken ?? null,
          refreshToken: args.refreshToken ?? null,
          sessionKey: args.sessionKey ?? null,
          expiresAt: null,
        },
      })
    },
    []
  )

  const handleAddProviderAccount = useCallback(
    (baseProviderId: string, input: ProviderAccountCredentialInput) => {
      if (!pluginSettings) return
      const base = pluginsMeta.find((plugin) => plugin.id === baseProviderId)
      if (!base) return
      const label = input.label?.trim() || "Account"
      let instanceId = buildProviderInstanceId(baseProviderId, label)
      let counter = 2
      while (
        pluginSettings.order.includes(instanceId) ||
        pluginSettings.providerInstances?.[instanceId]
      ) {
        instanceId = `${buildProviderInstanceId(baseProviderId, label)}-${counter}`
        counter += 1
      }
      const nextSettings = {
        ...pluginSettings,
        order: [...pluginSettings.order, instanceId],
        providerInstances: {
          ...(pluginSettings.providerInstances ?? {}),
          [instanceId]: { baseProviderId, label },
        },
      }
      setPluginSettings(nextSettings)
      void saveProviderAccountCredentials({
        instanceId,
        baseProviderId,
        label,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        sessionKey: input.sessionKey,
      })
        .then(() => savePluginSettings(nextSettings))
        .then(() => {
          setLoadingForPlugins([instanceId])
          return startBatch([instanceId])
        })
        .catch((error) => {
          console.error("Failed to add provider account:", error)
          setErrorForPlugins([instanceId], "Failed to save account")
        })
      scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    },
    [
      pluginSettings,
      pluginsMeta,
      saveProviderAccountCredentials,
      scheduleTrayIconUpdate,
      setErrorForPlugins,
      setLoadingForPlugins,
      setPluginSettings,
      startBatch,
    ]
  )

  const handleUpdateProviderAccountCredentials = useCallback(
    (id: string, input: ProviderAccountCredentialInput) => {
      if (!pluginSettings) return
      const baseProviderId = getBaseProviderId(id, pluginSettings)
      const base = pluginsMeta.find((plugin) => plugin.id === baseProviderId)
      if (!base) return
      const label = input.label?.trim() || getProviderInstanceLabel(id, pluginSettings) || base.name
      void saveProviderAccountCredentials({
        instanceId: id,
        baseProviderId,
        label,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        sessionKey: input.sessionKey,
      })
        .then(() => {
          setLoadingForPlugins([id])
          return startBatch([id])
        })
        .catch((error) => {
          console.error("Failed to update provider account credentials:", error)
          setErrorForPlugins([id], "Failed to save account")
        })
    },
    [
      pluginSettings,
      pluginsMeta,
      saveProviderAccountCredentials,
      setErrorForPlugins,
      setLoadingForPlugins,
      startBatch,
    ]
  )

  const handleRenameProviderAccount = useCallback(
    (id: string, label: string) => {
      if (!pluginSettings) return
      const instance = pluginSettings.providerInstances?.[id]
      if (!instance) return
      const trimmedLabel = label.trim()
      if (!trimmedLabel) return
      const nextSettings = {
        ...pluginSettings,
        providerInstances: {
          ...(pluginSettings.providerInstances ?? {}),
          [id]: { ...instance, label: trimmedLabel },
        },
      }
      setPluginSettings(nextSettings)
      void invoke("save_provider_account", {
        account: {
          instanceId: id,
          baseProviderId: instance.baseProviderId,
          label: trimmedLabel,
          accessToken: null,
          refreshToken: null,
          sessionKey: null,
          expiresAt: null,
        },
      })
        .then(() => savePluginSettings(nextSettings))
        .catch((error) => {
          console.error("Failed to rename provider account:", error)
        })
      scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    },
    [pluginSettings, scheduleTrayIconUpdate, setPluginSettings]
  )

  const handleRemoveProviderAccount = useCallback(
    (id: string) => {
      if (!pluginSettings) return
      if (!pluginSettings.providerInstances?.[id]) return
      const nextTrayLines = { ...(pluginSettings.trayLines ?? {}) }
      delete nextTrayLines[id]
      const nextInstances = { ...(pluginSettings.providerInstances ?? {}) }
      delete nextInstances[id]
      const nextSettings = {
        ...pluginSettings,
        order: pluginSettings.order.filter((pluginId) => pluginId !== id),
        disabled: pluginSettings.disabled.filter((pluginId) => pluginId !== id),
        trayLines: nextTrayLines,
        providerInstances: nextInstances,
      }
      setPluginSettings(nextSettings)
      if (activeView === id) setActiveView("home")
      void invoke("delete_provider_account", { instanceId: id })
        .then(() => savePluginSettings(nextSettings))
        .catch((error) => {
          console.error("Failed to remove provider account:", error)
        })
      scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    },
    [activeView, pluginSettings, scheduleTrayIconUpdate, setActiveView, setPluginSettings]
  )

  const shellProps = {
    onRefreshAll: handleRefreshAll,
    displayPlugins,
    settingsPlugins,
    autoUpdateNextAt,
    updateStatus,
    onUpdateInstall: triggerInstall,
    onUpdateCheck: checkForUpdates,
    showOnboardingWizard,
    onOnboardingComplete: handleOnboardingComplete,
    onOnboardingSkip: handleOnboardingSkip,
    appContentProps: {
      onRetryPlugin: handleRetryPlugin,
      onReorder: handleReorder,
      onToggle: handleToggle,
      onTrayLineToggle: handleTrayLineToggle,
      onDashboardMetricToggle: handleDashboardMetricToggle,
      onProviderDashboardMetrics: handleProviderDashboardMetrics,
      onAddProviderAccount: handleAddProviderAccount,
      onUpdateProviderAccountCredentials: handleUpdateProviderAccountCredentials,
      onRenameProviderAccount: handleRenameProviderAccount,
      onRemoveProviderAccount: handleRemoveProviderAccount,
      onAutoUpdateIntervalChange: handleAutoUpdateIntervalChange,
      onThemeModeChange: handleThemeModeChange,
      onUILayoutChange: handleUILayoutChange,
      onModernDensityChange: handleModernDensityChange,
      onDisplayModeChange: handleDisplayModeChange,
      onResetTimerDisplayModeChange: handleResetTimerDisplayModeChange,
      onResetTimerDisplayModeToggle: handleResetTimerDisplayModeToggle,
      onTimeFormatModeChange: handleTimeFormatModeChange,
      onMenubarIconStyleChange: handleMenubarIconStyleChange,
      onPreferMenubarWeeklyLimitChange: handlePreferMenubarWeeklyLimitChange,
      traySettingsPreview,
      onGlobalShortcutChange: handleGlobalShortcutChange,
      onStartOnLoginChange: handleStartOnLoginChange,
      onUsageAlertEnabledChange: handleUsageAlertEnabledChange,
      onUsageAlertThresholdChange: handleUsageAlertThresholdChange,
      onUsageAlertCustomThresholdChange: handleUsageAlertCustomThresholdChange,
      onUsageAlertSoundChange: handleUsageAlertSoundChange,
      onUsagePaceAlertEnabledChange: handleUsagePaceAlertEnabledChange,
      onUsageSpikeAlertEnabledChange: handleUsageSpikeAlertEnabledChange,
      onUsageSpikeAlertThresholdPctChange: handleUsageSpikeAlertThresholdPctChange,
      onUIScaleChange: handleUIScaleChange,
      onShowAccountIdentityChange: handleShowAccountIdentityChange,
      onSetCursorTrayMetricForAllAccounts: handleSetCursorTrayMetricForAllAccounts,
      cursorRequestsLineAvailable,
    },
  }

  if (uiLayout === "modern") {
    return (
      <ModernShell
        {...shellProps}
        preferWeeklyLimit={preferMenubarWeeklyLimit}
      />
    )
  }

  return (
    <AppShell
      {...shellProps}
      navPlugins={navPlugins}
      selectedPlugin={selectedPlugin}
      onPluginContextAction={handlePluginContextAction}
      isPluginRefreshAvailable={isPluginRefreshAvailable}
      onNavReorder={handleReorder}
    />
  )
}

export { App }
