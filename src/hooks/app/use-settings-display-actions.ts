import { useCallback } from "react"
import {
  saveUIScale,
  saveDisplayMode,
  saveMenubarIconStyle,
  savePreferMenubarWeeklyLimit,
  saveResetTimerDisplayMode,
  saveShowAccountIdentity,
  saveThemeMode,
  saveUsageAlertCustomThreshold,
  saveUsageAlertEnabled,
  saveUsageAlertSound,
  saveUsageAlertThreshold,
  type DisplayMode,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type UsageAlertSound,
  type UsageAlertThreshold,
} from "@/lib/settings"

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type UseSettingsDisplayActionsArgs = {
  setThemeMode: (value: ThemeMode) => void
  setDisplayMode: (value: DisplayMode) => void
  resetTimerDisplayMode: ResetTimerDisplayMode
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setShowAccountIdentity: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setPreferMenubarWeeklyLimit: (value: boolean) => void
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsDisplayActions({
  setThemeMode,
  setDisplayMode,
  resetTimerDisplayMode,
  setResetTimerDisplayMode,
  setShowAccountIdentity,
  setMenubarIconStyle,
  setPreferMenubarWeeklyLimit,
  scheduleTrayIconUpdate,
}: UseSettingsDisplayActionsArgs) {
  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    void saveThemeMode(mode).catch((error) => {
      console.error("Failed to save theme mode:", error)
    })
  }, [setThemeMode])

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode)
    scheduleTrayIconUpdate("settings", 0)
    void saveDisplayMode(mode).catch((error) => {
      console.error("Failed to save display mode:", error)
    })
  }, [scheduleTrayIconUpdate, setDisplayMode])

  const handleResetTimerDisplayModeChange = useCallback((mode: ResetTimerDisplayMode) => {
    setResetTimerDisplayMode(mode)
    void saveResetTimerDisplayMode(mode).catch((error) => {
      console.error("Failed to save reset timer display mode:", error)
    })
  }, [setResetTimerDisplayMode])

  const handleResetTimerDisplayModeToggle = useCallback(() => {
    const next = resetTimerDisplayMode === "relative" ? "absolute" : "relative"
    handleResetTimerDisplayModeChange(next)
  }, [handleResetTimerDisplayModeChange, resetTimerDisplayMode])

  const handleTimeFormatModeChange = useCallback((mode: TimeFormatMode) => {
    setTimeFormatMode(mode)
    void saveTimeFormatMode(mode).catch((error) => {
      console.error("Failed to save time format mode:", error)
    })
  }, [setTimeFormatMode])

  const handleMenubarIconStyleChange = useCallback((style: MenubarIconStyle) => {
    setMenubarIconStyle(style)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarIconStyle(style).catch((error) => {
      console.error("Failed to save menubar icon style:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarIconStyle])

  const handlePreferMenubarWeeklyLimitChange = useCallback((value: boolean) => {
    setPreferMenubarWeeklyLimit(value)
    scheduleTrayIconUpdate("settings", 0)
    void savePreferMenubarWeeklyLimit(value).catch((error) => {
      console.error("Failed to save menubar weekly limit preference:", error)
    })
  }, [scheduleTrayIconUpdate, setPreferMenubarWeeklyLimit])

  return {
    handleThemeModeChange,
    handleDisplayModeChange,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleTimeFormatModeChange,
    handleMenubarIconStyleChange,
    handlePreferMenubarWeeklyLimitChange,
  }
}
