import { useMemo } from "react"
import type { UsageHistoryRow } from "@/lib/usage-history"
import { cn } from "@/lib/utils"

const CHART_STROKES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

const VB_W = 400
const VB_H = 120
const PAD_X = 16
const PAD_Y = 10

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
  /** `"all"` or a specific `instanceId`. */
  instanceFilter: string
  className?: string
}

/** Line chart of `primaryPercent` over time (oldest → newest left → right). */
export function UsageHistoryChart({ rows, instanceFilter, className }: UsageHistoryChartProps) {
  const seriesMap = useMemo(() => buildSeriesMap(rows, instanceFilter), [rows, instanceFilter])

  const { polylines, tMin, tMax, legend } = useMemo(() => {
    const allPoints = [...seriesMap.values()].flat()
    if (allPoints.length === 0) {
      return {
        polylines: [] as { id: string; points: string; stroke: string }[],
        tMin: 0,
        tMax: 1,
        legend: [] as { id: string; stroke: string }[],
      }
    }
    const times = allPoints.map((r) => r.capturedAtMs)
    const t0 = Math.min(...times)
    const t1 = Math.max(...times)
    const span = Math.max(1, t1 - t0)

    const entries = [...seriesMap.entries()].filter(([, pts]) => pts.length >= 1)
    entries.sort((a, b) => a[0].localeCompare(b[0]))

    const polylines: { id: string; points: string; stroke: string }[] = []
    const legend: { id: string; stroke: string }[] = []

    entries.forEach(([id, pts], idx) => {
      const stroke = CHART_STROKES[idx % CHART_STROKES.length]
      legend.push({ id, stroke })
      const xy = pts.map((r) => {
        const x = PAD_X + ((r.capturedAtMs - t0) / span) * (VB_W - 2 * PAD_X)
        const pct = Math.max(0, Math.min(100, r.primaryPercent))
        const y = VB_H - PAD_Y - (pct / 100) * (VB_H - 2 * PAD_Y)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      polylines.push({ id, points: xy.join(" "), stroke })
    })

    return { polylines, tMin: t0, tMax: t1, legend }
  }, [seriesMap])

  if (rows.length === 0) {
    return null
  }

  const maxPoints = Math.max(...[...seriesMap.values()].map((p) => p.length), 0)
  if (maxPoints < 2) {
    return (
      <div className={cn("rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground", className)}>
        Chart needs at least two samples for one account (debounce is ~32s between saves). Refresh again later.
      </div>
    )
  }

  return (
    <div className={cn("rounded-md border border-border bg-muted/20 p-3", className)}>
      <p className="text-xs text-foreground/80 mb-2">
        Primary % over time (oldest left, newest right). Same metric as the table’s bold %.
      </p>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-[140px]"
        role="img"
        aria-label="Usage history primary percent chart"
      >
        {/* Baseline only — a mid-chart horizontal rule looked like a stray “black line” in dark mode. */}
        <line
          x1={PAD_X}
          y1={VB_H - PAD_Y}
          x2={VB_W - PAD_X}
          y2={VB_H - PAD_Y}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <g className="fill-foreground/75">
          <text x={PAD_X} y={PAD_Y - 1} fontSize="10">
            100%
          </text>
          <text x={PAD_X} y={VB_H - PAD_Y + 11} fontSize="10">
            {new Date(tMin).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </text>
          <text x={VB_W - PAD_X} y={VB_H - PAD_Y + 11} fontSize="10" textAnchor="end">
            {new Date(tMax).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </text>
        </g>
        {polylines.map((pl) => (
          <polyline
            key={pl.id}
            fill="none"
            stroke={pl.stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={pl.points}
          />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/85">
        {legend.map((L) => (
          <span key={L.id} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: L.stroke }} aria-hidden />
            <span className="font-mono">{L.id}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function usageHistoryInstanceOptions(rows: UsageHistoryRow[]): string[] {
  const ids = [...new Set(rows.map((r) => r.instanceId))]
  ids.sort((a, b) => a.localeCompare(b))
  return ids
}
