import { describe, expect, it } from "vitest"

import {
  computeRollingRollup,
  computeWeeklyRollup,
  formatWeeklyRollupSummary,
  rollingSevenDayWindows,
} from "@/lib/weekly-rollup"
import type { UsageDailyRow } from "@/lib/usage-daily"

describe("weekly-rollup", () => {
  it("computes rolling 7d windows", () => {
    const now = new Date(2026, 5, 10)
    const w = rollingSevenDayWindows(now)
    expect(w.current.endDay).toBe("2026-06-10")
    expect(w.current.startDay).toBe("2026-06-04")
    expect(w.prior.endDay).toBe("2026-06-03")
    expect(w.prior.startDay).toBe("2026-05-28")
  })

  it("aggregates tokens and delta", () => {
    const now = new Date(2026, 5, 10)
    const rows: UsageDailyRow[] = [
      {
        instanceId: "claude",
        dayKey: "2026-06-10",
        displayName: "Claude",
        totalTokens: 1000,
        inputTokens: null,
        outputTokens: null,
        costUsd: 1,
        source: "ccusage",
        ingestedAtMs: 0,
      },
      {
        instanceId: "claude",
        dayKey: "2026-06-03",
        displayName: "Claude",
        totalTokens: 500,
        inputTokens: null,
        outputTokens: null,
        costUsd: 0.5,
        source: "ccusage",
        ingestedAtMs: 0,
      },
    ]
    const rollup = computeWeeklyRollup(rows, now)
    expect(rollup?.current.totalTokens).toBe(1000)
    expect(rollup?.prior.totalTokens).toBe(500)
    expect(rollup?.tokenDeltaPct).toBe(100)
    expect(formatWeeklyRollupSummary(rollup!)).toContain("This 7d:")
    expect(rollup?.windowDays).toBe(7)
  })

  it("computes 30d rollup", () => {
    const now = new Date(2026, 5, 30)
    const rows: UsageDailyRow[] = Array.from({ length: 10 }, (_, i) => ({
      instanceId: "claude",
      dayKey: `2026-06-${String(21 + i).padStart(2, "0")}`,
      displayName: "Claude",
      totalTokens: 100,
      inputTokens: null,
      outputTokens: null,
      costUsd: 0.1,
      source: "ccusage",
      ingestedAtMs: 0,
    }))
    const rollup = computeRollingRollup(rows, 30, now)
    expect(rollup?.windowDays).toBe(30)
    expect(rollup?.current.totalTokens).toBeGreaterThan(0)
  })
})
