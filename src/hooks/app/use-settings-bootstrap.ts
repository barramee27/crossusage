import { useCallback, useEffect } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  arePluginSettingsEqual,
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_UI_SCALE,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  DEFAULT_USAGE_ALERT_ENABLED,
  DEFAULT_USAGE_ALERT_SOUND,
  DEFAULT_USAGE_ALERT_THRESHOLD,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_SHOW_ACCOUNT_IDENTITY,
  DEFAULT_SHOW_TRAY_ICON,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_TIME_FORMAT_MODE,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadUIScale,
  loadDisplayMode,
  loadGlobalShortcut,
  loadUsageAlertCustomThreshold,
  loadUsageAlertEnabled,
  loadUsageAlertSound,
  loadUsageAlertThreshold,
  loadMenubarIconStyle,
  migrateLegacyTraySettings,
  loadPreferMenubarWeeklyLimit,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadShowAccountIdentity,
  loadShowTrayIcon,
  loadStartOnLogin,
  loadThemeMode,
  loadTimeFormatMode,
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
  type UsageAlertSound,
  type UsageAlertThreshold,
} from "@/lib/settings"

type UseSettingsBootstrapArgs = {
  setPluginSettings: (value: PluginSettings | null) => void
  setPluginsMeta: (value: PluginMeta[]) => void
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setThemeMode: (value: ThemeMode) => void
  setDisplayMode: (value: DisplayMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setTimeFormatMode: (value: TimeFormatMode) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setShowAccountIdentity: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setPreferMenubarWeeklyLimit: (value: boolean) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

export function useSettingsBootstrap({
  setPluginSettings,
  setPluginsMeta,
  setAutoUpdateInterval,
  setThemeMode,
  setDisplayMode,
  setResetTimerDisplayMode,
  setTimeFormatMode,
  setGlobalShortcut,
  setStartOnLogin,
  setShowAccountIdentity,
  setMenubarIconStyle,
  setPreferMenubarWeeklyLimit,
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

        let onboardingDone = false
        try {
          onboardingDone = await resolveOnboardingComplete(storedSettings)
        } catch (error) {
          console.error("Failed to resolve onboarding state:", error)
        }

        const normalized = normalizePluginSettings(storedSettings, availablePlugins)
        if (!arePluginSettingsEqual(storedSettings, normalized)) {
          await savePluginSettings(normalized)
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

        if (isMounted) {
          setPluginSettings(normalized)
          setAutoUpdateInterval(storedInterval)
          setThemeMode(storedThemeMode)
          setDisplayMode(storedDisplayMode)
          setResetTimerDisplayMode(storedResetTimerDisplayMode)
          setTimeFormatMode(storedTimeFormatMode)
          setGlobalShortcut(storedGlobalShortcut)
          setStartOnLogin(storedStartOnLogin)
          setShowAccountIdentity(storedShowAccountIdentity)
          setMenubarIconStyle(storedMenubarIconStyle)
          setPreferMenubarWeeklyLimit(storedPreferMenubarWeeklyLimit)

          const enabledIds = getEnabledPluginIds(normalized)
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
    migrateLegacyTraySettings,
    setPluginSettings,
    setPluginsMeta,
    setResetTimerDisplayMode,
    setShowTrayIcon,
    setOnboardingComplete,
    setStartOnLogin,
    setShowAccountIdentity,
    setThemeMode,
    setUsageAlertEnabled,
    setUsageAlertSound,
    setUsageAlertThreshold,
    startBatch,
  ])

  return {
    applyStartOnLogin,
  }
}
