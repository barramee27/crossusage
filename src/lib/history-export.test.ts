import { describe, expect, it } from "vitest"
import {
  buildDailyTokensCsv,
  buildExportSummary,
  buildQuotaHistoryCsv,
  formatUsagePercent,
} from "@/lib/history-export"
import type { UsageDailyRow } from "@/lib/usage-daily"

describe("history-export", () => {
  it("includes BOM, header comments, and extra token columns in daily CSV", () => {
    const rows: UsageDailyRow[] = [
      {
        instanceId: "cursor",
        dayKey: "2026-06-06",
        displayName: "Cursor",
        totalTokens: 338347,
        inputTokens: 200000,
        outputTokens: 138347,
        costUsd: null,
        source: "cursor_transcripts",
        ingestedAtMs: 1,
      },
    ]
    const csv = buildDailyTokensCsv(rows)
    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv).toContain("# CrossUsage daily token export")
    expect(csv).toContain("provider,account_key")
    expect(csv).toContain("2026-06-06,Cursor,cursor,338347,200000,138347,,cursor_transcripts")
    expect(csv).toContain("cursor_transcripts")
  })

  it("summarizes quota history export", () => {
    const csv = buildQuotaHistoryCsv([
      {
        capturedAtMs: Date.parse("2026-06-06T08:00:00.000Z"),
        instanceId: "cursor",
        displayName: "Cursor",
        primaryPercent: 42,
        plan: "Pro",
      },
    ])
    expect(csv).toContain("# rows,1")
    expect(csv).toContain("usage_percent")
    expect(csv).toContain('"42.0"')
    expect(csv).toContain(',"Pro"')
  })

  it("rounds long usage percent floats and quotes cells", () => {
    expect(formatUsagePercent(20.6866666666667)).toBe("20.7")
    const csv = buildQuotaHistoryCsv([
      {
        capturedAtMs: Date.parse("2026-06-06T08:00:00.000Z"),
        instanceId: "cursor",
        displayName: "Cursor",
        primaryPercent: 20.6866666666667,
        plan: "Pro",
      },
    ])
    expect(csv).toContain('"20.7","Pro"')
  })

  it("buildExportSummary explains missing Cursor cost", () => {
    const summary = buildExportSummary(
      [],
      [
        {
          instanceId: "cursor",
          dayKey: "2026-06-06",
          displayName: "Cursor",
          totalTokens: 100,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          source: "cursor_transcripts",
          ingestedAtMs: 1,
        },
      ],
    )
    expect(summary).toContain("cursor_billing")
    expect(summary).toContain("Text to Columns")
  })
})
