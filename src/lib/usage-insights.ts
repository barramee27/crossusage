import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import { calculatePaceStatus } from "@/lib/pace-status"
import { formatRunsOutText } from "@/lib/pace-tooltip"
import { formatResetRelativeLabel } from "@/lib/reset-tooltip"
import { resolvePrimaryProgressLine, isProgressLine } from "@/lib/primary-progress-line"
import type { PluginSettings } from "@/lib/settings"

export type UsageInsightKind = "pace" | "tight" | "reset"

export type UsageInsight = {
  kind: UsageInsightKind
  instanceId: string
  displayName: string
  lineLabel: string
  message: string
  /** Lower = higher priority within kind */
  sortKey: number
  /** When set, dismiss hides this insight until this timestamp (ms). */
  dismissUntilMs?: number
}

function parseResetsAtMs(line: { resetsAt?: string }): number | null {
  if (!line.resetsAt) return null
  const ms = Date.parse(line.resetsAt)
  return Number.isFinite(ms) ? ms : null
}

function remainingPercent(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null
  return Math.max(0, Math.min(100, ((limit - used) / limit) * 100))
}

export function buildUsageInsights(args: {
  plugins: DisplayPluginState[]
  pluginSettings: PluginSettings | null
  preferWeeklyLimit?: boolean
  nowMs?: number
  maxRows?: number
}): UsageInsight[] {
  const {
    plugins,
    pluginSettings,
    preferWeeklyLimit = false,
    nowMs = Date.now(),
    maxRows = 3,
  } = args
  if (!pluginSettings) return []

  const paceRows: UsageInsight[] = []
  const tightCandidates: UsageInsight[] = []
  const resetCandidates: { insight: UsageInsight; resetsAtMs: number }[] = []

  for (const plugin of plugins) {
    if (!plugin.data || plugin.loading || plugin.error) continue

    const instanceId = plugin.meta.id
    const displayName = plugin.data.displayName || plugin.meta.name

    const primary = resolvePrimaryProgressLine({
      meta: plugin.meta,
      data: plugin.data,
      pluginSettings,
      instanceId,
      preferWeeklyLimit,
    })

    if (primary) {
      const resetsAtMs = parseResetsAtMs(primary)
      const periodDurationMs = primary.periodDurationMs

      if (
        primary.format?.kind === "percent" &&
        resetsAtMs != null &&
        periodDurationMs != null &&
        periodDurationMs > 0
      ) {
        const pace = calculatePaceStatus(
          primary.used,
          primary.limit,
          resetsAtMs,
          periodDurationMs,
          nowMs,
        )
        if (pace?.status === "behind") {
          const runsOut = formatRunsOutText({
            paceResult: pace,
            used: primary.used,
            limit: primary.limit,
            periodDurationMs,
            resetsAtMs,
            nowMs,
          })
          paceRows.push({
            kind: "pace",
            instanceId,
            displayName,
            lineLabel: primary.label,
            message: runsOut
              ? `${displayName} (${primary.label}) — ${runsOut}`
              : `${displayName} (${primary.label}) — projected to run out before reset`,
            sortKey: pace.projectedUsage - primary.limit,
            dismissUntilMs: resetsAtMs ?? undefined,
          })
        }
      }

      if (primary.format?.kind === "percent") {
        const rem = remainingPercent(primary.used, primary.limit)
        if (rem != null) {
          tightCandidates.push({
            kind: "tight",
            instanceId,
            displayName,
            lineLabel: primary.label,
            message: `${displayName} (${primary.label}) — ${rem.toFixed(0)}% remaining`,
            sortKey: rem,
            dismissUntilMs: nowMs + 86_400_000,
          })
        }
      }
    }

    for (const line of plugin.data.lines) {
      if (!isProgressLine(line)) continue
      const resetsAtMs = parseResetsAtMs(line)
      if (resetsAtMs == null || resetsAtMs <= nowMs) continue
      const delta = resetsAtMs - nowMs
      const resetLabel = formatResetRelativeLabel(nowMs, line.resetsAt!)
      resetCandidates.push({
        resetsAtMs,
        insight: {
          kind: "reset",
          instanceId,
          displayName,
          lineLabel: line.label,
          message: resetLabel
            ? `${displayName} (${line.label}) — ${resetLabel}`
            : `${displayName} (${line.label}) resets soon`,
          sortKey: delta,
          dismissUntilMs: resetsAtMs,
        },
      })
    }
  }

  paceRows.sort((a, b) => b.sortKey - a.sortKey)
  tightCandidates.sort((a, b) => a.sortKey - b.sortKey)
  resetCandidates.sort((a, b) => a.insight.sortKey - b.insight.sortKey)

  const out: UsageInsight[] = []
  const seen = new Set<string>()

  const pushUnique = (row: UsageInsight) => {
    const key = `${row.kind}:${row.instanceId}:${row.lineLabel}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(row)
  }

  for (const row of paceRows) {
    if (out.length >= maxRows) break
    pushUnique(row)
  }
  for (const row of tightCandidates) {
    if (out.length >= maxRows) break
    pushUnique(row)
  }
  if (resetCandidates[0] && out.length < maxRows) {
    pushUnique(resetCandidates[0].insight)
  }

  return out
}
