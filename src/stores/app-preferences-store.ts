import { create } from "zustand"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_UI_SCALE,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_SHOW_ACCOUNT_IDENTITY,
  DEFAULT_SHOW_TRAY_ICON,
  DEFAULT_SHOW_TRAY_INSIGHT,
  DEFAULT_SHOW_TOTAL_SPEND,
  DEFAULT_TOTAL_SPEND_METRIC,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_UI_LAYOUT,
  DEFAULT_MODERN_DENSITY,
  DEFAULT_TIME_FORMAT_MODE,
  DEFAULT_APP_LOCALE,
  DEFAULT_DISPLAY_CURRENCY,
  DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  DEFAULT_USAGE_ALERT_ENABLED,
  DEFAULT_USAGE_ALERT_SOUND,
  DEFAULT_USAGE_PACE_ALERT_ENABLED,
  DEFAULT_USAGE_SPIKE_ALERT_ENABLED,
  DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT,
  DEFAULT_USAGE_ALERT_THRESHOLD,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type UIScale,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type UILayout,
  type ModernDensity,
  type TimeFormatMode,
  type AppLocale,
  type DisplayCurrency,
  type UsageAlertSound,
  type UsageAlertThreshold,
  type UsageSpikeAlertThresholdPct,
} from "@/lib/settings"

type AppPreferencesStore = {
  autoUpdateInterval: AutoUpdateIntervalMinutes
  themeMode: ThemeMode
  uiLayout: UILayout
  modernDensity: ModernDensity
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode: TimeFormatMode
  appLocale: AppLocale
  displayCurrency: DisplayCurrency
  globalShortcut: GlobalShortcut
  startOnLogin: boolean
  showAccountIdentity: boolean
  menubarIconStyle: MenubarIconStyle
  preferMenubarWeeklyLimit: boolean
  uiScale: UIScale
  showTrayIcon: boolean
  showTrayInsight: boolean
  showTotalSpend: boolean
  totalSpendMetric: string
  usageAlertEnabled: boolean
  usageAlertThreshold: UsageAlertThreshold
  customUsageAlertThreshold: number | null
  usageAlertSound: UsageAlertSound
  usagePaceAlertEnabled: boolean
  usageSpikeAlertEnabled: boolean
  usageSpikeAlertThresholdPct: UsageSpikeAlertThresholdPct
  onboardingComplete: boolean | null
  exchangeRatesRevision: number

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
  setUsageSpikeAlertThresholdPct: (value: UsageSpikeAlertThresholdPct) => void
  setOnboardingComplete: (value: boolean) => void
  bumpExchangeRatesRevision: () => void
  resetState: () => void
}

const initialState = {
  autoUpdateInterval: DEFAULT_AUTO_UPDATE_INTERVAL,
  themeMode: DEFAULT_THEME_MODE,
  uiLayout: DEFAULT_UI_LAYOUT,
  modernDensity: DEFAULT_MODERN_DENSITY,
  displayMode: DEFAULT_DISPLAY_MODE,
  resetTimerDisplayMode: DEFAULT_RESET_TIMER_DISPLAY_MODE,
  timeFormatMode: DEFAULT_TIME_FORMAT_MODE,
  appLocale: DEFAULT_APP_LOCALE,
  displayCurrency: DEFAULT_DISPLAY_CURRENCY,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  startOnLogin: DEFAULT_START_ON_LOGIN,
  showAccountIdentity: DEFAULT_SHOW_ACCOUNT_IDENTITY,
  menubarIconStyle: DEFAULT_MENUBAR_ICON_STYLE,
  preferMenubarWeeklyLimit: DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT,
  uiScale: DEFAULT_UI_SCALE,
  showTrayIcon: DEFAULT_SHOW_TRAY_ICON,
  showTrayInsight: DEFAULT_SHOW_TRAY_INSIGHT,
  showTotalSpend: DEFAULT_SHOW_TOTAL_SPEND,
  totalSpendMetric: DEFAULT_TOTAL_SPEND_METRIC,
  usageAlertEnabled: DEFAULT_USAGE_ALERT_ENABLED,
  usageAlertThreshold: DEFAULT_USAGE_ALERT_THRESHOLD,
  customUsageAlertThreshold: DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  usageAlertSound: DEFAULT_USAGE_ALERT_SOUND,
  usagePaceAlertEnabled: DEFAULT_USAGE_PACE_ALERT_ENABLED,
  usageSpikeAlertEnabled: DEFAULT_USAGE_SPIKE_ALERT_ENABLED,
  usageSpikeAlertThresholdPct: DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT,
  onboardingComplete: null as boolean | null,
  exchangeRatesRevision: 0,
}

export const useAppPreferencesStore = create<AppPreferencesStore>((set) => ({
  ...initialState,
  setAutoUpdateInterval: (value) => set({ autoUpdateInterval: value }),
  setThemeMode: (value) => set({ themeMode: value }),
  setUILayout: (value) => set({ uiLayout: value }),
  setModernDensity: (value) => set({ modernDensity: value }),
  setDisplayMode: (value) => set({ displayMode: value }),
  setResetTimerDisplayMode: (value) => set({ resetTimerDisplayMode: value }),
  setTimeFormatMode: (value) => set({ timeFormatMode: value }),
  setAppLocale: (value) => set({ appLocale: value }),
  setDisplayCurrency: (value) => set({ displayCurrency: value }),
  setGlobalShortcut: (value) => set({ globalShortcut: value }),
  setStartOnLogin: (value) => set({ startOnLogin: value }),
  setShowAccountIdentity: (value) => set({ showAccountIdentity: value }),
  setMenubarIconStyle: (value) => set({ menubarIconStyle: value }),
  setPreferMenubarWeeklyLimit: (value) => set({ preferMenubarWeeklyLimit: value }),
  setUIScale: (value) => set({ uiScale: value }),
  setShowTrayIcon: (value) => set({ showTrayIcon: value }),
  setShowTrayInsight: (value) => set({ showTrayInsight: value }),
  setShowTotalSpend: (value) => set({ showTotalSpend: value }),
  setTotalSpendMetric: (value) => set({ totalSpendMetric: value }),
  setUsageAlertEnabled: (value) => set({ usageAlertEnabled: value }),
  setUsageAlertThreshold: (value) => set({ usageAlertThreshold: value }),
  setCustomUsageAlertThreshold: (value) => set({ customUsageAlertThreshold: value }),
  setUsageAlertSound: (value) => set({ usageAlertSound: value }),
  setUsagePaceAlertEnabled: (value) => set({ usagePaceAlertEnabled: value }),
  setUsageSpikeAlertEnabled: (value) => set({ usageSpikeAlertEnabled: value }),
  setUsageSpikeAlertThresholdPct: (value) => set({ usageSpikeAlertThresholdPct: value }),
  setOnboardingComplete: (value) => set({ onboardingComplete: value }),
  bumpExchangeRatesRevision: () =>
    set((state) => ({ exchangeRatesRevision: state.exchangeRatesRevision + 1 })),
  resetState: () => set(initialState),
}))
