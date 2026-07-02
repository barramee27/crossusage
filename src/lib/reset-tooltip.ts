import type { ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"
import i18n from "@/i18n"
import { formatCompactDuration } from "@/lib/pace-tooltip"

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}

const timeFormatterCache = new Map<TimeFormatMode, Intl.DateTimeFormat>()

export function getTimeFormatter(mode: TimeFormatMode): Intl.DateTimeFormat {
  const cached = timeFormatterCache.get(mode)
  if (cached) return cached
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
  if (mode === "12h") opts.hour12 = true
  else if (mode === "24h") opts.hour12 = false
  const formatter = new Intl.DateTimeFormat(undefined, opts)
  timeFormatterCache.set(mode, formatter)
  return formatter
}

const RESET_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

const RESET_SOON_THRESHOLD_MS = 5 * 60 * 1000
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

export type ResetLineContext = {
  used?: number
  periodDurationMs?: number
  label?: string
}

export function isFreshSessionWindow(
  nowMs: number,
  resetsAtIso: string,
  lineContext?: ResetLineContext,
): boolean {
  if (!lineContext || lineContext.used === undefined || lineContext.used > 0) return false
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null || nowMs >= resetsAtMs) return false
  if (lineContext.periodDurationMs === FIVE_HOURS_MS) return true
  if (lineContext.label === "Session") return true
  return false
}

function parseResetTimestamp(resetsAtIso: string): number | null {
  const resetsAtMs = Date.parse(resetsAtIso)
  return Number.isFinite(resetsAtMs) ? resetsAtMs : null
}

function getLocalDayIndex(timestampMs: number): number {
  const date = new Date(timestampMs)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

function formatMonthDay(timestampMs: number): string {
  return RESET_MONTH_DAY_FORMATTER.format(timestampMs)
}

export function formatResetRelativeLabel(
  nowMs: number,
  resetsAtIso: string,
  lineContext?: ResetLineContext,
): string | null {
  if (isFreshSessionWindow(nowMs, resetsAtIso, lineContext)) {
    return t("reset.notStarted")
  }
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null) return null
  const deltaMs = resetsAtMs - nowMs
  if (deltaMs < RESET_SOON_THRESHOLD_MS) return t("reset.resetsSoon")
  const durationText = formatCompactDuration(deltaMs)
  return durationText ? t("reset.resetsIn", { duration: durationText }) : null
}

export function formatResetAbsoluteLabel(
  nowMs: number,
  resetsAtIso: string,
  timeFormatMode: TimeFormatMode = "auto",
): string | null {
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null) return null
  if (resetsAtMs - nowMs <= 0) return t("reset.resetsSoon")
  const dayDiff = getLocalDayIndex(resetsAtMs) - getLocalDayIndex(nowMs)
  const timeText = getTimeFormatter(timeFormatMode).format(resetsAtMs)
  if (dayDiff <= 0) return t("reset.resetsTodayAt", { time: timeText })
  if (dayDiff === 1) return t("reset.resetsTomorrowAt", { time: timeText })
  const dateText = formatMonthDay(resetsAtMs)
  return t("reset.resetsDateAt", { date: dateText, time: timeText })
}

export function formatResetTooltipText({
  nowMs,
  resetsAtIso,
  visibleMode,
  timeFormatMode = "auto",
  lineContext,
}: {
  nowMs: number
  resetsAtIso: string
  visibleMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  lineContext?: ResetLineContext
}): string | null {
  if (isFreshSessionWindow(nowMs, resetsAtIso, lineContext)) {
    return t("reset.freshSessionTooltip")
  }
  return visibleMode === "absolute"
    ? formatResetRelativeLabel(nowMs, resetsAtIso)
    : formatResetAbsoluteLabel(nowMs, resetsAtIso, timeFormatMode)
}
