import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
}))

vi.mock("@aptabase/tauri", () => ({
  trackEvent: (...args: unknown[]) => state.trackEventMock(...args),
}))

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: state.isTauriMock,
}))

describe("analytics track", () => {
  beforeEach(() => {
    vi.resetModules()
    state.trackEventMock.mockReset()
    state.isTauriMock.mockReset()
    state.isTauriMock.mockReturnValue(true)
  })

  it("does nothing when not running in tauri", async () => {
    state.isTauriMock.mockReturnValue(false)
    const { track } = await import("./analytics")

    track("setting_changed", { setting: "theme", value: "dark" })

    expect(state.trackEventMock).not.toHaveBeenCalled()
  })

  it("tracks all events when running in tauri", async () => {
    const { track } = await import("./analytics")

    track("setting_changed", { setting: "theme", value: "dark" })
    track("setting_changed", { setting: "theme", value: "dark" })

    expect(state.trackEventMock).toHaveBeenCalledTimes(2)
    expect(state.trackEventMock).toHaveBeenCalledWith("setting_changed", {
      setting: "theme",
      value: "dark",
    })
  })
})
