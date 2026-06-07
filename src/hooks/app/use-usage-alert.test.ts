import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginOutput } from "@/lib/plugin-types"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

const { sendNotificationAsync } = vi.hoisted(() => ({
  sendNotificationAsync: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/notification", () => ({
  sendNotificationAsync,
}))

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}))

import { useUsageAlert } from "@/hooks/app/use-usage-alert"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function makeOutput(overrides: Partial<PluginOutput> = {}): PluginOutput {
  const resetsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  return {
    providerId: "cursor",
    displayName: "Cursor",
    lines: [
      {
        type: "progress",
        label: "Total usage",
        used: 80,
        limit: 100,
        format: { kind: "percent" },
        resetsAt,
        periodDurationMs: WEEK_MS,
      },
    ],
    iconUrl: "icon",
    ...overrides,
  }
}

describe("useUsageAlert", () => {
  beforeEach(() => {
    sendNotificationAsync.mockClear()
    useAppPreferencesStore.getState().resetState()
    useAppPluginStore.getState().resetState()

    useAppPreferencesStore.getState().setUsageAlertEnabled(true)
    useAppPreferencesStore.getState().setUsageAlertThreshold(20)
    useAppPreferencesStore.getState().setUsagePaceAlertEnabled(true)

    useAppPluginStore.getState().setPluginsMeta([
      {
        id: "cursor",
        name: "Cursor",
        iconUrl: "icon",
        iconFilePath: "/icon.png",
        brandColor: "#000",
        lines: [{ type: "progress", label: "Total usage", scope: "overview" }],
        primaryCandidates: ["Total usage"],
      },
    ])
    useAppPluginStore.getState().setPluginSettings({
      order: ["cursor"],
      disabled: [],
    })
  })

  it("sends low-remaining alert on primary progress line", () => {
    const { result } = renderHook(() => useUsageAlert())
    result.current.checkUsageAlert(makeOutput())

    expect(sendNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Less than 20% remaining on Cursor (Total usage)"),
      }),
    )
  })

  it("sends pace-behind alert when projected to exceed limit before reset", () => {
    const { result } = renderHook(() => useUsageAlert())
    result.current.checkUsageAlert(makeOutput())

    expect(sendNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("projected to run out before reset"),
      }),
    )
  })

  it("skips pace alerts when usagePaceAlertEnabled is false", () => {
    useAppPreferencesStore.getState().setUsagePaceAlertEnabled(false)
    const { result } = renderHook(() => useUsageAlert())
    result.current.checkUsageAlert(makeOutput())

    expect(sendNotificationAsync).toHaveBeenCalledTimes(1)
    expect(sendNotificationAsync.mock.calls[0][0].body).not.toContain("projected to run out")
  })

  it("does nothing when alerts are disabled", () => {
    useAppPreferencesStore.getState().setUsageAlertEnabled(false)
    const { result } = renderHook(() => useUsageAlert())
    result.current.checkUsageAlert(makeOutput())

    expect(sendNotificationAsync).not.toHaveBeenCalled()
  })
})
