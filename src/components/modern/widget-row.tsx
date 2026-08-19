import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RateLimitResetsValue } from "@/components/rate-limit-resets-popover"
import { UsageSparkline } from "@/components/usage-sparkline"
import type { WidgetData } from "@/lib/widget-data"
import { meterFraction } from "@/lib/widget-data"
import type { PaceStatus } from "@/lib/pace-status"
import { getPaceStatusText } from "@/lib/pace-tooltip"
import { formatMoney } from "@/lib/locale-format"
import { cn } from "@/lib/utils"
import { MotionNumber } from "@/components/motion-number"

const PACE_DOT: Record<PaceStatus, string> = {
  ahead: "bg-green-500",
  "on-track": "bg-yellow-500",
  behind: "bg-red-500",
}

const PACE_FILL: Record<PaceStatus, string> = {
  ahead: "bg-green-500",
  "on-track": "bg-yellow-500",
  behind: "bg-red-500",
}

const EXPIRY_DOT: Record<string, string> = {
  normal: "bg-blue-500",
  warning: "bg-yellow-500",
  critical: "bg-red-500",
}

const SPEND_LABELS = new Set(["today", "yesterday", "last 30 days"])

type WidgetRowProps = {
  data: WidgetData
  compact?: boolean
  className?: string
  onRefreshPlugin?: (pluginId: string) => void
}

function PaceDot({ data }: { data: WidgetData }) {
  if (!data.bounded || !data.paceStatus) return null
  const status = data.paceStatus
  const dotColor = data.color
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0 motion-dot", !dotColor && PACE_DOT[status])}
            style={dotColor ? { backgroundColor: dotColor } : undefined}
            aria-label={data.isLimitReached ? "Limit reached" : getPaceStatusText(status)}
          />
        )}
      />
      <TooltipContent side="top" className="text-xs text-center max-w-[200px]">
        {data.isLimitReached ? "Limit reached" : getPaceStatusText(status)}
        {data.paceDetail ? (
          <div className="text-[10px] opacity-70 mt-0.5">{data.paceDetail}</div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function TextValue({ data, compact, onRefreshPlugin }: WidgetRowProps) {
  const isResets = data.label === "Rate Limit Resets"
  const showBreakdown =
    Boolean(data.modelBreakdown?.length) &&
    SPEND_LABELS.has(data.label.trim().toLowerCase())

  let valueNode: ReactNode = (
    <span
      className={cn(
        "font-medium tabular-nums shrink-0",
        data.loading && "text-muted-foreground animate-pulse",
      )}
    >
      {data.textValue}
    </span>
  )

  if (isResets) {
    valueNode = (
      <RateLimitResetsValue
        countLabel={data.textValue ?? "0 available"}
        expiries={data.resetCreditExpiries ?? []}
        pluginId={data.pluginId}
        compact={compact}
        onClaimed={() => {
          if (data.pluginId) onRefreshPlugin?.(data.pluginId)
        }}
      />
    )
  } else if (showBreakdown && data.modelBreakdown) {
    const breakdown = data.modelBreakdown
    const priced = breakdown.filter((row) => row.costUsd != null && row.costUsd > 0)
    valueNode = (
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <span
              {...props}
              className={cn(
                "font-medium tabular-nums shrink-0 underline decoration-dotted underline-offset-2 cursor-default",
                props.className,
              )}
            >
              {data.textValue}
            </span>
          )}
        />
        <TooltipContent side="left" className="max-w-xs p-2">
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5">By model</p>
          <ul className="space-y-1">
            {breakdown.map((row) => (
              <li key={row.model} className="flex justify-between gap-3 text-xs">
                <span className="truncate" title={row.model}>
                  {row.model}
                </span>
                <span className="shrink-0 tabular-nums">
                  {row.percent}%
                  {row.costUsd != null && row.costUsd > 0
                    ? ` · ${formatMoney(row.costUsd, { sourceCurrency: "USD" })}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
          {priced.length < breakdown.length ? (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Totals exclude unpriced models.
            </p>
          ) : null}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (!data.statusDot || isResets) return valueNode

  const dot = (
    <span
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", EXPIRY_DOT[data.statusDot])}
      aria-hidden
    />
  )

  if (data.expiryTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <span {...props} className={cn("flex items-center gap-1", props.className)}>
              {dot}
              {valueNode}
            </span>
          )}
        />
        <TooltipContent side="left" className="max-w-xs whitespace-pre-line text-xs">
          {data.expiryTooltip}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className="flex items-center gap-1">
      {dot}
      {valueNode}
    </span>
  )
}

export function WidgetRow({ data, compact, className, onRefreshPlugin }: WidgetRowProps) {
  if (data.kind === "barChart" && data.barChartPoints?.length) {
    return (
      <div className={cn(compact ? "py-1" : "py-1.5", className)}>
        <UsageSparkline
          label={data.label}
          points={data.barChartPoints}
          note={data.barChartNote}
        />
      </div>
    )
  }

  if (!data.bounded) {
    return (
      <div
        className={cn(
          "flex items-baseline justify-between gap-2",
          compact ? "py-0.5 text-xs" : "py-1 text-sm",
          className,
        )}
      >
        <span className="text-muted-foreground truncate">{data.label}</span>
        <TextValue data={data} compact={compact} onRefreshPlugin={onRefreshPlugin} />
      </div>
    )
  }

  const fraction = meterFraction(data)
  const fillClass =
    data.paceStatus && !data.isLimitReached
      ? PACE_FILL[data.paceStatus]
      : "bg-primary"
  const fillColor = data.color

  return (
    <div className={cn(compact ? "py-1" : "py-1.5", className)}>
      <div className={cn("flex items-center gap-1.5 mb-1", compact ? "text-xs" : "text-sm")}>
        <PaceDot data={data} />
        <span className="font-medium truncate flex-1">{data.label}</span>
        <span className="tabular-nums shrink-0">
          {data.textValue ? <MotionNumber value={data.textValue} className="motion-number" /> : null}
        </span>
      </div>
      <div className={cn("relative rounded-full bg-muted overflow-hidden", compact ? "h-1" : "h-1.5")}>
        <div
          className={cn("h-full rounded-full", !fillColor && fillClass)}
          style={{
            width: `${Math.round(fraction * 100)}%`,
            ...(fillColor ? { backgroundColor: fillColor } : {}),
          }}
        />
      </div>
      {data.textSecondary ? (
        <p className={cn("text-muted-foreground mt-0.5", compact ? "text-[10px]" : "text-xs")}>
          {data.textSecondary}
        </p>
      ) : null}
    </div>
  )
}
