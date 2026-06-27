import { describe, expect, it } from "vitest"
import { buildMenuBarContent } from "@/lib/menu-bar-content"
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

describe("buildMenuBarContent", () => {
  it("builds bars in pin order and hides disabled providers", () => {
    const session = metricId("claude", "Session")
    const weekly = metricId("claude", "Weekly")
    const bars = buildMenuBarContent({
      pinnedMetricIds: [weekly, session],
      pluginsMeta: [claudeMeta],
      pluginSettings: settings,
      pluginStates: {
        claude: {
          data: {
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 40,
                limit: 100,
                format: { kind: "percent" },
              },
              {
                type: "progress",
                label: "Weekly",
                used: 70,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      displayMode: "left",
    })
    expect(bars).toHaveLength(1)
    expect(bars[0]?.id).toBe("claude")
    expect(bars[0]?.items.map((i) => i.label)).toEqual(["Weekly", "Session"])
  })

  it("omits disabled provider pins", () => {
    const bars = buildMenuBarContent({
      pinnedMetricIds: [metricId("claude", "Session")],
      pluginsMeta: [claudeMeta],
      pluginSettings: { ...settings, disabled: ["claude"] },
      pluginStates: {
        claude: {
          data: {
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 10,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      displayMode: "left",
    })
    expect(bars).toEqual([])
  })
})
