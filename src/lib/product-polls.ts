/** Product polls client — dumb shell over crossusage.dev API. */

export const PRODUCT_POLLS_API_BASE = "https://crossusage.dev/api/polls"
export const PRODUCT_POLLS_FETCH_THROTTLE_MS = 60 * 60 * 1000
export const PRODUCT_POLLS_FETCH_TIMEOUT_MS = 3000

export type ProductPollOption = {
  id: string
  label: string
}

export type ProductPoll = {
  id: string
  version: number
  title: string
  body: string | null
  options: ProductPollOption[]
  allowDismiss: boolean
  minAppVersion: string | null
  expiresAt: string | null
  ended: boolean
}

export type ProductPollResults = {
  pollId: string
  total: number
  counts: Record<string, number>
  winnerId: string | null
  ended: boolean
}

export type ProductPollAnswerMap = Record<string, string>
export type ProductPollDismissMap = Record<string, number>

function parseSemverParts(v: string): number[] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** True if appVersion >= minVersion (major.minor.patch prefix). */
export function versionSatisfies(appVersion: string | null | undefined, minVersion: string | null | undefined): boolean {
  if (!minVersion) return true
  if (!appVersion) return true
  const a = parseSemverParts(appVersion)
  const b = parseSemverParts(minVersion)
  if (!a || !b) return true
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true
    if (a[i]! < b[i]!) return false
  }
  return true
}

export function isPollExpired(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return false
  const t = Date.parse(expiresAt)
  return Number.isFinite(t) && t <= nowMs
}

export function parseProductPoll(raw: unknown): ProductPoll | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || !o.id) return null
  if (typeof o.title !== "string" || !o.title) return null
  if (!Array.isArray(o.options)) return null
  const options: ProductPollOption[] = []
  for (const item of o.options) {
    if (!item || typeof item !== "object") return null
    const opt = item as Record<string, unknown>
    if (typeof opt.id !== "string" || typeof opt.label !== "string") return null
    options.push({ id: opt.id, label: opt.label })
  }
  if (options.length < 2 || options.length > 8) return null
  return {
    id: o.id,
    version: typeof o.version === "number" && Number.isFinite(o.version) ? o.version : 1,
    title: o.title,
    body: typeof o.body === "string" ? o.body : null,
    options,
    allowDismiss: o.allowDismiss !== false,
    minAppVersion: typeof o.minAppVersion === "string" ? o.minAppVersion : null,
    expiresAt: typeof o.expiresAt === "string" ? o.expiresAt : null,
    ended: o.ended === true,
  }
}

export function parseProductPollResults(raw: unknown): ProductPollResults | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.pollId !== "string") return null
  if (typeof o.total !== "number") return null
  if (!o.counts || typeof o.counts !== "object") return null
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(o.counts as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) counts[k] = v
  }
  return {
    pollId: o.pollId,
    total: o.total,
    counts,
    winnerId: typeof o.winnerId === "string" ? o.winnerId : null,
    ended: o.ended === true,
  }
}

export type ShouldShowPollArgs = {
  poll: ProductPoll | null
  appVersion: string | null
  answered: ProductPollAnswerMap
  dismissed: ProductPollDismissMap
  nowMs?: number
}

/** Eligible for soft badge / unanswered prompt on Polls page. */
export function shouldShowUnansweredPoll(args: ShouldShowPollArgs): boolean {
  const { poll, appVersion, answered, dismissed, nowMs = Date.now() } = args
  if (!poll) return false
  if (poll.ended || isPollExpired(poll.expiresAt, nowMs)) return false
  if (!versionSatisfies(appVersion, poll.minAppVersion)) return false
  if (answered[poll.id]) return false
  if (dismissed[poll.id]) return false
  return true
}

export function shouldThrottleFetch(lastFetchAt: number | null, nowMs = Date.now()): boolean {
  if (lastFetchAt == null) return false
  return nowMs - lastFetchAt < PRODUCT_POLLS_FETCH_THROTTLE_MS
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export type ActiveProductPollFetch =
  | { ok: true; poll: ProductPoll | null }
  | { ok: false }

export async function fetchActiveProductPoll(args: {
  appVersion: string | null
  baseUrl?: string
  timeoutMs?: number
}): Promise<ActiveProductPollFetch> {
  const base = args.baseUrl ?? PRODUCT_POLLS_API_BASE
  const q = args.appVersion ? `?appVersion=${encodeURIComponent(args.appVersion)}` : ""
  const url = `${base}/active${q}`
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "GET", headers: { Accept: "application/json" } },
      args.timeoutMs ?? PRODUCT_POLLS_FETCH_TIMEOUT_MS,
    )
    if (res.status === 204) return { ok: true, poll: null }
    if (!res.ok) {
      console.warn("[product-polls] active HTTP", res.status, url)
      return { ok: false }
    }
    const text = await res.text()
    if (!text.trim()) return { ok: false }
    const parsed = parseProductPoll(JSON.parse(text) as unknown)
    if (!parsed) {
      console.warn("[product-polls] active payload rejected by parser", text.slice(0, 200))
      return { ok: false }
    }
    return { ok: true, poll: parsed }
  } catch (e) {
    console.warn("[product-polls] active fetch failed", e)
    return { ok: false }
  }
}

export async function submitProductPollVote(args: {
  pollId: string
  installId: string
  optionId: string
  baseUrl?: string
  timeoutMs?: number
}): Promise<{
  ok: boolean
  results: ProductPollResults | null
  error: "rate_limited" | "failed" | null
}> {
  const base = args.baseUrl ?? PRODUCT_POLLS_API_BASE
  try {
    const res = await fetchWithTimeout(
      `${base}/${encodeURIComponent(args.pollId)}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ installId: args.installId, optionId: args.optionId }),
      },
      args.timeoutMs ?? PRODUCT_POLLS_FETCH_TIMEOUT_MS,
    )
    if (res.status === 429) return { ok: false, results: null, error: "rate_limited" }
    if (!res.ok) return { ok: false, results: null, error: "failed" }
    const raw = (await res.json()) as { ok?: boolean; results?: unknown }
    return {
      ok: raw.ok === true,
      results: parseProductPollResults(raw.results) ?? null,
      error: raw.ok === true ? null : "failed",
    }
  } catch {
    return { ok: false, results: null, error: "failed" }
  }
}

export async function fetchProductPollResults(args: {
  pollId: string
  installId: string
  baseUrl?: string
  timeoutMs?: number
}): Promise<{ results: ProductPollResults | null; status: number }> {
  const base = args.baseUrl ?? PRODUCT_POLLS_API_BASE
  const q = `?installId=${encodeURIComponent(args.installId)}`
  try {
    const res = await fetchWithTimeout(
      `${base}/${encodeURIComponent(args.pollId)}/results${q}`,
      { method: "GET", headers: { Accept: "application/json" } },
      args.timeoutMs ?? PRODUCT_POLLS_FETCH_TIMEOUT_MS,
    )
    if (!res.ok) return { results: null, status: res.status }
    return {
      results: parseProductPollResults(await res.json()),
      status: res.status,
    }
  } catch {
    return { results: null, status: 0 }
  }
}

export async function submitProductPollDismiss(args: {
  pollId: string
  installId: string
  reason: "not_now" | "dont_ask"
  baseUrl?: string
  timeoutMs?: number
}): Promise<boolean> {
  const base = args.baseUrl ?? PRODUCT_POLLS_API_BASE
  try {
    const res = await fetchWithTimeout(
      `${base}/${encodeURIComponent(args.pollId)}/dismiss`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ installId: args.installId, reason: args.reason }),
      },
      args.timeoutMs ?? PRODUCT_POLLS_FETCH_TIMEOUT_MS,
    )
    if (!res.ok) return false
    const raw = (await res.json()) as { ok?: boolean }
    return raw.ok === true
  } catch {
    return false
  }
}

export function newInstallId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `install-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
