import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type UsageStatsRow = {
  key: string
  input: number
  output: number
  cacheWrite: number
  cacheHit: number
  totalTokens: number
  costUsd: number
}

type UsageStatsPayload = {
  since: string
  until: string
  group: string
  rows: UsageStatsRow[]
  totals: UsageStatsRow
}

type RangePreset = "mtd" | "7d" | "30d"
type GroupMode = "model" | "provider"

function yyyymmdd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${day}`
}

function presetRange(preset: RangePreset): { since: string; until: string } {
  const until = new Date()
  const end = yyyymmdd(until)
  if (preset === "mtd") {
    const start = new Date(until.getFullYear(), until.getMonth(), 1)
    return { since: yyyymmdd(start), until: end }
  }
  const days = preset === "7d" ? 6 : 29
  const start = new Date(until)
  start.setDate(start.getDate() - days)
  return { since: yyyymmdd(start), until: end }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

type CursorUsageStatsPanelProps = {
  className?: string
  pluginId?: string
}

export function CursorUsageStatsPanel({
  className,
  pluginId = "cursor",
}: CursorUsageStatsPanelProps) {
  const [preset, setPreset] = useState<RangePreset>("mtd")
  const [group, setGroup] = useState<GroupMode>("model")
  const [data, setData] = useState<UsageStatsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!isTauri()) return
    const range = presetRange(preset)
    setLoading(true)
    setError(null)
    try {
      const result = await invoke<UsageStatsPayload>("query_cursor_usage_stats", {
        pluginId,
        since: range.since,
        until: range.until,
        group,
      })
      setData(result)
    } catch (e) {
      console.error("query_cursor_usage_stats:", e)
      setData(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [pluginId, preset, group])

  useEffect(() => {
    void load()
  }, [load])

  if (!isTauri()) return null

  const labelCol = group === "model" ? "Model" : "Provider"

  return (
    <section className={cn("mt-4 space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Billing usage (Cursor export)</h4>
        <div className="flex flex-wrap gap-1">
          {(["mtd", "7d", "30d"] as const).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={preset === p ? "default" : "outline"}
              onClick={() => setPreset(p)}
            >
              {p === "mtd" ? "MTD" : p.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Same data as <code className="text-[10px]">crossusage-cli usage-stats</code> — dashboard CSV export (billing).
      </p>
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={group === "model" ? "default" : "outline"}
          onClick={() => setGroup("model")}
        >
          By model
        </Button>
        <Button
          type="button"
          size="sm"
          variant={group === "provider" ? "default" : "outline"}
          onClick={() => setGroup("provider")}
        >
          By provider
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>
      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {data && data.rows.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border border-border text-xs">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-muted/80">
              <tr className="text-left text-muted-foreground">
                <th className="p-2 font-medium">{labelCol}</th>
                <th className="p-2 font-medium">Input</th>
                <th className="p-2 font-medium">Output</th>
                <th className="p-2 font-medium">Cache W</th>
                <th className="p-2 font-medium">Cache R</th>
                <th className="p-2 font-medium">Total</th>
                <th className="p-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key} className="border-t border-border/50">
                  <td className="p-2">{row.key}</td>
                  <td className="p-2 tabular-nums">{fmtNum(row.input)}</td>
                  <td className="p-2 tabular-nums">{fmtNum(row.output)}</td>
                  <td className="p-2 tabular-nums">{fmtNum(row.cacheWrite)}</td>
                  <td className="p-2 tabular-nums">{fmtNum(row.cacheHit)}</td>
                  <td className="p-2 tabular-nums">{fmtNum(row.totalTokens)}</td>
                  <td className="p-2 tabular-nums">${row.costUsd.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="p-2">Total</td>
                <td className="p-2 tabular-nums">{fmtNum(data.totals.input)}</td>
                <td className="p-2 tabular-nums">{fmtNum(data.totals.output)}</td>
                <td className="p-2 tabular-nums">{fmtNum(data.totals.cacheWrite)}</td>
                <td className="p-2 tabular-nums">{fmtNum(data.totals.cacheHit)}</td>
                <td className="p-2 tabular-nums">{fmtNum(data.totals.totalTokens)}</td>
                <td className="p-2 tabular-nums">${data.totals.costUsd.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.rows.length === 0 && !loading && !error ? (
        <p className="text-xs text-muted-foreground">No usage in this range.</p>
      ) : null}
    </section>
  )
}
