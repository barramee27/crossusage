import { describe, expect, it } from "vitest"
import { resolveTrayBarsForLayout } from "@/lib/modern-tray-bars"
import { metricId } from "@/lib/metric-id"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"

const claudeMeta: PluginMeta = {
  id: "claude",
  name: "Claude",
  iconUrl: "/claude.svg",
  brandColor: "#cc785c",
  lines: [
    { type: "progress", label: "Session", scope: "overview" },
    { type: "progress", label: "Weekly", scope: "overview" },
  ],
  primaryCandidates: ["Session"],
}

const settings: PluginSettings = {
  order: ["claude"],
  disabled: [],
  trayLines: {},
}

const claudeState = {
  claude: {
    data: {
      lines: [
        {
          type: "progress" as const,
          label: "Session",
          used: 50,
          limit: 100,
          format: { kind: "percent" as const },
        },
        {
          type: "progress" as const,
          label: "Weekly",
          used: 70,
          limit: 100,
          format: { kind: "percent" as const },
        },
      ],
    },
    loading: false,
    error: null,
  },
}

describe("resolveTrayBarsForLayout", () => {
  it("uses pin bars in modern when pins have probe data", () => {
    const bars = resolveTrayBarsForLayout({
      uiLayout: "modern",
      pinnedMetricIds: [metricId("claude", "Session")],
      pluginsMeta: [claudeMeta],
      pluginSettings: settings,
      pluginStates: claudeState,
      displayMode: "left",
      preferWeeklyLimit: false,
    })
    expect(bars).toHaveLength(1)
    expect(bars[0]?.items[0]?.fraction).toBe(0.5)
  })

  it("uses pins for a single provider when pluginId is set (Plugin/Pie tray icon)", () => {
    const bars = resolveTrayBarsForLayout({
      uiLayout: "modern",
      pinnedMetricIds: [metricId("claude", "Weekly"), metricId("claude", "Session")],
      pluginsMeta: [claudeMeta],
      pluginSettings: settings,
      pluginStates: claudeState,
      displayMode: "left",
      preferWeeklyLimit: false,
      pluginId: "claude",
      maxBars: 2,
    })
    expect(bars).toHaveLength(1)
    expect(bars[0]?.items.map((i) => i.label)).toEqual(["Weekly", "Session"])
  })

  it("falls back to classic tray bars when modern pins are empty", () => {
    const bars = resolveTrayBarsForLayout({
      uiLayout: "modern",
      pinnedMetricIds: [],
      pluginsMeta: [claudeMeta],
      pluginSettings: settings,
      pluginStates: claudeState,
      displayMode: "left",
      preferWeeklyLimit: false,
    })
    expect(bars.length).toBeGreaterThan(0)
  })
})
