import type { DisplayCurrencyCode } from "@/i18n/locale-meta"

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

type RateCache = {
  base: "USD"
  rates: Record<string, number>
  fetchedAt: number
}

let cache: RateCache | null = null
let inflight: Promise<RateCache | null> | null = null

async function fetchRates(): Promise<RateCache | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD")
    if (!res.ok) return null
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> }
    if (data.result !== "success" || !data.rates || typeof data.rates !== "object") return null
    cache = { base: "USD", rates: data.rates, fetchedAt: Date.now() }
    return cache
  } catch {
    return null
  }
}

export async function prefetchExchangeRates(): Promise<boolean> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return true
  if (!inflight) {
    inflight = fetchRates().finally(() => {
      inflight = null
    })
  }
  const result = await inflight
  return result != null
}

export function convertFromUsd(
  amountUsd: number,
  target: DisplayCurrencyCode,
): number {
  if (!Number.isFinite(amountUsd)) return 0
  if (target === "USD") return amountUsd
  const rate = cache?.rates[target]
  if (typeof rate !== "number" || !Number.isFinite(rate)) return amountUsd
  return amountUsd * rate
}

export function isExchangeRateAvailable(target: DisplayCurrencyCode): boolean {
  return target === "USD" || (cache?.rates[target] != null && Number.isFinite(cache.rates[target]))
}

/** Test-only: inject cached rates without network. */
export function setExchangeRatesForTests(rates: Record<string, number> | null): void {
  if (rates === null) {
    cache = null
    return
  }
  cache = { base: "USD", rates, fetchedAt: Date.now() }
}
