import { useCallback, useEffect } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  arePluginSettingsEqual,
  DEFAULT_APP_LOCALE,
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_DISPLAY_CURRENCY,
  DEFAULT_UI_SCALE,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  DEFAULT_USAGE_ALERT_ENABLED,
  DEFAULT_USAGE_ALERT_SOUND,
  DEFAULT_USAGE_PACE_ALERT_ENABLED,
  DEFAULT_USAGE_SPIKE_ALERT_ENABLED,
  DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT,
  DEFAULT_USAGE_ALERT_THRESHOLD,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_SHOW_ACCOUNT_IDENTITY,
  DEFAULT_SHOW_TRAY_ICON,
  DEFAULT_SHOW_TRAY_INSIGHT,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_UI_LAYOUT,
  DEFAULT_MODERN_DENSITY,
  DEFAULT_TIME_FORMAT_MODE,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadUIScale,
  loadDisplayMode,
  loadGlobalShortcut,
  loadUsageAlertCustomThreshold,
  loadUsageAlertEnabled,
  loadUsageAlertSound,
  loadUsagePaceAlertEnabled,
  loadUsageSpikeAlertEnabled,
  loadUsageSpikeAlertThresholdPct,
  loadUsageAlertThreshold,
  loadMenubarIconStyle,
  migrateLegacyTraySettings,
  migrateWindsurfToDevin,
  loadPreferMenubarWeeklyLimit,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadShowAccountIdentity,
  loadShowTrayIcon,
  loadShowTrayInsight,
  loadShowTotalSpend,
  loadTotalSpendMetric,
  loadStartOnLogin,
  loadThemeMode,
  loadUILayout,
  loadModernDensity,
  loadTimeFormatMode,
  loadAppLocale,
  loadDisplayCurrency,
  mergeStoredProviderAccounts,
  normalizePluginSettings,
  resolveOnboardingComplete,
  savePluginSettings,
  saveShowTrayIcon,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type GlobalShortcut,
  type MenubarIconStyle,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type UILayout,
  type ModernDensity,
  type TimeFormatMode,
  type AppLocale,
  type DisplayCurrency,
  type UIScale,
  type UsageAlertSound,
  type UsageAlertThreshold,
} from "@/lib/settings"
import { hydrateModernLayoutStore } from "@/stores/modern-layout-store"

type UseSettingsBootstrapArgs = {
  setPluginSettings: (value: PluginSettings | null) => void
  setPluginsMeta: (value: PluginMeta[]) => void
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setThemeMode: (value: ThemeMode) => void
  setUILayout: (value: UILayout) => void
  setModernDensity: (value: ModernDensity) => void
  setDisplayMode: (value: DisplayMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setTimeFormatMode: (value: TimeFormatMode) => void
  setAppLocale: (value: AppLocale) => void
  setDisplayCurrency: (value: DisplayCurrency) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setShowAccountIdentity: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setPreferMenubarWeeklyLimit: (value: boolean) => void
  setUIScale: (value: UIScale) => void
  setShowTrayIcon: (value: boolean) => void
  setShowTrayInsight: (value: boolean) => void
  setShowTotalSpend: (value: boolean) => void
  setTotalSpendMetric: (value: string) => void
  setUsageAlertEnabled: (value: boolean) => void
  setUsageAlertThreshold: (value: UsageAlertThreshold) => void
  setCustomUsageAlertThreshold: (value: number | null) => void
  setUsageAlertSound: (value: UsageAlertSound) => void
  setUsagePaceAlertEnabled: (value: boolean) => void
  setUsageSpikeAlertEnabled: (value: boolean) => void
  setUsageSpikeAlertThresholdPct: (value: import("@/lib/settings").UsageSpikeAlertThresholdPct) => void
  setOnboardingComplete: (value: boolean) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

export function useSettingsBootstrap({
  setPluginSettings,
  setPluginsMeta,
  setAutoUpdateInterval,
  setThemeMode,
  setUILayout,
  setModernDensity,
  setDisplayMode,
  setResetTimerDisplayMode,
  setTimeFormatMode,
  setAppLocale,
  setDisplayCurrency,
  setGlobalShortcut,
  setStartOnLogin,
  setShowAccountIdentity,
  setMenubarIconStyle,
  setPreferMenubarWeeklyLimit,
  setUIScale,
  setShowTrayIcon,
  setShowTrayInsight,
  setShowTotalSpend,
  setTotalSpendMetric,
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
}: UseSettingsBootstrapArgs) {
  const applyStartOnLogin = useCallback(async (value: boolean) => {
    if (!isTauri()) return
    const currentlyEnabled = await isAutostartEnabled()
    if (currentlyEnabled === value) return

    if (value) {
      await enableAutostart()
      return
    }

    await disableAutostart()
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const availablePlugins = await invoke<PluginMeta[]>("list_plugins")
        if (!isMounted) return
        setPluginsMeta(availablePlugins)

        const storedSettings = await loadPluginSettings()
        const migratedSettings = migrateWindsurfToDevin(storedSettings)

        let onboardingDone = false
        try {
          let appVersion = "0.0.0"
          try {
            appVersion = await getVersion()
          } catch (versionError) {
            console.error("Failed to get app version for onboarding:", versionError)
          }
          onboardingDone = await resolveOnboardingComplete(migratedSettings, appVersion)
        } catch (error) {
          console.error("Failed to resolve onboarding state:", error)
        }

        const normalized = normalizePluginSettings(migratedSettings, availablePlugins)
        let settings = normalized
        try {
          const accounts = await invoke<Array<{
            instanceId: string
            baseProviderId: string
            label: string
          }>>("list_provider_accounts")
          settings = mergeStoredProviderAccounts(normalized, accounts, availablePlugins)
        } catch (error) {
          console.error("Failed to sync provider accounts into plugin settings:", error)
        }
        if (!arePluginSettingsEqual(migratedSettings, settings)) {
          await savePluginSettings(settings)
        }

        let storedInterval = DEFAULT_AUTO_UPDATE_INTERVAL
        try {
          storedInterval = await loadAutoUpdateInterval()
        } catch (error) {
          console.error("Failed to load auto-update interval:", error)
        }

        let storedThemeMode = DEFAULT_THEME_MODE
        try {
          storedThemeMode = await loadThemeMode()
        } catch (error) {
          console.error("Failed to load theme mode:", error)
        }

        let storedUILayout = DEFAULT_UI_LAYOUT
        try {
          storedUILayout = await loadUILayout()
        } catch (error) {
          console.error("Failed to load UI layout:", error)
        }

        let storedModernDensity = DEFAULT_MODERN_DENSITY
        try {
          storedModernDensity = await loadModernDensity()
        } catch (error) {
          console.error("Failed to load modern density:", error)
        }

        try {
          await hydrateModernLayoutStore()
        } catch (error) {
          console.error("Failed to hydrate modern layout store:", error)
        }

        let storedDisplayMode = DEFAULT_DISPLAY_MODE
        try {
          storedDisplayMode = await loadDisplayMode()
        } catch (error) {
          console.error("Failed to load display mode:", error)
        }

        let storedResetTimerDisplayMode = DEFAULT_RESET_TIMER_DISPLAY_MODE
        try {
          storedResetTimerDisplayMode = await loadResetTimerDisplayMode()
        } catch (error) {
          console.error("Failed to load reset timer display mode:", error)
        }

        let storedTimeFormatMode = DEFAULT_TIME_FORMAT_MODE
        try {
          storedTimeFormatMode = await loadTimeFormatMode()
        } catch (error) {
          console.error("Failed to load time format mode:", error)
        }

        let storedAppLocale = DEFAULT_APP_LOCALE
        try {
          storedAppLocale = await loadAppLocale()
        } catch (error) {
          console.error("Failed to load app locale:", error)
        }

        let storedDisplayCurrency = DEFAULT_DISPLAY_CURRENCY
        try {
          storedDisplayCurrency = await loadDisplayCurrency()
        } catch (error) {
          console.error("Failed to load display currency:", error)
        }

        let storedGlobalShortcut = DEFAULT_GLOBAL_SHORTCUT
        try {
          storedGlobalShortcut = await loadGlobalShortcut()
        } catch (error) {
          console.error("Failed to load global shortcut:", error)
        }

        let storedStartOnLogin = DEFAULT_START_ON_LOGIN
        try {
          storedStartOnLogin = await loadStartOnLogin()
        } catch (error) {
          console.error("Failed to load start on login:", error)
        }

        let storedShowAccountIdentity = DEFAULT_SHOW_ACCOUNT_IDENTITY
        try {
          storedShowAccountIdentity = await loadShowAccountIdentity()
        } catch (error) {
          console.error("Failed to load account identity visibility:", error)
        }

        let storedShowTrayIcon = DEFAULT_SHOW_TRAY_ICON
        try {
          storedShowTrayIcon = await loadShowTrayIcon()
        } catch (error) {
          console.error("Failed to load show tray icon:", error)
        }
        if (!storedShowTrayIcon) {
          try {
            await saveShowTrayIcon(true)
          } catch (error) {
            console.error("Failed to migrate show tray icon to on:", error)
          }
        }

        let storedShowTrayInsight = DEFAULT_SHOW_TRAY_INSIGHT
        try {
          storedShowTrayInsight = await loadShowTrayInsight()
        } catch (error) {
          console.error("Failed to load show tray insight:", error)
        }

        let storedShowTotalSpend = true
        try {
          storedShowTotalSpend = await loadShowTotalSpend()
        } catch (error) {
          console.error("Failed to load show total spend:", error)
        }

        let storedTotalSpendMetric = "apiSpend"
        try {
          storedTotalSpendMetric = await loadTotalSpendMetric()
        } catch (error) {
          console.error("Failed to load total spend metric:", error)
        }

        try {
          await applyStartOnLogin(storedStartOnLogin)
        } catch (error) {
          console.error("Failed to apply start on login setting:", error)
        }
        try {
          await migrateLegacyTraySettings()
        } catch (error) {
          console.error("Failed to migrate legacy tray settings:", error)
        }

        let storedMenubarIconStyle = DEFAULT_MENUBAR_ICON_STYLE
        try {
          storedMenubarIconStyle = await loadMenubarIconStyle()
        } catch (error) {
          console.error("Failed to load menubar icon style:", error)
        }

        let storedPreferMenubarWeeklyLimit = DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT
        try {
          storedPreferMenubarWeeklyLimit = await loadPreferMenubarWeeklyLimit()
        } catch (error) {
          console.error("Failed to load menubar weekly limit preference:", error)
        }

        let storedUIScale = DEFAULT_UI_SCALE
        try {
          storedUIScale = await loadUIScale()
        } catch (error) {
          console.error("Failed to load UI scale:", error)
        }

        let storedUsageAlertEnabled = DEFAULT_USAGE_ALERT_ENABLED
        try {
          storedUsageAlertEnabled = await loadUsageAlertEnabled()
        } catch (error) {
          console.error("Failed to load usage alert enabled:", error)
        }

        let storedUsageAlertThreshold = DEFAULT_USAGE_ALERT_THRESHOLD
        try {
          storedUsageAlertThreshold = await loadUsageAlertThreshold()
        } catch (error) {
          console.error("Failed to load usage alert threshold:", error)
        }

        let storedUsageAlertCustomThreshold = DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD
        try {
          storedUsageAlertCustomThreshold = await loadUsageAlertCustomThreshold()
        } catch (error) {
          console.error("Failed to load usage alert custom threshold:", error)
        }

        let storedUsageAlertSound = DEFAULT_USAGE_ALERT_SOUND
        try {
          storedUsageAlertSound = await loadUsageAlertSound()
        } catch (error) {
          console.error("Failed to load usage alert sound:", error)
        }

        let storedUsagePaceAlertEnabled = DEFAULT_USAGE_PACE_ALERT_ENABLED
        try {
          storedUsagePaceAlertEnabled = await loadUsagePaceAlertEnabled()
        } catch (error) {
          console.error("Failed to load usage pace alert enabled:", error)
        }

        let storedUsageSpikeAlertEnabled = DEFAULT_USAGE_SPIKE_ALERT_ENABLED
        try {
          storedUsageSpikeAlertEnabled = await loadUsageSpikeAlertEnabled()
        } catch (error) {
          console.error("Failed to load usage spike alert enabled:", error)
        }

        let storedUsageSpikeAlertThresholdPct = DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT
        try {
          storedUsageSpikeAlertThresholdPct = await loadUsageSpikeAlertThresholdPct()
        } catch (error) {
          console.error("Failed to load usage spike alert threshold:", error)
        }

        if (isMounted) {
          setPluginSettings(settings)
          setAutoUpdateInterval(storedInterval)
          setThemeMode(storedThemeMode)
          setUILayout(storedUILayout)
          setModernDensity(storedModernDensity)
          setDisplayMode(storedDisplayMode)
          setResetTimerDisplayMode(storedResetTimerDisplayMode)
          setTimeFormatMode(storedTimeFormatMode)
          setAppLocale(storedAppLocale)
          setDisplayCurrency(storedDisplayCurrency)
          setGlobalShortcut(storedGlobalShortcut)
          setStartOnLogin(storedStartOnLogin)
          setShowAccountIdentity(storedShowAccountIdentity)
          setShowTrayIcon(storedShowTrayIcon)
          setShowTrayInsight(storedShowTrayInsight)
          setShowTotalSpend(storedShowTotalSpend)
          setTotalSpendMetric(storedTotalSpendMetric)
          setMenubarIconStyle(storedMenubarIconStyle)
          setPreferMenubarWeeklyLimit(storedPreferMenubarWeeklyLimit)
          setUIScale(storedUIScale)
          setUsageAlertEnabled(storedUsageAlertEnabled)
          setUsageAlertThreshold(storedUsageAlertThreshold)
          setCustomUsageAlertThreshold(storedUsageAlertCustomThreshold)
          setUsageAlertSound(storedUsageAlertSound)
          setUsagePaceAlertEnabled(storedUsagePaceAlertEnabled)
          setUsageSpikeAlertEnabled(storedUsageSpikeAlertEnabled)
          setUsageSpikeAlertThresholdPct(storedUsageSpikeAlertThresholdPct)
          setOnboardingComplete(onboardingDone)

          const enabledIds = getEnabledPluginIds(settings)
          setLoadingForPlugins(enabledIds)
          try {
            await startBatch(enabledIds)
          } catch (error) {
            console.error("Failed to start probe batch:", error)
            if (isMounted) {
              setErrorForPlugins(enabledIds, "Failed to start probe")
            }
          }
        }
      } catch (e) {
        console.error("Failed to load plugin settings:", e)
        if (isMounted) {
          setOnboardingComplete(true)
        }
      }
    }

    loadSettings()

    return () => {
      isMounted = false
    }
  }, [
    applyStartOnLogin,
    setAutoUpdateInterval,
    setCustomUsageAlertThreshold,
    setDisplayMode,
    setErrorForPlugins,
    setGlobalShortcut,
    setLoadingForPlugins,
    setMenubarIconStyle,
    setPreferMenubarWeeklyLimit,
    setPluginSettings,
    setPluginsMeta,
    setResetTimerDisplayMode,
    setShowTrayIcon,
    setShowTrayInsight,
    setShowTotalSpend,
    setTotalSpendMetric,
    setOnboardingComplete,
    setStartOnLogin,
    setShowAccountIdentity,
    setThemeMode,
    setUILayout,
    setModernDensity,
    setTimeFormatMode,
    setAppLocale,
    setDisplayCurrency,
    setUIScale,
    setUsageAlertEnabled,
    setUsageAlertSound,
    setUsageAlertThreshold,
    startBatch,
  ])

  return {
    applyStartOnLogin,
  }
}
