import type { UsageInsight } from "@/lib/usage-insights"

const PREFIX = "insightDismiss:"

export function insightDismissStorageKey(row: UsageInsight): string {
  return `${PREFIX}${row.kind}:${row.instanceId}:${row.lineLabel}`
}

export function isInsightDismissed(row: UsageInsight, nowMs = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(insightDismissStorageKey(row))
    if (!raw) return false
    const until = Number(raw)
    if (!Number.isFinite(until)) return true
    return nowMs < until
  } catch {
    return false
  }
}

export function dismissInsight(row: UsageInsight, untilMs: number): void {
  try {
    localStorage.setItem(insightDismissStorageKey(row), String(untilMs))
  } catch {
    /* ignore quota errors */
  }
}

export function filterDismissedInsights(
  insights: UsageInsight[],
  nowMs = Date.now(),
): UsageInsight[] {
  return insights.filter((row) => !isInsightDismissed(row, nowMs))
}
