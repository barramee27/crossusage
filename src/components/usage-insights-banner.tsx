import { useMemo, useState } from "react"
import { UsageSparkline } from "@/components/usage-sparkline"
import { dismissInsight, filterDismissedInsights } from "@/lib/insight-dismiss"
import type { UsageInsight } from "@/lib/usage-insights"
import {
  buildAggregatedSparklinePoints,
  countDistinctDaysInWindow,
} from "@/lib/usage-daily-sparkline"
import type { UsageDailyRow } from "@/lib/usage-daily"
import {
  formatRollupSummary,
  rollingWindowDays,
  type WeeklyRollupResult,
} from "@/lib/weekly-rollup"
import {
  formatHistoryTightestMessage,
  type HistoryInsightTightest,
} from "@/lib/usage-history-insights"

type UsageInsightsBannerProps = {
  insights: UsageInsight[]
  historyTightest?: HistoryInsightTightest[]
  rollup: WeeklyRollupResult | null
  rollup30: WeeklyRollupResult | null
  dailyRows?: UsageDailyRow[]
  persistEnabled: boolean
  nowMs: number
  onSelectProvider?: (instanceId: string) => void
  className?: string
}

function insightIcon(kind: UsageInsight["kind"]): string {
  if (kind === "pace") return "⚠"
  if (kind === "tight") return "◎"
  return "↻"
}

export function UsageInsightsBanner({
  insights,
  historyTightest = [],
  rollup,
  rollup30,
  dailyRows = [],
  persistEnabled,
  nowMs,
  onSelectProvider,
  className,
}: UsageInsightsBannerProps) {
  const [, bump] = useState(0)

  const visibleInsights = useMemo(
    () => filterDismissedInsights(insights, nowMs),
    [insights, nowMs, bump],
  )

  const sparklineWindow = rollingWindowDays(7, new Date(nowMs)).current
  const sparklinePoints = useMemo(
    () => buildAggregatedSparklinePoints(dailyRows, sparklineWindow),
    [dailyRows, sparklineWindow.startDay, sparklineWindow.endDay],
  )
  const showSparkline =
    persistEnabled && sparklinePoints.length >= 2

  const showRollup30 =
    rollup30 != null &&
    countDistinctDaysInWindow(dailyRows, rollup30.currentWindow) >= 7

  const showRollupHint = !persistEnabled
  const hasInsights = visibleInsights.length > 0
  const hasHistoryTightest = persistEnabled && historyTightest.length > 0
  const hasRollup = rollup != null

  if (!hasInsights && !hasHistoryTightest && !hasRollup && !showRollup30 && !showSparkline && !showRollupHint) {
    return null
  }

  const handleDismiss = (row: UsageInsight, e: React.MouseEvent) => {
    e.stopPropagation()
    const until = row.dismissUntilMs ?? nowMs + 86_400_000
    dismissInsight(row, until)
    bump((n) => n + 1)
  }

  return (
    <section
      className={cn(
        "mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1.5",
        className,
      )}
      aria-label="Usage insights"
    >
      {hasInsights ? (
        <ul className="space-y-1">
          {visibleInsights.map((row) => (
            <li
              key={`${row.kind}-${row.instanceId}-${row.lineLabel}`}
              className="flex items-start gap-1 text-foreground/90"
            >
              <button
                type="button"
                className="flex-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                onClick={() => onSelectProvider?.(row.instanceId)}
              >
                <span className="text-muted-foreground mr-1.5" aria-hidden>
                  {insightIcon(row.kind)}
                </span>
                {row.message}
              </button>
              <button
                type="button"
                className="shrink-0 px-1 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss insight"
                onClick={(e) => handleDismiss(row, e)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {hasHistoryTightest ? (
        <ul className="space-y-1">
          {historyTightest.map((row) => (
            <li key={`history-${row.instanceId}`} className="text-foreground/90">
              <button
                type="button"
                className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                onClick={() => onSelectProvider?.(row.instanceId)}
              >
                <span className="text-muted-foreground mr-1.5" aria-hidden>
                  ⧉
                </span>
                {formatHistoryTightestMessage(row)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {hasRollup ? (
        <p className="text-foreground/90">
          <span className="text-muted-foreground mr-1.5" aria-hidden>
            ∑
          </span>
          {formatRollupSummary(rollup)}
          {rollup.topContributors.length > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              — {rollup.topContributors.map((c) => c.displayName).join(", ")}
            </span>
          ) : null}
        </p>
      ) : null}

      {showRollup30 ? (
        <p className="text-foreground/90">
          <span className="text-muted-foreground mr-1.5" aria-hidden>
            ∑
          </span>
          {formatRollupSummary(rollup30!)}
        </p>
      ) : null}

      {showSparkline ? (
        <UsageSparkline
          label="Last 7d (all accounts)"
          points={sparklinePoints}
          note="Estimated from local logs (not billing)."
        />
      ) : null}

      {(hasRollup || showRollup30) && !showSparkline ? (
        <span className="block text-[10px] text-muted-foreground">
          Estimated from local logs (not billing).
        </span>
      ) : null}

      {showRollupHint ? (
        <p className="text-muted-foreground">Enable usage history for weekly totals.</p>
      ) : null}
    </section>
  )
}
