import type { BarChartPoint, MetricLine } from "@/lib/plugin-types"
import type { DisplayMode, ResetTimerDisplayMode } from "@/lib/settings"
import { calculatePaceStatus, type PaceStatus } from "@/lib/pace-status"
import { formatRunsOutText } from "@/lib/pace-tooltip"
import { formatResetRelativeLabel } from "@/lib/reset-tooltip"
import { isProgressLine } from "@/lib/primary-progress-line"
import { clamp01, formatCountNumber } from "@/lib/utils"
import { formatMoney } from "@/lib/locale-format"

export type WidgetKind = "progress" | "text" | "badge" | "barChart"

export type WidgetData = {
  metricId: string
  label: string
  displayName: string
  kind: WidgetKind
  bounded: boolean
  used: number | null
  limit: number | null
  resetsAt: string | null
  periodDurationMs: number | null
  textValue: string | null
  textSecondary: string | null
  paceStatus: PaceStatus | null
  paceDetail: string | null
  isLimitReached: boolean
  barChartPoints?: BarChartPoint[]
  barChartNote?: string
  loading?: boolean
}

export function placeholderWidgetData(args: {
  metricId: string
  label: string
  displayName: string
  bounded?: boolean
}): WidgetData {
  return {
    metricId: args.metricId,
    label: args.label,
    displayName: args.displayName,
    kind: "text",
    bounded: args.bounded ?? false,
    used: null,
    limit: null,
    resetsAt: null,
    periodDurationMs: null,
    textValue: "…",
    textSecondary: null,
    paceStatus: null,
    paceDetail: null,
    isLimitReached: false,
    loading: true,
  }
}

function progressPrimaryText(
  line: Extract<MetricLine, { type: "progress" }>,
  displayMode: DisplayMode,
): string {
  const shownAmount =
    displayMode === "used" ? line.used : Math.max(0, line.limit - line.used)
  const leftSuffix = displayMode === "left" ? " left" : ""
  if (line.format.kind === "percent") {
    return `${Math.round(shownAmount)}%${leftSuffix}`
  }
  if (line.format.kind === "dollars") {
    return `${formatMoney(shownAmount, { sourceCurrency: "USD" })}${leftSuffix}`
  }
  return `${formatCountNumber(shownAmount)} ${line.format.suffix}${leftSuffix}`
}

export function resolveWidgetData(args: {
  metricId: string
  displayName: string
  line: MetricLine | undefined
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  nowMs?: number
}): WidgetData | null {
  const { metricId, displayName, line, displayMode, resetTimerDisplayMode, nowMs = Date.now() } = args
  if (!line) return null

  if (line.type === "barChart") {
    return {
      metricId,
      label: line.label,
      displayName,
      kind: "barChart",
      bounded: false,
      used: null,
      limit: null,
      resetsAt: null,
      periodDurationMs: null,
      textValue: null,
      textSecondary: line.note ?? null,
      paceStatus: null,
      paceDetail: null,
      isLimitReached: false,
      barChartPoints: line.points,
      barChartNote: line.note,
    }
  }

  if (isProgressLine(line)) {
    const used = line.used
    const limit = line.limit
    const resetsAtMs = line.resetsAt ? Date.parse(line.resetsAt) : null
    const periodDurationMs = line.periodDurationMs ?? null
    let paceStatus: PaceStatus | null = null
    let paceDetail: string | null = null
    if (
      line.format.kind === "percent" &&
      resetsAtMs != null &&
      periodDurationMs != null &&
      periodDurationMs > 0
    ) {
      const pace = calculatePaceStatus(used, limit, resetsAtMs, periodDurationMs, nowMs)
      if (pace) {
        paceStatus = pace.status
        if (pace.status === "behind") {
          paceDetail = formatRunsOutText({
            paceResult: pace,
            used,
            limit,
            periodDurationMs,
            resetsAtMs,
            nowMs,
          })
        }
      }
    }
    const resetLabel =
      line.resetsAt && resetTimerDisplayMode === "relative"
        ? formatResetRelativeLabel(nowMs, line.resetsAt)
        : line.resetsAt
          ? `Resets ${line.resetsAt}`
          : null

    return {
      metricId,
      label: line.label,
      displayName,
      kind: "progress",
      bounded: true,
      used,
      limit,
      resetsAt: line.resetsAt ?? null,
      periodDurationMs,
      textValue: progressPrimaryText(line, displayMode),
      textSecondary: resetLabel,
      paceStatus,
      paceDetail,
      isLimitReached: limit > 0 && used >= limit,
    }
  }

  if (line.type === "text" || line.type === "badge") {
    const value =
      line.type === "text" ? String(line.value ?? "") : String(line.text ?? "")
    return {
      metricId,
      label: line.label,
      displayName,
      kind: line.type,
      bounded: false,
      used: null,
      limit: null,
      resetsAt: null,
      periodDurationMs: null,
      textValue: value,
      textSecondary: line.subtitle ?? null,
      paceStatus: null,
      paceDetail: null,
      isLimitReached: false,
    }
  }

  return null
}

export function meterFraction(data: WidgetData): number {
  if (!data.bounded || data.used == null || data.limit == null || data.limit <= 0) return 0
  return clamp01(data.used / data.limit)
}

export function remainingFraction(data: WidgetData): number {
  return 1 - meterFraction(data)
}
