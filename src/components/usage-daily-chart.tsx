import { useMemo } from "react"
import type { UsageDailyRow } from "@/lib/usage-daily"
import {
  UsageInteractiveChart,
  formatTokenValue,
  type InteractiveChartSeries,
} from "@/components/usage-interactive-chart"
const CHART_STROKES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function sourceLabel(source: string): string {
  if (source === "cursor_transcripts") return "estimated from agent transcripts"
  if (source === "ccusage") return "from local CLI logs (ccusage)"
  return source
}

function buildSeriesMap(rows: UsageDailyRow[], instanceFilter: string): Map<string, UsageDailyRow[]> {
  const filtered =
    instanceFilter === "all" ? rows : rows.filter((r) => r.instanceId === instanceFilter)
  const byId = new Map<string, UsageDailyRow[]>()
  for (const r of filtered) {
    const list = byId.get(r.instanceId) ?? []
    list.push(r)
    byId.set(r.instanceId, list)
  }
  for (const list of byId.values()) {
    list.sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  }
  return byId
}

type UsageDailyChartProps = {
  rows: UsageDailyRow[]
  instanceFilter: string
  className?: string
}

export function UsageDailyChart({ rows, instanceFilter, className }: UsageDailyChartProps) {
  const series = useMemo((): InteractiveChartSeries[] => {
    const map = buildSeriesMap(rows, instanceFilter)
    const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return entries.map(([id, pts], idx) => ({
      id,
      name: pts[0]?.displayName ?? id,
      color: CHART_STROKES[idx % CHART_STROKES.length],
      points: pts.map((r) => ({
        key: r.dayKey,
        label: formatDayLabel(r.dayKey),
        value: r.totalTokens ?? 0,
        detail: [
          sourceLabel(r.source),
          r.costUsd != null ? `~$${r.costUsd.toFixed(2)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    }))
  }, [rows, instanceFilter])

  return (
    <UsageInteractiveChart
      className={className}
      series={series}
      mode="bar"
      yFormat={formatTokenValue}
      defaultRange="7"
      rangeOptions={["1", "7", "14", "30", "all"]}
      emptyMessage="No daily token history yet — enable snapshots and refresh Claude, Codex, or Cursor."
    />
  )
}

function formatDayLabel(dayKey: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (dayKey === today) return `Today (${dayKey})`
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = yesterday.toISOString().slice(0, 10)
  if (dayKey === yesterdayKey) return `Yesterday (${dayKey})`
  const [y, m, d] = dayKey.split("-").map(Number)
  if (!y || !m || !d) return dayKey
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: y !== new Date().getFullYear() ? "numeric" : undefined,
  })
}

export function usageDailyInstanceOptions(rows: UsageDailyRow[]): string[] {
  const ids = new Set<string>()
  for (const r of rows) {
    ids.add(r.instanceId)
  }
  return Array.from(ids).sort()
}
