import type { BarChartPoint } from "@/lib/plugin-types"
import type { UsageDailyRow } from "@/lib/usage-daily"
import type { WeeklyRollupWindow } from "@/lib/weekly-rollup"

function shortDayLabel(dayKey: string): string {
  const parts = dayKey.split("-")
  if (parts.length !== 3) return dayKey
  return `${Number(parts[1])}/${Number(parts[2])}`
}

function formatTokenLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Sum tokens across all accounts per calendar day within the window. */
export function buildAggregatedSparklinePoints(
  rows: UsageDailyRow[],
  window: WeeklyRollupWindow,
): BarChartPoint[] {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    if (row.dayKey < window.startDay || row.dayKey > window.endDay) continue
    const tokens = row.totalTokens ?? 0
    byDay.set(row.dayKey, (byDay.get(row.dayKey) ?? 0) + tokens)
  }
  const sorted = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return sorted.map(([dayKey, value]) => ({
    label: shortDayLabel(dayKey),
    value,
    valueLabel: `${formatTokenLabel(value)} tokens`,
  }))
}

export function countDistinctDaysInWindow(
  rows: UsageDailyRow[],
  window: WeeklyRollupWindow,
): number {
  const days = new Set<string>()
  for (const row of rows) {
    if (row.dayKey >= window.startDay && row.dayKey <= window.endDay) {
      days.add(row.dayKey)
    }
  }
  return days.size
}
