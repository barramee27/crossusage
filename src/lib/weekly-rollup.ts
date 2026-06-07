import type { UsageDailyRow } from "@/lib/usage-daily"

export type WeeklyRollupWindow = {
  /** Inclusive YYYY-MM-DD */
  startDay: string
  endDay: string
}

export type WeeklyRollupTotals = {
  totalTokens: number
  costUsd: number
}

export type WeeklyRollupResult = {
  windowDays: number
  current: WeeklyRollupTotals
  prior: WeeklyRollupTotals
  tokenDeltaPct: number | null
  costDeltaPct: number | null
  topContributors: { displayName: string; totalTokens: number }[]
  currentWindow: WeeklyRollupWindow
  priorWindow: WeeklyRollupWindow
}

function dayKeyToDate(dayKey: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const dt = new Date(y, mo, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null
  return dt
}

function formatDayKey(dt: Date): string {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, "0")
  const d = String(dt.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function rollingWindowDays(
  windowDays: number,
  now: Date = new Date(),
): { current: WeeklyRollupWindow; prior: WeeklyRollupWindow } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const currentStart = new Date(end)
  currentStart.setDate(currentStart.getDate() - (windowDays - 1))
  const priorEnd = new Date(currentStart)
  priorEnd.setDate(priorEnd.getDate() - 1)
  const priorStart = new Date(priorEnd)
  priorStart.setDate(priorStart.getDate() - (windowDays - 1))

  return {
    current: { startDay: formatDayKey(currentStart), endDay: formatDayKey(end) },
    prior: { startDay: formatDayKey(priorStart), endDay: formatDayKey(priorEnd) },
  }
}

/** @deprecated use rollingWindowDays(7) */
export function rollingSevenDayWindows(now: Date = new Date()) {
  return rollingWindowDays(7, now)
}

function inWindow(dayKey: string, window: WeeklyRollupWindow): boolean {
  return dayKey >= window.startDay && dayKey <= window.endDay
}

function deltaPct(current: number, prior: number): number | null {
  if (prior <= 0) return current > 0 ? 100 : null
  return Math.round(((current - prior) / prior) * 100)
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tokens`
  return `${n} tokens`
}

function formatDeltaPct(pct: number | null, priorLabel: string): string {
  if (pct == null) return ""
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→"
  return ` (${arrow} ${Math.abs(pct)}% vs prior ${priorLabel})`
}

export function computeRollingRollup(
  rows: UsageDailyRow[],
  windowDays: number,
  now: Date = new Date(),
): WeeklyRollupResult | null {
  if (rows.length === 0) return null

  const { current: currentWindow, prior: priorWindow } = rollingWindowDays(windowDays, now)
  const current: WeeklyRollupTotals = { totalTokens: 0, costUsd: 0 }
  const prior: WeeklyRollupTotals = { totalTokens: 0, costUsd: 0 }
  const byNameCurrent = new Map<string, number>()

  for (const row of rows) {
    if (!dayKeyToDate(row.dayKey)) continue
    const tokens = row.totalTokens ?? 0
    const cost = row.costUsd ?? 0
    if (inWindow(row.dayKey, currentWindow)) {
      current.totalTokens += tokens
      current.costUsd += cost
      byNameCurrent.set(
        row.displayName,
        (byNameCurrent.get(row.displayName) ?? 0) + tokens,
      )
    } else if (inWindow(row.dayKey, priorWindow)) {
      prior.totalTokens += tokens
      prior.costUsd += cost
    }
  }

  if (current.totalTokens === 0 && current.costUsd === 0 && prior.totalTokens === 0) {
    return null
  }

  const topContributors = [...byNameCurrent.entries()]
    .map(([displayName, totalTokens]) => ({ displayName, totalTokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 3)

  return {
    windowDays,
    current,
    prior,
    tokenDeltaPct: deltaPct(current.totalTokens, prior.totalTokens),
    costDeltaPct: deltaPct(current.costUsd, prior.costUsd),
    topContributors,
    currentWindow,
    priorWindow,
  }
}

/** @deprecated use computeRollingRollup(rows, 7) */
export function computeWeeklyRollup(
  rows: UsageDailyRow[],
  now: Date = new Date(),
): WeeklyRollupResult | null {
  return computeRollingRollup(rows, 7, now)
}

export function formatRollupSummary(rollup: WeeklyRollupResult): string {
  const label = rollup.windowDays === 7 ? "7d" : `${rollup.windowDays}d`
  const priorLabel = rollup.windowDays === 7 ? "7d" : `${rollup.windowDays}d`

  const tokens = formatTokenCount(rollup.current.totalTokens)
  const tokenDelta = formatDeltaPct(rollup.tokenDeltaPct, priorLabel)

  let costPart = ""
  if (rollup.current.costUsd > 0) {
    const costDelta = formatDeltaPct(rollup.costDeltaPct, priorLabel)
    costPart = ` · ~$${rollup.current.costUsd.toFixed(2)}${costDelta}`
  }

  return `This ${label}: ${tokens}${tokenDelta}${costPart}`
}

/** @deprecated use formatRollupSummary */
export function formatWeeklyRollupSummary(rollup: WeeklyRollupResult): string {
  return formatRollupSummary(rollup)
}

export { dayKeyToDate }
