import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UsageSparkline } from "@/components/usage-sparkline"
import type { WidgetData } from "@/lib/widget-data"
import { meterFraction } from "@/lib/widget-data"
import type { PaceStatus } from "@/lib/pace-status"
import { getPaceStatusText } from "@/lib/pace-tooltip"
import { cn } from "@/lib/utils"

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

type WidgetRowProps = {
  data: WidgetData
  compact?: boolean
  className?: string
}

function PaceDot({ data }: { data: WidgetData }) {
  if (!data.bounded || !data.paceStatus) return null
  const status = data.paceStatus
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", PACE_DOT[status])}
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

export function WidgetRow({ data, compact, className }: WidgetRowProps) {
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
        <span
          className={cn(
            "font-medium tabular-nums shrink-0",
            data.loading && "text-muted-foreground animate-pulse",
          )}
        >
          {data.textValue}
        </span>
      </div>
    )
  }

  const fraction = meterFraction(data)
  const fillClass =
    data.paceStatus && !data.isLimitReached
      ? PACE_FILL[data.paceStatus]
      : "bg-primary"

  return (
    <div className={cn(compact ? "py-1" : "py-1.5", className)}>
      <div className={cn("flex items-center gap-1.5 mb-1", compact ? "text-xs" : "text-sm")}>
        <PaceDot data={data} />
        <span className="font-medium truncate flex-1">{data.label}</span>
        <span className="tabular-nums shrink-0">{data.textValue}</span>
      </div>
      <div className={cn("rounded-full bg-muted overflow-hidden", compact ? "h-1" : "h-1.5")}>
        <div
          className={cn("h-full rounded-full transition-all", fillClass)}
          style={{ width: `${Math.round(fraction * 100)}%` }}
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
