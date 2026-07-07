import { describe, expect, it } from "vitest"
import {
  applyDashboardMetricToggle,
  applyProviderDashboardMetrics,
  canPinMetric,
  countPinsForProvider,
  migrateModernPlacedToTrayLines,
  pinnedIdsFromTrayLines,
  placedIdsFromPluginSettings,
  providerOrderFromPluginSettings,
  MAX_PINS_PER_PROVIDER,
} from "@/lib/modern-layout"
import { metricId } from "@/lib/metric-id"
import type { MetricDescriptor } from "@/lib/metric-registry"
import type { PluginSettings } from "@/lib/settings"

const cursorTotal = metricId("cursor", "Total usage")
const cursorAuto = metricId("cursor", "Auto usage")
const claudeSession = metricId("claude", "Session")

function desc(pluginId: string, lineLabel: string): MetricDescriptor {
  return {
    id: metricId(pluginId, lineLabel),
    pluginId,
    lineLabel,
    manifest: { type: "progress", label: lineLabel, scope: "detail" },
    displayName: pluginId,
    bounded: true,
  }
}

const baseSettings: PluginSettings = {
  order: ["cursor", "claude"],
  disabled: [],
  trayLines: {},
  providerInstances: {},
}

describe("modern-layout pins", () => {
  it("caps pins at two per provider", () => {
    const a = metricId("claude", "Session")
    const b = metricId("claude", "Weekly")
    const c = metricId("claude", "Extra")
    expect(canPinMetric([], a)).toBe(true)
    expect(canPinMetric([a], b)).toBe(true)
    expect(canPinMetric([a, b], c)).toBe(false)
    expect(countPinsForProvider([a, b], "claude")).toBe(2)
    expect(MAX_PINS_PER_PROVIDER).toBe(2)
  })

  it("allows unpinning and re-pinning", () => {
    const a = metricId("cursor", "Auto usage")
    const b = metricId("cursor", "API usage")
    const c = metricId("cursor", "Total usage")
    const pinned = [a, b]
    expect(canPinMetric(pinned, c)).toBe(false)
    expect(canPinMetric([a], c)).toBe(true)
  })

  it("migrates legacy tray lines respecting per-provider cap", () => {
    const ids = pinnedIdsFromTrayLines({
      claude: ["Session", "Weekly", "Extra"],
      codex: ["Session"],
    })
    expect(ids).toEqual([
      metricId("claude", "Session"),
      metricId("claude", "Weekly"),
      metricId("codex", "Session"),
    ])
  })

  it("skips __NONE__ tray lines", () => {
    expect(pinnedIdsFromTrayLines({ cursor: ["__NONE__"] })).toEqual([])
  })
})

describe("classic ↔ modern dashboard sync", () => {
  const descriptors = [
    desc("cursor", "Total usage"),
    desc("cursor", "Auto usage"),
    desc("claude", "Session"),
  ]

  it("places all metrics when trayLines unset (Classic provider detail default)", () => {
    const ids = placedIdsFromPluginSettings(baseSettings, descriptors)
    expect(ids).toEqual([cursorTotal, cursorAuto, claudeSession])
  })

  it("places only explicit tray lines", () => {
    const settings = {
      ...baseSettings,
      trayLines: { cursor: ["Total usage"] },
    }
    expect(placedIdsFromPluginSettings(settings, descriptors)).toEqual([
      cursorTotal,
      claudeSession,
    ])
  })

  it("provider order follows pluginSettings.order", () => {
    expect(providerOrderFromPluginSettings(baseSettings, descriptors)).toEqual([
      "cursor",
      "claude",
    ])
  })

  it("places metrics for provider account instances", () => {
    const workCredits = metricId("cursor:work", "Total usage")
    const workDescriptors = [
      desc("cursor", "Total usage"),
      desc("cursor:work", "Total usage"),
    ]
    const settings = {
      ...baseSettings,
      order: ["cursor", "cursor:work"],
      providerInstances: {
        "cursor:work": { baseProviderId: "cursor", label: "Work" },
      },
    }
    expect(placedIdsFromPluginSettings(settings, workDescriptors)).toEqual([
      cursorTotal,
      workCredits,
    ])
  })

  it("toggle off one metric when all were visible sets explicit trayLines", () => {
    const next = applyDashboardMetricToggle(
      baseSettings,
      "cursor",
      "Auto usage",
      false,
      ["Total usage", "Auto usage"],
    )
    expect(next.trayLines?.cursor).toEqual(["Total usage"])
  })

  it("show all clears trayLines entry", () => {
    const settings = {
      ...baseSettings,
      trayLines: { cursor: ["Total usage"] },
    }
    const next = applyProviderDashboardMetrics(
      settings,
      "cursor",
      ["Total usage", "Auto usage"],
      true,
    )
    expect(next.trayLines?.cursor).toBeUndefined()
  })

  it("migrates legacy modern placedMetricIds into trayLines", () => {
    const next = migrateModernPlacedToTrayLines(baseSettings, [cursorTotal, claudeSession])
    expect(next.trayLines).toEqual({
      cursor: ["Total usage"],
      claude: ["Session"],
    })
  })
})
