/** Rows from `list_usage_daily` (camelCase JSON). */
export type UsageDailyRow = {
  instanceId: string
  dayKey: string
  displayName: string
  totalTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  source: string
  ingestedAtMs: number
}
