import { describe, expect, it } from "vitest"
import {
  canPinMetric,
  countPinsForProvider,
  pinnedIdsFromTrayLines,
  MAX_PINS_PER_PROVIDER,
} from "@/lib/modern-layout"
import { metricId } from "@/lib/metric-id"

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
