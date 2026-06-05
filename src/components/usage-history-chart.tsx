import { useMemo } from "react"
import type { UsageHistoryRow } from "@/lib/usage-history"
import {
  UsageInteractiveChart,
  type InteractiveChartSeries,
} from "@/components/usage-interactive-chart"
import { cn } from "@/lib/utils"

const CHART_STROKES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function buildSeriesMap(rows: UsageHistoryRow[], instanceFilter: string): Map<string, UsageHistoryRow[]> {
  const filtered =
    instanceFilter === "all" ? rows : rows.filter((r) => r.instanceId === instanceFilter)
  const byId = new Map<string, UsageHistoryRow[]>()
  for (const r of filtered) {
    const list = byId.get(r.instanceId) ?? []
    list.push(r)
    byId.set(r.instanceId, list)
  }
  for (const list of byId.values()) {
    list.sort((a, b) => a.capturedAtMs - b.capturedAtMs)
  }
  return byId
}

type UsageHistoryChartProps = {
  rows: UsageHistoryRow[]
  instanceFilter: string
  className?: string
}

export function UsageHistoryChart({ rows, instanceFilter, className }: UsageHistoryChartProps) {
  const series = useMemo((): InteractiveChartSeries[] => {
    const map = buildSeriesMap(rows, instanceFilter)
    const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return entries.map(([id, pts], idx) => ({
      id,
      name: pts[0]?.displayName ?? id,
      color: CHART_STROKES[idx % CHART_STROKES.length],
      points: pts.map((r) => ({
        key: String(r.capturedAtMs),
        at: r.capturedAtMs,
        label: new Date(r.capturedAtMs).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        value: Math.max(0, Math.min(100, r.primaryPercent)),
        detail: [
          pts[0]?.displayName ?? id,
          r.plan ? `Plan: ${r.plan}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    }))
  }, [rows, instanceFilter])

  if (rows.length === 0) return null

  const maxPoints = Math.max(...series.map((s) => s.points.length), 0)

  return (
    <div className={cn("space-y-2", className)}>
      {maxPoints < 2 ? (
        <p className="text-xs text-muted-foreground">
          One snapshot so far — refresh again after ~32s for a trend line. Hover the point for details.
        </p>
      ) : null}
      <UsageInteractiveChart
        series={series}
        mode="line"
        yMax={100}
        yFormat={(v) => `${v.toFixed(1)}%`}
        emptyMessage="No quota snapshots in this range."
        rangeFilterKey={(key, rangeDays) => {
          if (rangeDays == null) return true
          const ms = Number(key)
          if (!Number.isFinite(ms)) return true
          if (rangeDays === 1) {
            const start = new Date()
            start.setHours(0, 0, 0, 0)
            return ms >= start.getTime()
          }
          const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000
          return ms >= cutoff
        }}
      />
    </div>
  )
}

export function usageHistoryInstanceOptions(rows: UsageHistoryRow[]): string[] {
  const ids = [...new Set(rows.map((r) => r.instanceId))]
  ids.sort((a, b) => a.localeCompare(b))
  return ids
}
