import { create } from "zustand"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_UI_SCALE,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_SHOW_ACCOUNT_IDENTITY,
  DEFAULT_SHOW_TRAY_ICON,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  DEFAULT_USAGE_ALERT_ENABLED,
  DEFAULT_USAGE_ALERT_SOUND,
  DEFAULT_USAGE_ALERT_THRESHOLD,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type UIScale,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type UsageAlertSound,
  type UsageAlertThreshold,
} from "@/lib/settings"

type AppPreferencesStore = {
  autoUpdateInterval: AutoUpdateIntervalMinutes
  themeMode: ThemeMode
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode: TimeFormatMode
  globalShortcut: GlobalShortcut
  startOnLogin: boolean
  showAccountIdentity: boolean
  menubarIconStyle: MenubarIconStyle
  usageAlertEnabled: boolean
  usageAlertThreshold: UsageAlertThreshold
  customUsageAlertThreshold: number | null
  usageAlertSound: UsageAlertSound
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setThemeMode: (value: ThemeMode) => void
  setDisplayMode: (value: DisplayMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setTimeFormatMode: (value: TimeFormatMode) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setShowAccountIdentity: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setUsageAlertEnabled: (value: boolean) => void
  setUsageAlertThreshold: (value: UsageAlertThreshold) => void
  setCustomUsageAlertThreshold: (value: number | null) => void
  setUsageAlertSound: (value: UsageAlertSound) => void
  resetState: () => void
}

const initialState = {
  autoUpdateInterval: DEFAULT_AUTO_UPDATE_INTERVAL,
  themeMode: DEFAULT_THEME_MODE,
  displayMode: DEFAULT_DISPLAY_MODE,
  resetTimerDisplayMode: DEFAULT_RESET_TIMER_DISPLAY_MODE,
  timeFormatMode: DEFAULT_TIME_FORMAT_MODE,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  startOnLogin: DEFAULT_START_ON_LOGIN,
  showAccountIdentity: DEFAULT_SHOW_ACCOUNT_IDENTITY,
  menubarIconStyle: DEFAULT_MENUBAR_ICON_STYLE,
  usageAlertEnabled: DEFAULT_USAGE_ALERT_ENABLED,
  usageAlertThreshold: DEFAULT_USAGE_ALERT_THRESHOLD,
  customUsageAlertThreshold: DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  usageAlertSound: DEFAULT_USAGE_ALERT_SOUND,
}

export const useAppPreferencesStore = create<AppPreferencesStore>((set) => ({
  ...initialState,
  setAutoUpdateInterval: (value) => set({ autoUpdateInterval: value }),
  setThemeMode: (value) => set({ themeMode: value }),
  setDisplayMode: (value) => set({ displayMode: value }),
  setResetTimerDisplayMode: (value) => set({ resetTimerDisplayMode: value }),
  setTimeFormatMode: (value) => set({ timeFormatMode: value }),
  setGlobalShortcut: (value) => set({ globalShortcut: value }),
  setStartOnLogin: (value) => set({ startOnLogin: value }),
  setShowAccountIdentity: (value) => set({ showAccountIdentity: value }),
  setMenubarIconStyle: (value) => set({ menubarIconStyle: value }),
  setUsageAlertEnabled: (value) => set({ usageAlertEnabled: value }),
  setUsageAlertThreshold: (value) => set({ usageAlertThreshold: value }),
  setCustomUsageAlertThreshold: (value) => set({ customUsageAlertThreshold: value }),
  setUsageAlertSound: (value) => set({ usageAlertSound: value }),
  resetState: () => set(initialState),
}))
