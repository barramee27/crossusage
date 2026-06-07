import { describe, expect, it } from "vitest"

import { buildUsageInsights } from "@/lib/usage-insights"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"

const ONE_DAY = 86_400_000

function plugin(overrides: Partial<DisplayPluginState> & { data: DisplayPluginState["data"] }): DisplayPluginState {
  return {
    meta: {
      id: "cursor",
      name: "Cursor",
      iconUrl: "",
      iconFilePath: "",
      primaryCandidates: ["Total usage"],
      lines: [{ type: "progress", label: "Total usage", scope: "overview" }],
    },
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
    ...overrides,
  }
}

describe("buildUsageInsights", () => {
  it("returns empty without settings", () => {
    expect(buildUsageInsights({ plugins: [], pluginSettings: null })).toEqual([])
  })

  it("flags behind pace on primary percent line", () => {
    const nowMs = Date.now()
    const periodDurationMs = ONE_DAY * 7
    const resetsAt = new Date(nowMs + ONE_DAY * 3).toISOString()
    const rows = buildUsageInsights({
      plugins: [
        plugin({
          data: {
            providerId: "cursor",
            displayName: "Cursor",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Total usage",
                used: 80,
                limit: 100,
                format: { kind: "percent" },
                resetsAt,
                periodDurationMs,
              },
            ],
          },
        }),
      ],
      pluginSettings: { order: ["cursor"], disabled: [] },
      nowMs,
    })
    expect(rows.some((r) => r.kind === "pace")).toBe(true)
  })

  it("includes tightest percent quota", () => {
    const rows = buildUsageInsights({
      plugins: [
        plugin({
          data: {
            providerId: "cursor",
            displayName: "Cursor",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Total usage",
                used: 95,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
        }),
      ],
      pluginSettings: { order: ["cursor"], disabled: [] },
    })
    expect(rows.some((r) => r.kind === "tight" && r.message.includes("5%"))).toBe(true)
  })
})
