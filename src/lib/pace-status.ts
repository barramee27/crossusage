export type PaceStatus = "ahead" | "on-track" | "behind"

export type PaceResult = {
  status: PaceStatus
  /** Projected usage at end of period (same unit as used/limit) */
  projectedUsage: number
}

/** Minimum elapsed time before burn-rate projection is meaningful. */
export function minimumElapsedMs(periodDurationMs: number): number {
  if (!Number.isFinite(periodDurationMs) || periodDurationMs <= 0) return 60_000
  return Math.max(60_000, periodDurationMs * 0.01)
}

/**
 * A rolling window whose reset is still (nearly) a full period away has not started yet.
 */
export function isFreshUsageWindow(
  resetsAtMs: number,
  periodDurationMs: number,
  nowMs: number
): boolean {
  if (!Number.isFinite(resetsAtMs) || !Number.isFinite(periodDurationMs) || periodDurationMs <= 0) {
    return false
  }
  if (!Number.isFinite(nowMs) || nowMs >= resetsAtMs) return false
  const graceMs = minimumElapsedMs(periodDurationMs)
  return resetsAtMs - nowMs >= periodDurationMs - graceMs
}

/**
 * Calculate pace status based on current usage rate vs. period duration.
 */
export function calculatePaceStatus(
  used: number,
  limit: number,
  resetsAtMs: number,
  periodDurationMs: number,
  nowMs: number
): PaceResult | null {
  if (
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    !Number.isFinite(resetsAtMs) ||
    !Number.isFinite(periodDurationMs) ||
    !Number.isFinite(nowMs)
  ) {
    return null
  }

  if (limit <= 0 || periodDurationMs <= 0) return null

  const periodStartMs = resetsAtMs - periodDurationMs
  const elapsedMs = nowMs - periodStartMs
  if (elapsedMs <= 0 || nowMs >= resetsAtMs) return null

  // No usage = definitionally ahead of pace (skip minimum-elapsed threshold)
  if (used === 0) return { status: "ahead", projectedUsage: 0 }

  const minElapsed = minimumElapsedMs(periodDurationMs)
  if (elapsedMs < minElapsed) return null

  const usageRate = used / elapsedMs
  const projectedUsage = usageRate * periodDurationMs

  // Already at/over limit = definitionally behind (skip minimum-elapsed threshold)
  if (used >= limit) return { status: "behind", projectedUsage }

  // Normal classification
  let status: PaceStatus
  if (projectedUsage <= limit * 0.8) {
    status = "ahead"
  } else if (projectedUsage <= limit) {
    status = "on-track"
  } else {
    status = "behind"
  }

  return { status, projectedUsage }
}

/**
 * How much usage exceeds the ideal linear pace (same unit as used/limit).
 * Returns positive deficit or null when ahead/on-pace/incalculable.
 */
export function calculateDeficit(
  used: number,
  limit: number,
  resetsAtMs: number,
  periodDurationMs: number,
  nowMs: number
): number | null {
  if (
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    !Number.isFinite(resetsAtMs) ||
    !Number.isFinite(periodDurationMs) ||
    !Number.isFinite(nowMs)
  ) {
    return null
  }
  if (limit <= 0 || periodDurationMs <= 0) return null

  const periodStartMs = resetsAtMs - periodDurationMs
  const elapsedMs = nowMs - periodStartMs
  if (elapsedMs <= 0 || nowMs >= resetsAtMs) return null

  const minElapsed = minimumElapsedMs(periodDurationMs)
  if (elapsedMs < minElapsed && used < limit) return null

  const elapsedFraction = elapsedMs / periodDurationMs
  const expectedUsage = elapsedFraction * limit
  const deficit = used - expectedUsage
  return deficit > 0 ? deficit : null
}

/** Round reset timestamps to the nearest minute so sub-minute jitter does not re-fire alerts. */
export function stableResetKeyMs(resetsAtMs: number): number {
  if (!Number.isFinite(resetsAtMs)) return resetsAtMs
  return Math.round(resetsAtMs / 60_000) * 60_000
}
