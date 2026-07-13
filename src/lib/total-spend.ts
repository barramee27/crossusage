import type { MetricLine, ModelSpendBreakdown, PluginOutput } from "@/lib/plugin-types"

export const TOTAL_SPEND_PERIODS = ["Today", "Yesterday", "Last 30 Days"] as const
export type TotalSpendPeriod = (typeof TOTAL_SPEND_PERIODS)[number]

export const TOTAL_SPEND_METRICS = ["cost", "costPerMtok", "tokens"] as const
export type TotalSpendMetric = (typeof TOTAL_SPEND_METRICS)[number]

/** Persist key for Cost — matches upstream AppStorage raw value `apiSpend`. */
export type TotalSpendMetricStored = "apiSpend" | "costPerMtok" | "tokens"

export const TOTAL_SPEND_PERIOD_SHORT: Record<TotalSpendPeriod, string> = {
  Today: "Today",
  Yesterday: "Yesterday",
  "Last 30 Days": "30 Days",
}

export const TOTAL_SPEND_METRIC_TITLE: Record<TotalSpendMetric, string> = {
  cost: "Cost",
  costPerMtok: "Cost/MTok",
  tokens: "Tokens",
}

export const TOTAL_SPEND_METRIC_EMPTY: Record<TotalSpendMetric, string> = {
  cost: "No cost data for this period",
  costPerMtok: "No cost-per-token data for this period",
  tokens: "No token data for this period",
}

export function metricFromStored(raw: string | null | undefined): TotalSpendMetric {
  if (raw === "costPerMtok") return "costPerMtok"
  if (raw === "tokens") return "tokens"
  return "cost"
}

export function metricToStored(metric: TotalSpendMetric): TotalSpendMetricStored {
  return metric === "cost" ? "apiSpend" : metric
}

export type TotalSpendProvider = {
  id: string
  displayName: string
  brandColor?: string
}

export type TotalSpendSlice = {
  provider: TotalSpendProvider
  amountUSD: number
  tokenCount: number
  estimated: boolean
}

export type TotalSpendProjectedSlice = {
  provider: TotalSpendProvider
  displayAmount: number
  estimated: boolean
}

export type TotalSpendProjection = {
  metric: TotalSpendMetric
  slices: TotalSpendProjectedSlice[]
  centerValue: number
  isEstimated: boolean
}

export type TotalSpend = {
  period: TotalSpendPeriod
  slices: TotalSpendSlice[]
}

const SPEND_LABELS = new Set<string>(TOTAL_SPEND_PERIODS)

/** Dollar amount from a `$12.34` / `$12.34 · 1.2M tokens` style value. */
export function parseDollarsFromValue(value: string): number {
  const match = String(value ?? "").match(/\$([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return 0
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Token count from `1.2M tokens` / `12,345 tokens` style value when breakdown is absent. */
export function parseTokensFromValue(value: string): number {
  const text = String(value ?? "")
  const mTok = text.match(/([0-9]+(?:\.[0-9]+)?)\s*M\s*tokens/i)
  if (mTok) {
    const n = Number(mTok[1])
    return Number.isFinite(n) && n > 0 ? n * 1_000_000 : 0
  }
  const kTok = text.match(/([0-9]+(?:\.[0-9]+)?)\s*K\s*tokens/i)
  if (kTok) {
    const n = Number(kTok[1])
    return Number.isFinite(n) && n > 0 ? n * 1_000 : 0
  }
  const raw = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*tokens/i)
  if (raw) {
    const n = Number(raw[1].replace(/,/g, ""))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return 0
}

function sumBreakdownCost(breakdown: ModelSpendBreakdown[] | undefined): number {
  if (!breakdown?.length) return 0
  let sum = 0
  for (const row of breakdown) {
    if (row.costUsd != null && Number.isFinite(row.costUsd) && row.costUsd > 0) {
      sum += row.costUsd
    }
  }
  return sum
}

function sumBreakdownTokens(breakdown: ModelSpendBreakdown[] | undefined): number {
  if (!breakdown?.length) return 0
  let sum = 0
  for (const row of breakdown) {
    if (Number.isFinite(row.tokens) && row.tokens > 0) sum += row.tokens
  }
  return sum
}

function isEstimatedLine(line: Extract<MetricLine, { type: "text" }>): boolean {
  const hay = `${line.subtitle ?? ""} ${line.value ?? ""}`
  if (/estimated/i.test(hay)) return true
  // Log-derived spend tiles carry modelBreakdown without a billing CSV path — treat as estimated
  // when the value/subtitle does not already say so but breakdown is the only source of dollars.
  return false
}

function findSpendLine(
  lines: MetricLine[] | undefined,
  period: TotalSpendPeriod,
): Extract<MetricLine, { type: "text" }> | null {
  if (!lines) return null
  for (const line of lines) {
    if (line.type === "text" && line.label === period) return line
  }
  return null
}

/**
 * Providers that emit at least one Today / Yesterday / Last 30 Days spend tile with dollars or tokens.
 * Capability-based: a provider stays spend-capable even when those rows are hidden in Customize.
 */
export function spendCapableProviders(
  providers: TotalSpendProvider[],
  outputs: Map<string, PluginOutput | null | undefined> | Record<string, PluginOutput | null | undefined>,
): TotalSpendProvider[] {
  const get = (id: string) =>
    outputs instanceof Map ? outputs.get(id) : outputs[id]
  return providers.filter((provider) => {
    const output = get(provider.id)
    if (!output?.lines) return false
    for (const line of output.lines) {
      if (line.type !== "text" || !SPEND_LABELS.has(line.label)) continue
      const dollars =
        sumBreakdownCost(line.modelBreakdown) || parseDollarsFromValue(line.value)
      const tokens =
        sumBreakdownTokens(line.modelBreakdown) || parseTokensFromValue(line.value)
      if (dollars > 0 || tokens > 0) return true
      // Zero-token placeholder lines still mark the provider as spend-capable.
      if (line.modelBreakdown != null || /\$|token/i.test(line.value)) return true
    }
    return false
  })
}

export function extractSliceFromLine(
  provider: TotalSpendProvider,
  line: Extract<MetricLine, { type: "text" }>,
): TotalSpendSlice | null {
  const fromBreakdownCost = sumBreakdownCost(line.modelBreakdown)
  const fromBreakdownTokens = sumBreakdownTokens(line.modelBreakdown)
  const amountUSD = Math.max(0, fromBreakdownCost || parseDollarsFromValue(line.value))
  const tokenCount = Math.max(0, fromBreakdownTokens || parseTokensFromValue(line.value))
  if (amountUSD <= 0 && tokenCount <= 0) return null

  const estimated =
    isEstimatedLine(line) ||
    (fromBreakdownCost <= 0 && amountUSD > 0 && /estimated/i.test(`${line.subtitle ?? ""} ${line.value}`)) ||
    // Prefer estimate when dollars came only from log-style breakdown without an explicit non-estimate note
    (Boolean(line.modelBreakdown?.length) &&
      fromBreakdownCost > 0 &&
      /estimated/i.test(`${line.subtitle ?? ""}`))

  return {
    provider,
    amountUSD,
    tokenCount,
    estimated: Boolean(estimated || /estimated/i.test(`${line.subtitle ?? ""} ${line.value ?? ""}`)),
  }
}

export function aggregateTotalSpend(args: {
  period: TotalSpendPeriod
  providers: TotalSpendProvider[]
  outputs: Map<string, PluginOutput | null | undefined> | Record<string, PluginOutput | null | undefined>
}): TotalSpend {
  const get = (id: string) =>
    args.outputs instanceof Map ? args.outputs.get(id) : args.outputs[id]
  const slices: TotalSpendSlice[] = []
  for (const provider of args.providers) {
    const line = findSpendLine(get(provider.id)?.lines, args.period)
    if (!line) continue
    const slice = extractSliceFromLine(provider, line)
    if (slice) slices.push(slice)
  }
  return { period: args.period, slices }
}

function costPerMtok(slice: TotalSpendSlice): number | null {
  if (slice.amountUSD <= 0 || slice.tokenCount <= 0) return null
  return (slice.amountUSD / slice.tokenCount) * 1_000_000
}

export function projectTotalSpend(total: TotalSpend, metric: TotalSpendMetric): TotalSpendProjection {
  const included: { slice: TotalSpendSlice; display: number }[] = []
  for (const slice of total.slices) {
    if (metric === "cost") {
      if (slice.amountUSD <= 0) continue
      included.push({ slice, display: slice.amountUSD })
    } else if (metric === "tokens") {
      if (slice.tokenCount <= 0) continue
      included.push({ slice, display: slice.tokenCount })
    } else {
      const rate = costPerMtok(slice)
      if (rate == null) continue
      included.push({ slice, display: rate })
    }
  }

  included.sort((a, b) => {
    if (a.display !== b.display) return b.display - a.display
    return a.slice.provider.displayName.localeCompare(b.slice.provider.displayName)
  })

  const projected = included.map(({ slice, display }) => ({
    provider: slice.provider,
    displayAmount: display,
    estimated: slice.estimated,
  }))

  let centerValue = 0
  let isEstimated = false
  if (metric === "cost") {
    centerValue = included.reduce((sum, row) => sum + row.slice.amountUSD, 0)
    isEstimated = included.some((row) => row.slice.estimated)
  } else if (metric === "tokens") {
    centerValue = included.reduce((sum, row) => sum + row.slice.tokenCount, 0)
    isEstimated = false
  } else {
    const usd = included.reduce((sum, row) => sum + row.slice.amountUSD, 0)
    const tokens = included.reduce((sum, row) => sum + row.slice.tokenCount, 0)
    centerValue = tokens > 0 ? (usd / tokens) * 1_000_000 : 0
    isEstimated = included.some((row) => row.slice.estimated)
  }

  return { metric, slices: projected, centerValue, isEstimated }
}

/** Stable brand tints for the ring (provider id → hex). Near-black brands use a mid gray on dark cards. */
export const TOTAL_SPEND_PALETTE: Record<string, string> = {
  claude: "#DE7356",
  codex: "#10A37F",
  cursor: "#A3A3A3",
  grok: "#8E8E93",
  opencode: "#6E6E73",
  "opencode-go": "#6E6E73",
  openrouter: "#6467F2",
  antigravity: "#4285F4",
  copilot: "#A855F7",
  amp: "#F34E3F",
  factory: "#48484A",
  kimi: "#0A66FF",
  minimax: "#F5433C",
  zai: "#2D2D2D",
}

const FALLBACK_PALETTE = ["#34C759", "#5856D6", "#FF2D55", "#A2845E"]

export function totalSpendColor(providerId: string, brandColor?: string): string {
  if (brandColor && brandColor.trim()) return brandColor
  const known = TOTAL_SPEND_PALETTE[providerId]
  if (known) return known
  let hash = 0
  for (let i = 0; i < providerId.length; i++) {
    hash = (hash * 31 + providerId.charCodeAt(i)) & 0xffff
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length]
}

export function formatTotalSpendCenter(
  value: number,
  metric: TotalSpendMetric,
): { primary: string; unit: string } {
  if (metric === "cost") {
    return { primary: `$${value.toFixed(2)}`, unit: "total" }
  }
  if (metric === "costPerMtok") {
    return { primary: `$${value < 10 ? value.toFixed(2) : value.toFixed(1)}`, unit: "/MTok" }
  }
  if (value >= 1_000_000) {
    return { primary: `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`, unit: "tokens" }
  }
  if (value >= 1_000) {
    return { primary: `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`, unit: "tokens" }
  }
  return { primary: String(Math.round(value)), unit: "tokens" }
}

export function formatTotalSpendLegend(value: number, metric: TotalSpendMetric): string {
  if (metric === "cost" || metric === "costPerMtok") {
    return `$${value.toFixed(2)}${metric === "costPerMtok" ? "/MTok" : ""}`
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}
