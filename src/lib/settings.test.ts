import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT,
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_SHOW_ACCOUNT_IDENTITY,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_TIME_FORMAT_MODE,
  DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD,
  DEFAULT_USAGE_ALERT_ENABLED,
  DEFAULT_USAGE_ALERT_SOUND,
  DEFAULT_USAGE_ALERT_THRESHOLD,
  USAGE_ALERT_CUSTOM_THRESHOLD_KEY,
  USAGE_ALERT_ENABLED_KEY,
  USAGE_ALERT_SOUND_KEY,
  USAGE_ALERT_THRESHOLD_KEY,
  arePluginSettingsEqual,
  getBaseProviderId,
  getEnabledPluginIds,
  getProviderDisplayName,
  getProviderInstanceMeta,
  isUsageAlertThreshold,
  loadAutoUpdateInterval,
  loadDisplayMode,
  loadGlobalShortcut,
  loadMenubarIconStyle,
  loadPreferMenubarWeeklyLimit,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadShowAccountIdentity,
  loadStartOnLogin,
  loadTimeFormatMode,
  loadUsageAlertCustomThreshold,
  loadUsageAlertEnabled,
  loadUsageAlertSound,
  loadUsageAlertThreshold,
  migrateLegacyTraySettings,
  loadThemeMode,
  normalizePluginSettings,
  resolveOnboardingComplete,
  saveAutoUpdateInterval,
  saveDisplayMode,
  saveGlobalShortcut,
  saveMenubarIconStyle,
  savePreferMenubarWeeklyLimit,
  savePluginSettings,
  saveResetTimerDisplayMode,
  saveShowAccountIdentity,
  saveStartOnLogin,
  saveTimeFormatMode,
  saveThemeMode,
  saveUsageAlertCustomThreshold,
  saveUsageAlertEnabled,
  saveUsageAlertSound,
  saveUsageAlertThreshold,
} from "@/lib/settings"
import type { PluginMeta } from "@/lib/plugin-types"

const storeState = new Map<string, unknown>()
const storeDeleteMock = vi.fn()
const storeSaveMock = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get<T>(key: string): Promise<T | null> {
      if (!storeState.has(key)) return undefined as T | null
      return storeState.get(key) as T | null
    }
    async set<T>(key: string, value: T): Promise<void> {
      storeState.set(key, value)
    }
    async delete(key: string): Promise<void> {
      storeDeleteMock(key)
      storeState.delete(key)
    }
    async save(): Promise<void> {
      storeSaveMock()
    }
  },
}))

describe("settings", () => {
  beforeEach(() => {
    storeState.clear()
    storeDeleteMock.mockReset()
    storeSaveMock.mockReset()
  })

  it("loads defaults when no settings stored", async () => {
    await expect(loadPluginSettings()).resolves.toEqual(DEFAULT_PLUGIN_SETTINGS)
  })

  it("sanitizes stored settings", async () => {
    storeState.set("plugins", { order: ["a"], disabled: "nope" })
    await expect(loadPluginSettings()).resolves.toEqual({
      order: ["a"],
      disabled: [],
      trayLines: {},
      providerInstances: {},
    })
  })

  it("saves settings", async () => {
    const settings = { order: ["a"], disabled: ["b"], trayLines: { a: ["Session"] }, providerInstances: {} }
    await savePluginSettings(settings)
    await expect(loadPluginSettings()).resolves.toEqual(settings)
  })

  it("normalizes order + disabled against known plugins", () => {
    const plugins: PluginMeta[] = [
      { id: "a", name: "A", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
      { id: "b", name: "B", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
    ]
    const normalized = normalizePluginSettings(
      { order: ["b", "b", "c"], disabled: ["c", "a"], trayLines: { "a": ["x"], "c": ["y"] } },
      plugins
    )
    expect(normalized).toEqual({
      order: ["a", "b"],
      disabled: ["a"],
      trayLines: { "a": ["x"] },
      providerInstances: {},
    })
  })

  it("normalizes multiple account instances for the same provider", () => {
    const plugins: PluginMeta[] = [
      { id: "claude", name: "Claude", iconUrl: "icon", lines: [], primaryCandidates: ["Usage"] },
      { id: "cursor", name: "Cursor", iconUrl: "cursor-icon", lines: [], primaryCandidates: ["Requests"] },
    ]
    const normalized = normalizePluginSettings(
      {
        order: ["claude:personal", "cursor", "claude:work", "missing"],
        disabled: ["claude:personal", "missing"],
        trayLines: {
          "claude:work": ["Usage"],
          missing: ["Usage"],
        },
        providerInstances: {
          "claude:work": { baseProviderId: "claude", label: "Work" },
          "claude:personal": { baseProviderId: "claude", label: "Personal" },
          "bad": { baseProviderId: "missing", label: "Bad" },
        },
      },
      plugins
    )

    expect(normalized.order).toEqual(["claude", "claude:personal", "claude:work", "cursor"])
    expect(normalized.disabled).toEqual(["claude:personal"])
    expect(normalized.trayLines).toEqual({ "claude:work": ["Usage"] })
    expect(normalized.providerInstances).toEqual({
      "claude:personal": { baseProviderId: "claude", label: "Personal" },
      "claude:work": { baseProviderId: "claude", label: "Work" },
    })
    expect(getBaseProviderId("claude:work", normalized)).toBe("claude")
    expect(getProviderDisplayName("claude:work", normalized, plugins)).toBe("Claude (Work)")
    expect(getProviderInstanceMeta("claude:work", normalized, plugins)).toMatchObject({
      id: "claude:work",
      baseProviderId: "claude",
      instanceLabel: "Work",
      iconUrl: "icon",
    })
  })

  it("normalizes trayLines: strips __NONE__ when mixed with real labels", () => {
    const plugins: PluginMeta[] = [
      { id: "cursor", name: "Cursor", iconUrl: "", lines: [], primaryCandidates: [] },
    ]
    const normalized = normalizePluginSettings(
      { order: ["cursor"], disabled: [], trayLines: { cursor: ["__NONE__", "Credits"] } },
      plugins
    )
    expect(normalized.trayLines).toEqual({ cursor: ["Credits"] })
  })

  it("migrates trayLines: All usage and Total usage to Total usage (deduped)", () => {
    const plugins: PluginMeta[] = [
      { id: "cursor", name: "Cursor", iconUrl: "", lines: [], primaryCandidates: [] },
    ]
    const normalized = normalizePluginSettings(
      {
        order: ["cursor"],
        disabled: [],
        trayLines: { cursor: ["Total usage", "All usage"] },
      },
      plugins
    )
    expect(normalized.trayLines).toEqual({ cursor: ["Total usage"] })
  })

  it("sorts providers alphabetically by display name", () => {
    const plugins: PluginMeta[] = [
      { id: "cursor", name: "Cursor", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
      { id: "claude", name: "Claude", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
      { id: "codex", name: "Codex", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
      { id: "cursor-nightly", name: "Cursor Nightly", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
    ]
    const result = normalizePluginSettings(
      { order: ["cursor", "codex", "claude", "cursor-nightly"], disabled: [] },
      plugins
    )
    expect(result.order).toEqual(["claude", "codex", "cursor", "cursor-nightly"])
  })

  it("auto-disables new non-default plugins", () => {
    const plugins: PluginMeta[] = [
      { id: "claude", name: "Claude", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
      { id: "copilot", name: "Copilot", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
      { id: "windsurf", name: "Windsurf", iconUrl: "", iconFilePath: "", lines: [], primaryCandidates: [] },
    ]
    const result = normalizePluginSettings({ order: [], disabled: [] }, plugins)
    expect(result.order).toEqual(["claude", "copilot", "windsurf"])
    expect(result.disabled).toEqual(["copilot", "windsurf"])
  })

  it("compares settings equality", () => {
    const a = { order: ["a"], disabled: [], trayLines: {} }
    const b = { order: ["a"], disabled: [], trayLines: {} }
    const c = { order: ["b"], disabled: [], trayLines: {} }
    const d = { order: ["a"], disabled: [], trayLines: { "a": ["x"] } }
    const e = { order: ["a"], disabled: [], trayLines: { "a": [] } }
    const f = { order: ["a"], disabled: [], trayLines: { "b": [] } }
    expect(arePluginSettingsEqual(a, b)).toBe(true)
    expect(arePluginSettingsEqual(a, c)).toBe(false)
    expect(arePluginSettingsEqual(a, d)).toBe(false)
    expect(arePluginSettingsEqual(e, f)).toBe(false)
  })

  it("returns enabled plugin ids", () => {
    expect(getEnabledPluginIds({ order: ["a", "b"], disabled: ["b"] })).toEqual(["a"])
  })

  it("loads default auto-update interval when missing", async () => {
    await expect(loadAutoUpdateInterval()).resolves.toBe(DEFAULT_AUTO_UPDATE_INTERVAL)
  })

  it("loads stored auto-update interval", async () => {
    storeState.set("autoUpdateInterval", 30)
    await expect(loadAutoUpdateInterval()).resolves.toBe(30)
  })

  it("saves auto-update interval", async () => {
    await saveAutoUpdateInterval(5)
    await expect(loadAutoUpdateInterval()).resolves.toBe(5)
  })

  it("loads default theme mode when missing", async () => {
    await expect(loadThemeMode()).resolves.toBe(DEFAULT_THEME_MODE)
  })

  it("loads stored theme mode", async () => {
    storeState.set("themeMode", "dark")
    await expect(loadThemeMode()).resolves.toBe("dark")
  })

  it("loads stored glass theme mode", async () => {
    storeState.set("themeMode", "glass")
    await expect(loadThemeMode()).resolves.toBe("glass")
  })

  it("saves theme mode", async () => {
    await saveThemeMode("light")
    await expect(loadThemeMode()).resolves.toBe("light")
  })

  it("falls back to default for invalid theme mode", async () => {
    storeState.set("themeMode", "invalid")
    await expect(loadThemeMode()).resolves.toBe(DEFAULT_THEME_MODE)
  })

  it("loads default display mode when missing", async () => {
    await expect(loadDisplayMode()).resolves.toBe(DEFAULT_DISPLAY_MODE)
  })

  it("loads stored display mode", async () => {
    storeState.set("displayMode", "left")
    await expect(loadDisplayMode()).resolves.toBe("left")
  })

  it("saves display mode", async () => {
    await saveDisplayMode("left")
    await expect(loadDisplayMode()).resolves.toBe("left")
  })

  it("falls back to default for invalid display mode", async () => {
    storeState.set("displayMode", "invalid")
    await expect(loadDisplayMode()).resolves.toBe(DEFAULT_DISPLAY_MODE)
  })

  it("loads default reset timer display mode when missing", async () => {
    await expect(loadResetTimerDisplayMode()).resolves.toBe(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  })

  it("loads stored reset timer display mode", async () => {
    storeState.set("resetTimerDisplayMode", "absolute")
    await expect(loadResetTimerDisplayMode()).resolves.toBe("absolute")
  })

  it("saves reset timer display mode", async () => {
    await saveResetTimerDisplayMode("relative")
    await expect(loadResetTimerDisplayMode()).resolves.toBe("relative")
  })

  it("falls back to default for invalid reset timer display mode", async () => {
    storeState.set("resetTimerDisplayMode", "invalid")
    await expect(loadResetTimerDisplayMode()).resolves.toBe(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  })

  it("loads default time format mode when missing", async () => {
    await expect(loadTimeFormatMode()).resolves.toBe(DEFAULT_TIME_FORMAT_MODE)
  })

  it("loads stored time format mode", async () => {
    storeState.set("timeFormatMode", "24h")
    await expect(loadTimeFormatMode()).resolves.toBe("24h")
  })

  it("saves time format mode", async () => {
    await saveTimeFormatMode("12h")
    await expect(loadTimeFormatMode()).resolves.toBe("12h")
  })

  it("falls back to default for invalid time format mode", async () => {
    storeState.set("timeFormatMode", "invalid")
    await expect(loadTimeFormatMode()).resolves.toBe(DEFAULT_TIME_FORMAT_MODE)
  })

  it("migrates and removes legacy tray settings keys", async () => {
    storeState.set("trayIconStyle", "provider")
    storeState.set("trayShowPercentage", false)

    await migrateLegacyTraySettings()

    expect(storeState.has("trayIconStyle")).toBe(false)
    expect(storeState.has("trayShowPercentage")).toBe(false)
  })

  it("migrates legacy trayIconStyle=bars to menubarIconStyle=bars when new key not set", async () => {
    storeState.set("trayIconStyle", "bars")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("bars")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("does not overwrite menubarIconStyle when already set during legacy migration", async () => {
    storeState.set("trayIconStyle", "bars")
    storeState.set("menubarIconStyle", "provider")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("provider")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("migrates legacy trayIconStyle=circle to menubarIconStyle=donut when new key not set", async () => {
    storeState.set("trayIconStyle", "circle")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("donut")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("does not set menubarIconStyle when legacy trayIconStyle is non-bars", async () => {
    storeState.set("trayIconStyle", "provider")

    await migrateLegacyTraySettings()

    expect(storeState.has("menubarIconStyle")).toBe(false)
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("loads default menubar icon style when missing", async () => {
    await expect(loadMenubarIconStyle()).resolves.toBe(DEFAULT_MENUBAR_ICON_STYLE)
  })

  it("loads stored menubar icon style", async () => {
    storeState.set("menubarIconStyle", "bars")
    await expect(loadMenubarIconStyle()).resolves.toBe("bars")
  })

  it("saves menubar icon style", async () => {
    await saveMenubarIconStyle("bars")
    await expect(loadMenubarIconStyle()).resolves.toBe("bars")
  })

  it("loads stored menubar donut icon style", async () => {
    storeState.set("menubarIconStyle", "donut")
    await expect(loadMenubarIconStyle()).resolves.toBe("donut")
  })

  it("saves menubar donut icon style", async () => {
    await saveMenubarIconStyle("donut")
    await expect(loadMenubarIconStyle()).resolves.toBe("donut")
  })

  it("loads and saves logo-based menubar icon styles", async () => {
    storeState.set("menubarIconStyle", "logoBar")
    await expect(loadMenubarIconStyle()).resolves.toBe("logoBar")

    await saveMenubarIconStyle("logoGrid")
    await expect(loadMenubarIconStyle()).resolves.toBe("logoGrid")
  })

  it("falls back to default for invalid menubar icon style", async () => {
    storeState.set("menubarIconStyle", "invalid")
    await expect(loadMenubarIconStyle()).resolves.toBe(DEFAULT_MENUBAR_ICON_STYLE)
  })

  it("loads default menubar weekly limit preference when missing", async () => {
    await expect(loadPreferMenubarWeeklyLimit()).resolves.toBe(
      DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT
    )
  })

  it("loads stored menubar weekly limit preference", async () => {
    storeState.set("preferMenubarWeeklyLimit", true)
    await expect(loadPreferMenubarWeeklyLimit()).resolves.toBe(true)
  })

  it("saves menubar weekly limit preference", async () => {
    await savePreferMenubarWeeklyLimit(true)
    await expect(loadPreferMenubarWeeklyLimit()).resolves.toBe(true)
  })

  it("skips legacy tray migration when keys are absent", async () => {
    await expect(migrateLegacyTraySettings()).resolves.toBeUndefined()
    expect(storeState.has("trayIconStyle")).toBe(false)
    expect(storeState.has("trayShowPercentage")).toBe(false)
    expect(storeDeleteMock).not.toHaveBeenCalled()
    expect(storeSaveMock).not.toHaveBeenCalled()
  })

  it("migrates when only one legacy tray key is present", async () => {
    storeState.set("trayShowPercentage", true)

    await migrateLegacyTraySettings()

    expect(storeState.has("trayShowPercentage")).toBe(false)
    expect(storeDeleteMock).toHaveBeenCalledWith("trayShowPercentage")
    expect(storeSaveMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to nulling legacy keys if delete is unavailable", async () => {
    const { LazyStore } = await import("@tauri-apps/plugin-store")
    const prototype = LazyStore.prototype as { delete?: (key: string) => Promise<void> }
    const originalDelete = prototype.delete

    // Simulate older store implementation with no delete() method.
    prototype.delete = undefined
    storeState.set("trayIconStyle", "provider")

    try {
      await migrateLegacyTraySettings()
    } finally {
      prototype.delete = originalDelete
    }

    expect(storeDeleteMock).not.toHaveBeenCalled()
    expect(storeState.get("trayIconStyle")).toBeNull()
    expect(storeSaveMock).toHaveBeenCalledTimes(1)
  })

  it("loads default global shortcut when missing", async () => {
    await expect(loadGlobalShortcut()).resolves.toBe(DEFAULT_GLOBAL_SHORTCUT)
  })

  it("loads stored global shortcut values", async () => {
    storeState.set("globalShortcut", "CommandOrControl+Shift+O")
    await expect(loadGlobalShortcut()).resolves.toBe("CommandOrControl+Shift+O")

    storeState.set("globalShortcut", null)
    await expect(loadGlobalShortcut()).resolves.toBe(null)
  })

  it("falls back to default for invalid global shortcut values", async () => {
    storeState.set("globalShortcut", 1234)
    await expect(loadGlobalShortcut()).resolves.toBe(DEFAULT_GLOBAL_SHORTCUT)
  })

  it("saves global shortcut values", async () => {
    await saveGlobalShortcut("CommandOrControl+Shift+O")
    await expect(loadGlobalShortcut()).resolves.toBe("CommandOrControl+Shift+O")
  })

  it("loads default start on login when missing", async () => {
    await expect(loadStartOnLogin()).resolves.toBe(DEFAULT_START_ON_LOGIN)
  })

  it("loads stored start on login value", async () => {
    storeState.set("startOnLogin", true)
    await expect(loadStartOnLogin()).resolves.toBe(true)
  })

  it("saves start on login value", async () => {
    await saveStartOnLogin(true)
    await expect(loadStartOnLogin()).resolves.toBe(true)
  })

  it("falls back to default for invalid start on login value", async () => {
    storeState.set("startOnLogin", "invalid")
    await expect(loadStartOnLogin()).resolves.toBe(DEFAULT_START_ON_LOGIN)
  })

  describe("isUsageAlertThreshold", () => {
    it("returns true for valid thresholds", () => {
      expect(isUsageAlertThreshold(10)).toBe(true)
      expect(isUsageAlertThreshold(20)).toBe(true)
      expect(isUsageAlertThreshold(30)).toBe(true)
      expect(isUsageAlertThreshold("custom")).toBe(true)
    })

    it("returns false for invalid thresholds", () => {
      expect(isUsageAlertThreshold(25)).toBe(false)
      expect(isUsageAlertThreshold(0)).toBe(false)
      expect(isUsageAlertThreshold(-1)).toBe(false)
      expect(isUsageAlertThreshold("bad")).toBe(false)
      expect(isUsageAlertThreshold(null)).toBe(false)
    })
  })

  describe("loadUsageAlertEnabled / saveUsageAlertEnabled", () => {
    it("loads default when missing", async () => {
      await expect(loadUsageAlertEnabled()).resolves.toBe(DEFAULT_USAGE_ALERT_ENABLED)
    })

    it("round-trips true/false", async () => {
      await saveUsageAlertEnabled(true)
      await expect(loadUsageAlertEnabled()).resolves.toBe(true)

      await saveUsageAlertEnabled(false)
      await expect(loadUsageAlertEnabled()).resolves.toBe(false)
    })
  })

  describe("loadUsageAlertThreshold / saveUsageAlertThreshold", () => {
    it("loads default when missing", async () => {
      await expect(loadUsageAlertThreshold()).resolves.toBe(DEFAULT_USAGE_ALERT_THRESHOLD)
    })

    it("falls back to default for invalid stored value", async () => {
      storeState.set(USAGE_ALERT_THRESHOLD_KEY, "invalid")
      await expect(loadUsageAlertThreshold()).resolves.toBe(DEFAULT_USAGE_ALERT_THRESHOLD)
    })

    it("round-trips", async () => {
      await saveUsageAlertThreshold(10)
      await expect(loadUsageAlertThreshold()).resolves.toBe(10)

      await saveUsageAlertThreshold("custom")
      await expect(loadUsageAlertThreshold()).resolves.toBe("custom")
    })
  })

  describe("loadUsageAlertCustomThreshold / saveUsageAlertCustomThreshold", () => {
    it("loads default when missing", async () => {
      await expect(loadUsageAlertCustomThreshold()).resolves.toBe(DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD)
    })

    it("falls back to default for out-of-range stored values", async () => {
      storeState.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, 0)
      await expect(loadUsageAlertCustomThreshold()).resolves.toBe(DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD)

      storeState.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, -1)
      await expect(loadUsageAlertCustomThreshold()).resolves.toBe(DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD)

      storeState.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, 100)
      await expect(loadUsageAlertCustomThreshold()).resolves.toBe(DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD)
    })

    it("loads valid stored values", async () => {
      storeState.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, 1)
      await expect(loadUsageAlertCustomThreshold()).resolves.toBe(1)

      storeState.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, 99)
      await expect(loadUsageAlertCustomThreshold()).resolves.toBe(99)
    })

    it("clamps on save", async () => {
      await saveUsageAlertCustomThreshold(0)
      expect(storeState.get(USAGE_ALERT_CUSTOM_THRESHOLD_KEY)).toBe(1)

      await saveUsageAlertCustomThreshold(100)
      expect(storeState.get(USAGE_ALERT_CUSTOM_THRESHOLD_KEY)).toBe(99)

      await saveUsageAlertCustomThreshold(1.7)
      expect(storeState.get(USAGE_ALERT_CUSTOM_THRESHOLD_KEY)).toBe(2)
    })

    it("deletes key when saving null", async () => {
      storeState.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, 12)
      await saveUsageAlertCustomThreshold(null)
      expect(storeState.has(USAGE_ALERT_CUSTOM_THRESHOLD_KEY)).toBe(false)
      expect(storeDeleteMock).toHaveBeenCalledWith(USAGE_ALERT_CUSTOM_THRESHOLD_KEY)
    })
  })

  describe("loadUsageAlertSound / saveUsageAlertSound", () => {
    it("loads default when missing", async () => {
      await expect(loadUsageAlertSound()).resolves.toBe(DEFAULT_USAGE_ALERT_SOUND)
    })

    it("falls back to default for invalid stored value", async () => {
      storeState.set(USAGE_ALERT_SOUND_KEY, "invalid")
      await expect(loadUsageAlertSound()).resolves.toBe(DEFAULT_USAGE_ALERT_SOUND)
    })

    it("round-trips", async () => {
      await saveUsageAlertSound("Basso")
      await expect(loadUsageAlertSound()).resolves.toBe("Basso")
    })
  })

  describe("resolveOnboardingComplete", () => {
    const pluginSettings = { order: ["cursor"], disabled: [] as string[] }

    it("returns false when dualUiOnboardingVersion is missing", async () => {
      await expect(resolveOnboardingComplete(pluginSettings, "1.1.0")).resolves.toBe(false)
    })

    it("returns false when stored version differs from app version", async () => {
      storeState.set("dualUiOnboardingVersion", "1.0.0")
      await expect(resolveOnboardingComplete(pluginSettings, "1.1.0")).resolves.toBe(false)
    })

    it("returns true when stored version matches app version", async () => {
      storeState.set("dualUiOnboardingVersion", "1.1.0")
      await expect(resolveOnboardingComplete(pluginSettings, "1.1.0")).resolves.toBe(true)
    })
  })
})
