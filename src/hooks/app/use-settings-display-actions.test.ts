import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const trackMock = vi.hoisted(() => vi.fn())

const {
  saveDisplayModeMock,
  savePreferMenubarWeeklyLimitMock,
  saveResetTimerDisplayModeMock,
  saveShowAccountIdentityMock,
  saveThemeModeMock,
  saveUIScaleMock,
} = vi.hoisted(() => ({
  saveThemeModeMock: vi.fn(),
  saveDisplayModeMock: vi.fn(),
  savePreferMenubarWeeklyLimitMock: vi.fn(),
  saveResetTimerDisplayModeMock: vi.fn(),
  saveShowAccountIdentityMock: vi.fn(),
  saveUIScaleMock: vi.fn(),
}))

vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}))

vi.mock("@/lib/settings", () => ({
  saveThemeMode: saveThemeModeMock,
  saveDisplayMode: saveDisplayModeMock,
  savePreferMenubarWeeklyLimit: savePreferMenubarWeeklyLimitMock,
  saveResetTimerDisplayMode: saveResetTimerDisplayModeMock,
  saveShowAccountIdentity: saveShowAccountIdentityMock,
  saveUIScale: saveUIScaleMock,
  saveTimeFormatMode: vi.fn(),
  saveUsageAlertEnabled: vi.fn(),
  saveUsageAlertThreshold: vi.fn(),
  saveUsageAlertCustomThreshold: vi.fn(),
  saveUsageAlertSound: vi.fn(),
}))

import { useSettingsDisplayActions } from "@/hooks/app/use-settings-display-actions"

function displayActionsArgs(
  overrides: Partial<Parameters<typeof useSettingsDisplayActions>[0]> = {}
) {
  return {
    setThemeMode: vi.fn(),
    setDisplayMode: vi.fn(),
    resetTimerDisplayMode: "relative" as const,
    setResetTimerDisplayMode: vi.fn(),
    setTimeFormatMode: vi.fn(),
    setShowAccountIdentity: vi.fn(),
    setMenubarIconStyle: vi.fn(),
    setPreferMenubarWeeklyLimit: vi.fn(),
    setUIScale: vi.fn(),
    setUsageAlertEnabled: vi.fn(),
    setUsageAlertThreshold: vi.fn(),
    setCustomUsageAlertThreshold: vi.fn(),
    setUsageAlertSound: vi.fn(),
    scheduleTrayIconUpdate: vi.fn(),
    ...overrides,
  }
}

describe("useSettingsDisplayActions", () => {
  beforeEach(() => {
    saveThemeModeMock.mockReset()
    saveDisplayModeMock.mockReset()
    savePreferMenubarWeeklyLimitMock.mockReset()
    saveResetTimerDisplayModeMock.mockReset()
    saveShowAccountIdentityMock.mockReset()
    saveUIScaleMock.mockReset()
    saveThemeModeMock.mockResolvedValue(undefined)
    saveDisplayModeMock.mockResolvedValue(undefined)
    savePreferMenubarWeeklyLimitMock.mockResolvedValue(undefined)
    saveResetTimerDisplayModeMock.mockResolvedValue(undefined)
    saveShowAccountIdentityMock.mockResolvedValue(undefined)
    saveUIScaleMock.mockResolvedValue(undefined)
  })

  it("applies display-related setting changes", () => {
    const setThemeMode = vi.fn()
    const setDisplayMode = vi.fn()
    const setResetTimerDisplayMode = vi.fn()
    const setPreferMenubarWeeklyLimit = vi.fn()
    const scheduleTrayIconUpdate = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions(
        displayActionsArgs({
          setThemeMode,
          setDisplayMode,
          setResetTimerDisplayMode,
          setPreferMenubarWeeklyLimit,
          scheduleTrayIconUpdate,
        })
      )
    )

    act(() => {
      result.current.handleThemeModeChange("glass")
      result.current.handleDisplayModeChange("used")
      result.current.handleResetTimerDisplayModeChange("absolute")
      result.current.handlePreferMenubarWeeklyLimitChange(true)
    })

    expect(setThemeMode).toHaveBeenCalledWith("glass")
    expect(setDisplayMode).toHaveBeenCalledWith("used")
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("absolute")
    expect(setPreferMenubarWeeklyLimit).toHaveBeenCalledWith(true)
    expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)

    expect(saveThemeModeMock).toHaveBeenCalledWith("glass")
    expect(saveDisplayModeMock).toHaveBeenCalledWith("used")
    expect(saveResetTimerDisplayModeMock).toHaveBeenCalledWith("absolute")
    expect(savePreferMenubarWeeklyLimitMock).toHaveBeenCalledWith(true)
  })

  it("toggles reset timer mode in both directions", () => {
    const setResetTimerDisplayMode = vi.fn()

    const { result, rerender } = renderHook(
      ({ mode }: { mode: "relative" | "absolute" }) =>
        useSettingsDisplayActions(
          displayActionsArgs({
            resetTimerDisplayMode: mode,
            setResetTimerDisplayMode,
          })
        ),
      { initialProps: { mode: "relative" as const } }
    )

    act(() => {
      result.current.handleResetTimerDisplayModeToggle()
    })
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("absolute")

    rerender({ mode: "absolute" })
    act(() => {
      result.current.handleResetTimerDisplayModeToggle()
    })
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("relative")
  })

  it("logs persistence failures", async () => {
    const themeError = new Error("theme failed")
    const displayError = new Error("display failed")
    const resetError = new Error("reset failed")
    const menubarWeeklyError = new Error("menubar weekly failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    saveThemeModeMock.mockRejectedValueOnce(themeError)
    saveDisplayModeMock.mockRejectedValueOnce(displayError)
    saveResetTimerDisplayModeMock.mockRejectedValueOnce(resetError)
    savePreferMenubarWeeklyLimitMock.mockRejectedValueOnce(menubarWeeklyError)

    const { result } = renderHook(() => useSettingsDisplayActions(displayActionsArgs()))

    act(() => {
      result.current.handleThemeModeChange("light")
      result.current.handleDisplayModeChange("left")
      result.current.handleResetTimerDisplayModeChange("relative")
      result.current.handlePreferMenubarWeeklyLimitChange(true)
    })

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Failed to save theme mode:", themeError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to save display mode:", displayError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to save reset timer display mode:", resetError)
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to save menubar weekly limit preference:",
        menubarWeeklyError
      )
    })

    errorSpy.mockRestore()
  })

  it("persists UI scale change", async () => {
    const setUIScale = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions(displayActionsArgs({ setUIScale }))
    )

    act(() => {
      result.current.handleUIScaleChange("compact")
    })

    expect(setUIScale).toHaveBeenCalledWith("compact")

    await waitFor(() => {
      expect(saveUIScaleMock).toHaveBeenCalledWith("compact")
    })
  })
})
