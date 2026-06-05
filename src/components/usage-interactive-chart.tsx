import { useCallback, useMemo, useRef, useState } from "react"
import { cn, formatCountNumber } from "@/lib/utils"

export type InteractiveChartPoint = {
  key: string
  label: string
  value: number
  detail?: string
  /** Epoch ms — when set on line charts, points share a real time axis. */
  at?: number
}

export type InteractiveChartSeries = {
  id: string
  name: string
  color: string
  points: InteractiveChartPoint[]
}

export type ChartRangeKey = "1" | "7" | "14" | "30" | "all"

const DEFAULT_RANGE_OPTIONS: ChartRangeKey[] = ["1", "7", "14", "30", "all"]

const VB_W = 480
const VB_H = 160
const PAD_X = 20
const PAD_Y = 16

type UsageInteractiveChartProps = {
  series: InteractiveChartSeries[]
  mode: "line" | "bar"
  yMax?: number
  yFormat?: (value: number) => string
  emptyMessage?: string
  className?: string
  /** Override range filtering (e.g. quota snapshots keyed by epoch ms). */
  rangeFilterKey?: (key: string, rangeDays: number | null) => boolean
  /** Default selected range button. */
  defaultRange?: ChartRangeKey
  /** Which range buttons to show (e.g. daily chart includes 1d). */
  rangeOptions?: ChartRangeKey[]
}

function todayDayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function filterByRange(
  points: InteractiveChartPoint[],
  range: ChartRangeKey,
  rangeFilterKey?: UsageInteractiveChartProps["rangeFilterKey"]
): InteractiveChartPoint[] {
  if (range === "all" || points.length === 0) return points
  if (range === "1") {
    if (rangeFilterKey) {
      return points.filter((p) => rangeFilterKey(p.key, 1))
    }
    const today = todayDayKey()
    return points.filter((p) => p.key === today)
  }
  const days = Number(range)
  if (rangeFilterKey) {
    return points.filter((p) => rangeFilterKey(p.key, days))
  }
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffKey = cutoff.toISOString().slice(0, 10)
  return points.filter((p) => p.key >= cutoffKey)
}

function clientXToSvgX(svg: SVGSVGElement, clientX: number): number {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = 0
  const ctm = svg.getScreenCTM()
  if (!ctm) return 0
  return pt.matrixTransform(ctm.inverse()).x
}

function timeDomain(series: InteractiveChartSeries[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let found = false
  for (const s of series) {
    for (const p of s.points) {
      if (p.at == null || !Number.isFinite(p.at)) continue
      found = true
      min = Math.min(min, p.at)
      max = Math.max(max, p.at)
    }
  }
  if (!found) return null
  if (min === max) return { min: min - 60_000, max: max + 60_000 }
  return { min, max }
}

function pointX(
  p: InteractiveChartPoint,
  index: number,
  count: number,
  domain: { min: number; max: number } | null
): number {
  const innerW = VB_W - PAD_X * 2
  if (domain && p.at != null && Number.isFinite(p.at)) {
    const span = Math.max(1, domain.max - domain.min)
    const ratio = Math.max(0, Math.min(1, (p.at - domain.min) / span))
    return PAD_X + ratio * innerW
  }
  if (count <= 1) return PAD_X
  return PAD_X + (index / (count - 1)) * innerW
}

function findNearestHover(
  series: InteractiveChartSeries[],
  svgX: number,
  domain: { min: number; max: number } | null
): { seriesId: string; index: number; x: number } | null {
  let best: { seriesId: string; index: number; x: number; dist: number } | null = null
  for (const s of series) {
    const count = s.points.length
    for (let i = 0; i < count; i++) {
      const p = s.points[i]
      const x = pointX(p, i, count, domain)
      const dist = Math.abs(svgX - x)
      if (!best || dist < best.dist) {
        best = { seriesId: s.id, index: i, x, dist }
      }
    }
  }
  return best ? { seriesId: best.seriesId, index: best.index, x: best.x } : null
}

export function UsageInteractiveChart({
  series,
  mode,
  yMax,
  yFormat = (v) => `${v.toFixed(1)}%`,
  emptyMessage = "No data yet.",
  className,
  rangeFilterKey,
  defaultRange = "30",
  rangeOptions = DEFAULT_RANGE_OPTIONS,
}: UsageInteractiveChartProps) {
  const [range, setRange] = useState<ChartRangeKey>(defaultRange)
  const [hover, setHover] = useState<{ seriesId: string; index: number; x: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const filteredSeries = useMemo(
    () =>
      series
        .map((s) => ({
          ...s,
          points: filterByRange(s.points, range, rangeFilterKey),
        }))
        .filter((s) => s.points.length > 0),
    [series, range, rangeFilterKey]
  )

  const maxY = useMemo(() => {
    const vals = filteredSeries.flatMap((s) => s.points.map((p) => p.value))
    if (vals.length === 0) return yMax ?? 100
    return yMax ?? Math.max(1, ...vals)
  }, [filteredSeries, yMax])

  const domain = useMemo(() => timeDomain(filteredSeries), [filteredSeries])

  const onPointer = useCallback(
    (clientX: number) => {
      const svg = svgRef.current
      if (!svg || filteredSeries.length === 0) return
      const svgX = clientXToSvgX(svg, clientX)
      const hit = findNearestHover(filteredSeries, svgX, domain)
      if (hit) setHover({ seriesId: hit.seriesId, index: hit.index, x: hit.x })
    },
    [filteredSeries, domain]
  )

  const hasAnyData = series.some((s) => s.points.length > 0)
  if (!hasAnyData) {
    return (
      <p className={cn("text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2", className)}>
        {emptyMessage}
      </p>
    )
  }
  if (filteredSeries.length === 0) {
    return (
      <div className={cn("rounded-md border border-border bg-muted/20 p-3 space-y-2", className)}>
        <div className="flex flex-wrap gap-1">
          {rangeOptions.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                range === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {key === "all" ? "All" : `${key}d`}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          No data in this range{range === "1" ? " (today only — refresh providers to capture today)" : ""}.
        </p>
      </div>
    )
  }

  const innerW = VB_W - PAD_X * 2
  const innerH = VB_H - PAD_Y * 2

  const active =
    hover &&
    filteredSeries
      .find((s) => s.id === hover.seriesId)
      ?.points[hover.index]

  return (
    <div className={cn("rounded-md border border-border bg-muted/20 p-3 space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {rangeOptions.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                range === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {key === "all" ? "All" : `${key}d`}
            </button>
          ))}
        </div>
        <div className="text-[11px] tabular-nums text-muted-foreground min-h-[1rem]">
          {active ? (
            <span>
              <span className="text-foreground font-medium">{active.label}</span>
              {" · "}
              {yFormat(active.value)}
              {active.detail ? ` · ${active.detail}` : ""}
            </span>
          ) : range === "1" && mode === "bar" ? (
            <span>Today so far — one bar per account</span>
          ) : (
            <span>Hover or drag across the chart</span>
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="w-full h-[180px] touch-none select-none"
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => onPointer(e.clientX)}
        onTouchMove={(e) => {
          const touch = e.touches[0]
          if (touch) onPointer(touch.clientX)
        }}
      >
        <line
          x1={PAD_X}
          y1={VB_H - PAD_Y}
          x2={VB_W - PAD_X}
          y2={VB_H - PAD_Y}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <text x={PAD_X} y={PAD_Y - 2} fontSize={10} className="fill-muted-foreground">
          {yFormat(maxY)}
        </text>
        <text x={PAD_X} y={VB_H - 2} fontSize={10} className="fill-muted-foreground">
          {yFormat(0)}
        </text>

        {filteredSeries.map((s) => {
          const pts = s.points
          if (pts.length === 0) return null

          if (mode === "line") {
            const poly = pts
              .map((p, i) => {
                const x = pointX(p, i, pts.length, domain)
                const y = VB_H - PAD_Y - (p.value / maxY) * innerH
                return `${x.toFixed(1)},${y.toFixed(1)}`
              })
              .join(" ")
            return (
              <g key={s.id}>
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={poly}
                />
                {pts.map((p, i) => {
                  const x = pointX(p, i, pts.length, domain)
                  const y = VB_H - PAD_Y - (p.value / maxY) * innerH
                  const activePoint = hover?.seriesId === s.id && hover.index === i
                  return (
                    <circle
                      key={`${s.id}-${i}-${p.key}`}
                      cx={x}
                      cy={y}
                      r={activePoint ? 5 : 3}
                      fill={s.color}
                      opacity={activePoint ? 1 : 0.85}
                    />
                  )
                })}
              </g>
            )
          }

          const singleDayBar = pts.length === 1
          const barW = singleDayBar ? innerW : innerW / pts.length
          const gap = singleDayBar ? 0 : Math.min(3, barW * 0.2)
          const barInner = singleDayBar
            ? Math.min(96, innerW * 0.22)
            : Math.max(2, barW - gap)
          return (
            <g key={s.id}>
              {pts.map((p, i) => {
                const val = p.value
                const h = val > 0 ? Math.max(2, (val / maxY) * innerH) : 1
                const x = singleDayBar
                  ? PAD_X + (innerW - barInner) / 2
                  : PAD_X + i * barW + gap / 2
                const y = VB_H - PAD_Y - h
                const activeBar = hover?.seriesId === s.id && hover.index === i
                return (
                  <rect
                    key={`${s.id}-${i}-${p.key}`}
                    x={x}
                    y={y}
                    width={barInner}
                    height={h}
                    rx={2}
                    fill={s.color}
                    opacity={activeBar ? 1 : 0.8}
                  />
                )
              })}
            </g>
          )
        })}

        {hover ? (
          <line
            x1={hover.x}
            y1={PAD_Y}
            x2={hover.x}
            y2={VB_H - PAD_Y}
            stroke="var(--foreground)"
            strokeOpacity={0.25}
            strokeDasharray="3 3"
          />
        ) : null}
      </svg>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/85">
        {filteredSeries.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span>{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function formatTokenValue(value: number): string {
  return `${formatCountNumber(value)} tok`
}
