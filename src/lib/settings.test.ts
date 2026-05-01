import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_TIME_FORMAT_MODE,
  arePluginSettingsEqual,
  getBaseProviderId,
  getEnabledPluginIds,
  getProviderDisplayName,
  getProviderInstanceMeta,
  loadAutoUpdateInterval,
  loadDisplayMode,
  loadGlobalShortcut,
  loadMenubarIconStyle,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadTimeFormatMode,
  migrateLegacyTraySettings,
  loadThemeMode,
  normalizePluginSettings,
  resolveOnboardingComplete,
  saveAutoUpdateInterval,
  saveDisplayMode,
  saveGlobalShortcut,
  saveMenubarIconStyle,
  savePluginSettings,
  saveResetTimerDisplayMode,
  saveStartOnLogin,
  saveThemeMode,
  loadPersistUsageHistory,
  savePersistUsageHistory,
  saveTimeFormatMode,
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
      { id: "a", name: "A", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "b", name: "B", iconUrl: "", lines: [], primaryCandidates: [] },
    ]
    const normalized = normalizePluginSettings(
      { order: ["b", "b", "c"], disabled: ["c", "a"], trayLines: { "a": ["x"], "c": ["y"] } },
      plugins
    )
    expect(normalized).toEqual({
      order: ["b", "a"],
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

    expect(normalized.order).toEqual(["claude:personal", "cursor", "claude:work", "claude"])
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

  it("auto-disables new non-default plugins", () => {
    const plugins: PluginMeta[] = [
      { id: "claude", name: "Claude", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "copilot", name: "Copilot", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "windsurf", name: "Windsurf", iconUrl: "", lines: [], primaryCandidates: [] },
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
    storeState.set("timeFormat", "24h")
    await expect(loadTimeFormatMode()).resolves.toBe("24h")
  })

  it("saves time format mode", async () => {
    await saveTimeFormatMode("12h")
    await expect(loadTimeFormatMode()).resolves.toBe("12h")
  })

  it("falls back to default for invalid time format mode", async () => {
    storeState.set("timeFormat", "invalid")
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

  describe("resolveOnboardingComplete", () => {
    it("returns true when store key is true", async () => {
      storeState.set("onboardingCompleteV1", true)
      await expect(resolveOnboardingComplete(DEFAULT_PLUGIN_SETTINGS)).resolves.toBe(true)
    })

    it("returns false when key missing and no colon instance ids", async () => {
      await expect(resolveOnboardingComplete(DEFAULT_PLUGIN_SETTINGS)).resolves.toBe(false)
    })

    it("migrates and returns true when key missing but multi-account instance ids exist", async () => {
      const settings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        providerInstances: { "claude:work": { baseProviderId: "claude", label: "Work" } },
      }
      await expect(resolveOnboardingComplete(settings)).resolves.toBe(true)
      expect(storeState.get("onboardingCompleteV1")).toBe(true)
    })

    it("returns false when store key is false", async () => {
      storeState.set("onboardingCompleteV1", false)
      await expect(resolveOnboardingComplete(DEFAULT_PLUGIN_SETTINGS)).resolves.toBe(false)
    })
  })

  it("loads persist usage history default false", async () => {
    await expect(loadPersistUsageHistory()).resolves.toBe(false)
  })

  it("saves and loads persist usage history", async () => {
    await savePersistUsageHistory(true)
    await expect(loadPersistUsageHistory()).resolves.toBe(true)
    expect(storeState.get("persistUsageHistory")).toBe(true)
  })
})
