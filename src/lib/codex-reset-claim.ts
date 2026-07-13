export type ResetClaimOutcome = "success" | "nothing_to_reset" | "no_credit" | "failed"

export type ResetCreditsContent =
  | { kind: "timeline"; expiries: string[] }
  | { kind: "unknownExpiries"; count: number }
  | { kind: "empty" }

/** Collapse consume HTTP response → popover outcome (mirrors CodexResetClaimService.outcome). */
export function outcomeFromConsume(statusCode: number, bodyText: string): ResetClaimOutcome {
  if (statusCode < 200 || statusCode >= 300) return "failed"
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return "failed"
  }
  if (!body || typeof body !== "object") return "failed"
  const code = (body as { code?: unknown }).code
  if (typeof code !== "string") return "failed"
  switch (code) {
    case "reset":
    case "already_redeemed":
      return "success"
    case "nothing_to_reset":
      return "nothing_to_reset"
    case "no_credit":
      return "no_credit"
    default:
      return "failed"
  }
}

export function parseExpiryMs(value: unknown): number | null {
  if (typeof value === "string") {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds since epoch if small; otherwise ms.
    return value < 1e12 ? value * 1000 : value
  }
  return null
}

/** Match an available credit by expiry (±1s). */
export function creditIdForExpiry(
  body: { credits?: unknown },
  expiryMs: number,
): string | null {
  const credits = body.credits
  if (!Array.isArray(credits)) return null
  for (const credit of credits) {
    if (!credit || typeof credit !== "object") continue
    const row = credit as { status?: unknown; expires_at?: unknown; id?: unknown }
    if (typeof row.status === "string" && row.status !== "available") continue
    const ms = parseExpiryMs(row.expires_at)
    if (ms == null) continue
    if (Math.abs(ms - expiryMs) < 1000 && typeof row.id === "string" && row.id) {
      return row.id
    }
  }
  return null
}

/** Empty expiries + count>0 → unknown; count 0 → empty; else timeline. */
export function resetsDetailContent(count: number, expiries: string[]): ResetCreditsContent {
  const valid = expiries.filter((iso) => Number.isFinite(Date.parse(iso)))
  if (valid.length > 0) return { kind: "timeline", expiries: [...valid].sort() }
  if (count > 0) return { kind: "unknownExpiries", count }
  return { kind: "empty" }
}

export function claimBannerText(outcome: ResetClaimOutcome): string {
  switch (outcome) {
    case "success":
      return "Reset claimed. Enjoy!"
    case "nothing_to_reset":
      return "Your usage doesn't need a reset yet"
    case "no_credit":
      return "That reset is no longer available"
    case "failed":
      return "Couldn't reset usage. Please try again."
  }
}

const IMMINENT_MS = 5 * 60 * 1000
const CRITICAL_MS = 48 * 60 * 60 * 1000
const WARNING_MS = 7 * 24 * 60 * 60 * 1000

export type ExpirySeverity = "normal" | "warning" | "critical"

export function expirySeverity(remainingMs: number): ExpirySeverity {
  if (remainingMs <= CRITICAL_MS) return "critical"
  if (remainingMs <= WARNING_MS) return "warning"
  return "normal"
}

export function formatExpiryCountdown(remainingMs: number): string | null {
  if (remainingMs <= IMMINENT_MS) return null
  const abs = Math.max(0, remainingMs)
  const hours = Math.floor(abs / (60 * 60 * 1000))
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  if (days > 0) return `${days}d ${remHours}h`
  return `${hours}h`
}

export function formatExpiryTime(iso: string, nowMs = Date.now()): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "Unknown"
  if (ms - nowMs <= IMMINENT_MS) return "Expiring soon"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms)
}

export function parseAvailableCount(value: string): number {
  const match = String(value ?? "").match(/(\d+)\s+available/i)
  if (!match) return 0
  const n = Number(match[1])
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}
