/** Rows from `get_usage_insights` (matches crossusage-core JSON). */
export type HistoryInsightTightest = {
  instanceId: string
  displayName: string
  primaryPercent: number
  remainingPercent: number
  capturedAtMs: number
  resetTime: string | null
}

export type HistoryInsightsSummary = {
  generatedAtMs: number
  retentionDays: number
  tightest: HistoryInsightTightest[]
}

export function formatHistoryTightestMessage(row: HistoryInsightTightest): string {
  const used = Math.round(row.primaryPercent)
  const left = Math.round(row.remainingPercent)
  return `${row.displayName} — ${used}% used (${left}% left) · saved snapshot`
}
