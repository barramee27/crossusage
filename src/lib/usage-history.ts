/** Rows from `list_usage_history` (camelCase JSON). */
export type UsageHistoryRow = {
  id: number
  instanceId: string
  capturedAtMs: number
  displayName: string
  plan: string | null
  primaryPercent: number
  inputTokens: number | null
  outputTokens: number | null
  cost: number | null
  resetTime: string | null
  quotaSummary: string | null
}
