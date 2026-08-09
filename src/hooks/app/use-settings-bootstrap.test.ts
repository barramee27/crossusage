import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  arePluginSettingsEqualMock,
  disableAutostartMock,
  enableAutostartMock,
  getEnabledPluginIdsMock,
  invokeMock,
  isAutostartEnabledMock,
  isTauriMock,
  loadAutoUpdateIntervalMock,
  loadDisplayModeMock,
  loadGlobalShortcutMock,
  loadMenubarIconStyleMock,
  loadPreferMenubarWeeklyLimitMock,
  loadPluginSettingsMock,
  loadResetTimerDisplayModeMock,
  loadShowAccountIdentityMock,
  loadShowTrayIconMock,
  loadShowTrayInsightMock,
  loadShowTotalSpendMock,
  loadTotalSpendMetricMock,
  loadStartOnLoginMock,
  loadThemeModeMock,
  loadUILayoutMock,
  loadModernDensityMock,
  loadUIScaleMock,
  loadTimeFormatModeMock,
  loadAppLocaleMock,
  loadDisplayCurrencyMock,
  migrateLegacyTraySettingsMock,
  migrateWindsurfToDevinMock,
  mergeStoredProviderAccountsMock,
  normalizePluginSettingsMock,
  savePluginSettingsMock,
  resolveOnboardingCompleteMock,
  getVersionMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  isAutostartEnabledMock: vi.fn(),
  enableAutostartMock: vi.fn(),
  disableAutostartMock: vi.fn(),
  arePluginSettingsEqualMock: vi.fn(),
  getEnabledPluginIdsMock: vi.fn(),
  loadAutoUpdateIntervalMock: vi.fn(),
  loadDisplayModeMock: vi.fn(),
  loadGlobalShortcutMock: vi.fn(),
  loadMenubarIconStyleMock: vi.fn(),
  loadPreferMenubarWeeklyLimitMock: vi.fn(),
  loadPluginSettingsMock: vi.fn(),
  loadResetTimerDisplayModeMock: vi.fn(),
  loadShowAccountIdentityMock: vi.fn(),
  loadShowTrayIconMock: vi.fn(),
  loadShowTrayInsightMock: vi.fn(),
  loadShowTotalSpendMock: vi.fn(),
  loadTotalSpendMetricMock: vi.fn(),
  loadStartOnLoginMock: vi.fn(),
  loadThemeModeMock: vi.fn(),
  loadUILayoutMock: vi.fn(),
  loadModernDensityMock: vi.fn(),
  loadUIScaleMock: vi.fn(),
  loadTimeFormatModeMock: vi.fn(),
  loadAppLocaleMock: vi.fn(),
  loadDisplayCurrencyMock: vi.fn(),
  migrateLegacyTraySettingsMock: vi.fn(),
  migrateWindsurfToDevinMock: vi.fn(),
  mergeStoredProviderAccountsMock: vi.fn(),
  normalizePluginSettingsMock: vi.fn(),
  savePluginSettingsMock: vi.fn(),
  resolveOnboardingCompleteMock: vi.fn(),
  getVersionMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}))

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}))

vi.mock("@tauri-apps/plugin-autostart", () => ({
  disable: disableAutostartMock,
  enable: enableAutostartMock,
  isEnabled: isAutostartEnabledMock,
}))

vi.mock("@/lib/settings", () => ({
  arePluginSettingsEqual: arePluginSettingsEqualMock,
  DEFAULT_AUTO_UPDATE_INTERVAL: 15,
  DEFAULT_DISPLAY_MODE: "left",
  DEFAULT_GLOBAL_SHORTCUT: null,
  DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD: null,
  DEFAULT_USAGE_ALERT_ENABLED: false,
  DEFAULT_USAGE_ALERT_SOUND: "Basso",
  DEFAULT_USAGE_ALERT_THRESHOLD: 20,
  DEFAULT_USAGE_PACE_ALERT_ENABLED: true,
  DEFAULT_USAGE_SPIKE_ALERT_ENABLED: false,
  DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT: 50,
  DEFAULT_MENUBAR_ICON_STYLE: "provider",
  DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT: false,
  DEFAULT_RESET_TIMER_DISPLAY_MODE: "relative",
  DEFAULT_SHOW_ACCOUNT_IDENTITY: true,
  DEFAULT_SHOW_TRAY_ICON: true,
  DEFAULT_SHOW_TRAY_INSIGHT: true,
  DEFAULT_SHOW_TOTAL_SPEND: true,
  DEFAULT_TOTAL_SPEND_METRIC: "apiSpend",
  DEFAULT_START_ON_LOGIN: false,
  DEFAULT_THEME_MODE: "system",
  DEFAULT_UI_LAYOUT: "classic",
  DEFAULT_MODERN_DENSITY: "regular",
  DEFAULT_UI_SCALE: "normal",
  DEFAULT_TIME_FORMAT_MODE: "auto",
  DEFAULT_APP_LOCALE: "auto",
  DEFAULT_DISPLAY_CURRENCY: "auto",
  getEnabledPluginIds: getEnabledPluginIdsMock,
  loadShowTrayIcon: loadShowTrayIconMock,
  loadShowTrayInsight: loadShowTrayInsightMock,
  loadShowTotalSpend: loadShowTotalSpendMock,
  loadTotalSpendMetric: loadTotalSpendMetricMock,
  loadAutoUpdateInterval: loadAutoUpdateIntervalMock,
  loadDisplayMode: loadDisplayModeMock,
  loadGlobalShortcut: loadGlobalShortcutMock,
  loadUsageAlertCustomThreshold: vi.fn().mockResolvedValue(null),
  loadUsageAlertEnabled: vi.fn().mockResolvedValue(false),
  loadUsageAlertSound: vi.fn().mockResolvedValue("Basso"),
  loadUsageAlertThreshold: vi.fn().mockResolvedValue(20),
  loadUsagePaceAlertEnabled: vi.fn().mockResolvedValue(true),
  loadUsageSpikeAlertEnabled: vi.fn().mockResolvedValue(false),
  loadUsageSpikeAlertThresholdPct: vi.fn().mockResolvedValue(50),
  loadMenubarIconStyle: loadMenubarIconStyleMock,
  loadPreferMenubarWeeklyLimit: loadPreferMenubarWeeklyLimitMock,
  loadPluginSettings: loadPluginSettingsMock,
  loadResetTimerDisplayMode: loadResetTimerDisplayModeMock,
  loadShowAccountIdentity: loadShowAccountIdentityMock,
  loadStartOnLogin: loadStartOnLoginMock,
  loadThemeMode: loadThemeModeMock,
  loadUILayout: loadUILayoutMock,
  loadModernDensity: loadModernDensityMock,
  loadUIScale: loadUIScaleMock,
  loadTimeFormatMode: loadTimeFormatModeMock,
  loadAppLocale: loadAppLocaleMock,
  loadDisplayCurrency: loadDisplayCurrencyMock,
  migrateLegacyTraySettings: migrateLegacyTraySettingsMock,
  migrateWindsurfToDevin: migrateWindsurfToDevinMock,
  mergeStoredProviderAccounts: mergeStoredProviderAccountsMock,
  normalizePluginSettings: normalizePluginSettingsMock,
  listNewlyBundledPluginIds: vi.fn().mockReturnValue([]),
  loadNotifiedNewProviders: vi.fn().mockResolvedValue([]),
  saveNotifiedNewProviders: vi.fn().mockResolvedValue(undefined),
  savePluginSettings: savePluginSettingsMock,
  resolveOnboardingComplete: resolveOnboardingCompleteMock,
}))

vi.mock("@/lib/notification", () => ({
  sendNotificationAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/stores/modern-layout-store", () => ({
  hydrateModernLayoutStore: vi.fn().mockResolvedValue(undefined),
}))

import { useSettingsBootstrap } from "@/hooks/app/use-settings-bootstrap"

function createArgs() {
  return {
    setPluginSettings: vi.fn(),
    setPluginsMeta: vi.fn(),
    setAutoUpdateInterval: vi.fn(),
    setThemeMode: vi.fn(),
    setUILayout: vi.fn(),
    setModernDensity: vi.fn(),
    setDisplayMode: vi.fn(),
    setResetTimerDisplayMode: vi.fn(),
    setTimeFormatMode: vi.fn(),
    setAppLocale: vi.fn(),
    setDisplayCurrency: vi.fn(),
    setGlobalShortcut: vi.fn(),
    setStartOnLogin: vi.fn(),
    setShowAccountIdentity: vi.fn(),
    setMenubarIconStyle: vi.fn(),
    setPreferMenubarWeeklyLimit: vi.fn(),
    setUIScale: vi.fn(),
    setShowTrayIcon: vi.fn(),
    setShowTrayInsight: vi.fn(),
    setShowTotalSpend: vi.fn(),
    setTotalSpendMetric: vi.fn(),
    setUsageAlertEnabled: vi.fn(),
    setUsageAlertThreshold: vi.fn(),
    setCustomUsageAlertThreshold: vi.fn(),
    setUsageAlertSound: vi.fn(),
    setUsagePaceAlertEnabled: vi.fn(),
    setUsageSpikeAlertEnabled: vi.fn(),
    setUsageSpikeAlertThresholdPct: vi.fn(),
    setOnboardingComplete: vi.fn(),
    setLoadingForPlugins: vi.fn(),
    setErrorForPlugins: vi.fn(),
    startBatch: vi.fn().mockResolvedValue(undefined),
  }
}

describe("useSettingsBootstrap", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    isTauriMock.mockReset()
    isAutostartEnabledMock.mockReset()
    enableAutostartMock.mockReset()
    disableAutostartMock.mockReset()
    arePluginSettingsEqualMock.mockReset()
    getEnabledPluginIdsMock.mockReset()
    loadAutoUpdateIntervalMock.mockReset()
    loadDisplayModeMock.mockReset()
    loadGlobalShortcutMock.mockReset()
    loadMenubarIconStyleMock.mockReset()
    loadPreferMenubarWeeklyLimitMock.mockReset()
    loadPluginSettingsMock.mockReset()
    loadResetTimerDisplayModeMock.mockReset()
    loadShowAccountIdentityMock.mockReset()
    loadShowTrayIconMock.mockReset()
    loadShowTrayInsightMock.mockReset()
    loadShowTotalSpendMock.mockReset()
    loadTotalSpendMetricMock.mockReset()
    loadStartOnLoginMock.mockReset()
    loadThemeModeMock.mockReset()
    loadUILayoutMock.mockReset()
    loadModernDensityMock.mockReset()
    loadUIScaleMock.mockReset()
    loadTimeFormatModeMock.mockReset()
    loadAppLocaleMock.mockReset()
    loadDisplayCurrencyMock.mockReset()
    migrateLegacyTraySettingsMock.mockReset()
    migrateWindsurfToDevinMock.mockReset()
    mergeStoredProviderAccountsMock.mockReset()
    normalizePluginSettingsMock.mockReset()
    savePluginSettingsMock.mockReset()
    resolveOnboardingCompleteMock.mockReset()
    getVersionMock.mockReset()
    getVersionMock.mockResolvedValue("1.1.0")

    isTauriMock.mockReturnValue(true)
    isAutostartEnabledMock.mockResolvedValue(true)
    invokeMock.mockResolvedValue([
      {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        iconFilePath: "/codex.svg",
        brandColor: "#000000",
        lines: [],
        primaryCandidates: [],
      },
    ])
    loadPluginSettingsMock.mockResolvedValue({ order: ["codex"], disabled: [] })
    migrateWindsurfToDevinMock.mockImplementation((settings) => settings)
    mergeStoredProviderAccountsMock.mockImplementation((settings) => settings)
    normalizePluginSettingsMock.mockImplementation((stored) => stored)
    arePluginSettingsEqualMock.mockReturnValue(true)
    loadAutoUpdateIntervalMock.mockResolvedValue(15)
    loadThemeModeMock.mockResolvedValue("dark")
    loadUILayoutMock.mockResolvedValue("classic")
    loadModernDensityMock.mockResolvedValue("regular")
    loadDisplayModeMock.mockResolvedValue("used")
    loadResetTimerDisplayModeMock.mockResolvedValue("relative")
    loadTimeFormatModeMock.mockResolvedValue("auto")
    loadAppLocaleMock.mockResolvedValue("auto")
    loadDisplayCurrencyMock.mockResolvedValue("auto")
    loadGlobalShortcutMock.mockResolvedValue("CommandOrControl+Shift+O")
    loadMenubarIconStyleMock.mockResolvedValue("provider")
    loadPreferMenubarWeeklyLimitMock.mockResolvedValue(true)
    loadStartOnLoginMock.mockResolvedValue(true)
    loadShowAccountIdentityMock.mockResolvedValue(false)
    loadShowTrayIconMock.mockResolvedValue(true)
    loadShowTrayInsightMock.mockResolvedValue(true)
    loadShowTotalSpendMock.mockResolvedValue(true)
    loadTotalSpendMetricMock.mockResolvedValue("apiSpend")
    migrateLegacyTraySettingsMock.mockResolvedValue(undefined)
    savePluginSettingsMock.mockResolvedValue(undefined)
    resolveOnboardingCompleteMock.mockResolvedValue(true)
    getEnabledPluginIdsMock.mockReturnValue(["codex"])
  })

  it("migrates windsurf settings before normalizing and saves the first-launch result", async () => {
    const args = createArgs()
    const storedSettings = { order: ["windsurf"], disabled: [] }
    const migratedSettings = { order: ["devin"], disabled: [] }
    invokeMock.mockResolvedValueOnce([
      {
        id: "devin",
        name: "Devin",
        iconUrl: "/devin.svg",
        iconFilePath: "/devin.svg",
        brandColor: "#000000",
        lines: [],
        primaryCandidates: [],
      },
    ])
    loadPluginSettingsMock.mockResolvedValueOnce(storedSettings)
    migrateWindsurfToDevinMock.mockReturnValueOnce(migratedSettings)
    normalizePluginSettingsMock.mockReturnValueOnce({ order: ["devin"], disabled: [] })
    arePluginSettingsEqualMock.mockReturnValueOnce(false)
    getEnabledPluginIdsMock.mockReturnValueOnce(["devin"])

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(migrateWindsurfToDevinMock).toHaveBeenCalledWith(storedSettings)
      expect(normalizePluginSettingsMock).toHaveBeenCalledWith(
        migratedSettings,
        expect.any(Array)
      )
      expect(savePluginSettingsMock).toHaveBeenCalledWith({ order: ["devin"], disabled: [] })
      expect(args.startBatch).toHaveBeenCalledWith(["devin"])
    })
  })

  it("sets onboarding preference from resolveOnboardingComplete", async () => {
    resolveOnboardingCompleteMock.mockResolvedValueOnce(false)
    const args = createArgs()
    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(resolveOnboardingCompleteMock).toHaveBeenCalledWith(
        { order: ["codex"], disabled: [] },
        "1.1.0",
      )
      expect(args.setOnboardingComplete).toHaveBeenCalledWith(false)
    })
  })

  it("disables autostart when applyStartOnLogin receives false", async () => {
    const args = createArgs()
    const { result } = renderHook(() => useSettingsBootstrap(args))

    await result.current.applyStartOnLogin(false)

    expect(disableAutostartMock).toHaveBeenCalledTimes(1)
    expect(enableAutostartMock).not.toHaveBeenCalled()
  })

  it("falls back to default UI scale when loading fails", async () => {
    const uiScaleError = new Error("ui scale unavailable")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    loadUIScaleMock.mockRejectedValueOnce(uiScaleError)
    const args = createArgs()

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load UI scale:",
        uiScaleError
      )
      expect(args.setUIScale).toHaveBeenCalledWith("normal")
    })

    errorSpy.mockRestore()
  })

  it("falls back to default reset timer mode when loading fails", async () => {
    const resetModeError = new Error("reset timer mode unavailable")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    loadResetTimerDisplayModeMock.mockRejectedValueOnce(resetModeError)
    const args = createArgs()

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load reset timer display mode:",
        resetModeError
      )
      expect(args.setResetTimerDisplayMode).toHaveBeenCalledWith("relative")
    })

    errorSpy.mockRestore()
  })

  it("falls back to default menubar weekly limit preference when loading fails", async () => {
    const weeklyPreferenceError = new Error("weekly preference unavailable")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    loadPreferMenubarWeeklyLimitMock.mockRejectedValueOnce(weeklyPreferenceError)
    const args = createArgs()

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load menubar weekly limit preference:",
        weeklyPreferenceError
      )
      expect(args.setPreferMenubarWeeklyLimit).toHaveBeenCalledWith(false)
    })

    errorSpy.mockRestore()
  })

  it("probes merged provider accounts after bootstrap sync", async () => {
    const normalized = { order: ["cursor"], disabled: [] as string[] }
    const merged = {
      order: ["cursor", "cursor:work"],
      disabled: [] as string[],
      providerInstances: {
        "cursor:work": { baseProviderId: "cursor", label: "Work" },
      },
    }
    const args = createArgs()

    invokeMock
      .mockResolvedValueOnce([
        {
          id: "cursor",
          name: "Cursor",
          iconUrl: "/cursor.svg",
          iconFilePath: "/cursor.svg",
          brandColor: "#000000",
          lines: [],
          primaryCandidates: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          instanceId: "cursor:work",
          baseProviderId: "cursor",
          label: "Work",
        },
      ])

    loadPluginSettingsMock.mockResolvedValueOnce({ order: ["cursor"], disabled: [] })
    normalizePluginSettingsMock.mockReturnValueOnce(normalized)
    mergeStoredProviderAccountsMock.mockReturnValueOnce(merged)
    getEnabledPluginIdsMock.mockReturnValueOnce(["cursor", "cursor:work"])

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(getEnabledPluginIdsMock).toHaveBeenCalledWith(merged)
      expect(args.startBatch).toHaveBeenCalledWith(["cursor", "cursor:work"])
    })
  })
})
