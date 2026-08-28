import { Fragment, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { AlertCircle, ExternalLink, Hourglass, RefreshCw } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SkeletonLines } from "@/components/skeleton-lines"
import { UsageSparkline } from "@/components/usage-sparkline"
import { PluginError } from "@/components/plugin-error"
import { useNowTicker } from "@/hooks/use-now-ticker"
import { REFRESH_COOLDOWN_MS, type DisplayMode, type ResetTimerDisplayMode, type TimeFormatMode } from "@/lib/settings"
import { RateLimitResetsValue } from "@/components/rate-limit-resets-popover"
import type { ExpiryStatusDot, ManifestLine, MetricLine, ModelSpendBreakdown, PluginLink } from "@/lib/plugin-types"
import { groupLinesByType } from "@/lib/group-lines-by-type"
import { clamp01, cn, formatCountNumber } from "@/lib/utils"
import { calculateDeficit, calculatePaceStatus, type PaceStatus } from "@/lib/pace-status"
import { buildPaceDetailText, formatDeficitText, formatRunsOutText, getPaceStatusText } from "@/lib/pace-tooltip"
import { formatResetAbsoluteLabel, formatResetRelativeLabel, formatResetTooltipText } from "@/lib/reset-tooltip"
import { formatMoney } from "@/lib/locale-format"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { MotionNumber } from "@/components/motion-number"

interface ProviderCardProps {
  name: string
  plan?: string
  links?: PluginLink[]
  showSeparator?: boolean
  loading?: boolean
  error?: string | null
  warning?: string | null
  lines?: MetricLine[]
  skeletonLines?: ManifestLine[]
  lastManualRefreshAt?: number | null
  lastUpdatedAt?: number | null
  onRetry?: () => void
  /** Instance id for claim actions (Codex resets). */
  pluginId?: string
  scopeFilter?: "overview" | "all"
  allowedLabels?: string[] | null
  displayMode: DisplayMode
  resetTimerDisplayMode?: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  onResetTimerDisplayModeToggle?: () => void
  showAccountIdentity?: boolean
  layout?: "default" | "detailFill"
}

const PACE_VISUALS: Record<PaceStatus, { dotClass: string }> = {
  ahead: { dotClass: "bg-green-500" },
  "on-track": { dotClass: "bg-yellow-500" },
  behind: { dotClass: "bg-red-500" },
}

/** Colored dot indicator showing pace status */
function PaceIndicator({
  status,
  detailText,
  isLimitReached,
}: {
  status: PaceStatus
  detailText?: string | null
  isLimitReached?: boolean
}) {
  const colorClass = PACE_VISUALS[status].dotClass

  const statusText = getPaceStatusText(status)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={`inline-block w-2 h-2 rounded-full motion-dot ${colorClass}`}
            aria-label={isLimitReached ? "Limit reached" : statusText}
          />
        )}
      />
      <TooltipContent side="top" className="text-xs text-center">
        {isLimitReached ? (
          "Limit reached"
        ) : (
          <>
            <div>{statusText}</div>
            {detailText && <div className="text-[10px] opacity-60">{detailText}</div>}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function formatRelativeTime(diffMs: number): string {
  const seconds = Math.floor(Math.max(0, diffMs) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProviderCard({
  name,
  plan,
  links = [],
  showSeparator = true,
  loading = false,
  error = null,
  warning = null,
  lines = [],
  skeletonLines = [],
  lastManualRefreshAt,
  lastUpdatedAt,
  onRetry,
  pluginId,
  scopeFilter = "all",
  allowedLabels = null,
  displayMode,
  resetTimerDisplayMode = "relative",
  timeFormatMode = "auto",
  onResetTimerDisplayModeToggle,
  showAccountIdentity = true,
  layout = "default",
}: ProviderCardProps) {
  const cooldownRemainingMs = useMemo(() => {
    if (!lastManualRefreshAt) return 0
    const remaining = REFRESH_COOLDOWN_MS - (Date.now() - lastManualRefreshAt)
    return remaining > 0 ? remaining : 0
  }, [lastManualRefreshAt])

  // Filter lines based on scope - match by label since runtime lines can differ from manifest
  const overviewLabels = useMemo(
    () =>
      new Set(
        skeletonLines
          .filter(line => line.scope === "overview")
          .map(line => line.label)
      ),
    [skeletonLines]
  )
  const detailScopeLabels = useMemo(
    () =>
      new Set(
        skeletonLines
          .filter(line => line.scope === "detail")
          .map(line => line.label)
      ),
    [skeletonLines]
  )
  const filteredSkeletonLines = scopeFilter === "all"
    ? skeletonLines
    : skeletonLines.filter(line => line.scope === "overview")
  const scopeFilteredLines = useMemo(() => {
    return scopeFilter === "all"
      ? lines
      : lines.filter(line => overviewLabels.has(line.label))
  }, [lines, scopeFilter, overviewLabels])

  // null = never configured → show all; [] = sentinel __NONE__ → show none
  const filteredLines = useMemo(() => {
    if (allowedLabels == null) return scopeFilteredLines
    if (allowedLabels.length === 0) return []
    if (scopeFilter === "overview") {
      return scopeFilteredLines.filter(line => allowedLabels.includes(line.label))
    }
    return scopeFilteredLines.filter(
      line =>
        allowedLabels.includes(line.label) || detailScopeLabels.has(line.label)
    )
  }, [allowedLabels, scopeFilter, scopeFilteredLines, detailScopeLabels])

  const hasResetCountdown = filteredLines.some(
    (line) => line.type === "progress" && Boolean(line.resetsAt)
  )

  // "has ever loaded" — true if either we have a prior success timestamp,
  // or the parent is passing lines directly (tests + legacy state paths).
  const hasStaleData = lastUpdatedAt != null || filteredLines.length > 0
  const isRefreshingWithData = loading && hasStaleData

  const tickerIntervalMs = cooldownRemainingMs > 0 ? 1000 : 30_000

  const now = useNowTicker({
    enabled: cooldownRemainingMs > 0 || hasResetCountdown,
    intervalMs: tickerIntervalMs,
    stopAfterMs: cooldownRemainingMs > 0 && !hasResetCountdown ? cooldownRemainingMs : null,
  })

  const inCooldown = lastManualRefreshAt
    ? now - lastManualRefreshAt < REFRESH_COOLDOWN_MS
    : false

  const visibleLinks = useMemo(
    () =>
      links
        .map((link) => ({
          label: link.label.trim(),
          url: link.url.trim(),
        }))
        .filter(
          (link) =>
            link.label.length > 0 &&
            link.url.length > 0 &&
            (link.url.startsWith("https://") || link.url.startsWith("http://"))
        ),
    [links]
  )

  const accountIdentity = useMemo(() => {
    const accountLine = filteredLines.find(
      (line) => line.type === "text" && line.label.toLowerCase() === "account"
    )
    return accountLine?.type === "text" ? accountLine.value.trim() : ""
  }, [filteredLines])

  const displayLines = useMemo(
    () => filteredLines.filter(
      (line) => !(line.type === "text" && line.label.toLowerCase() === "account")
    ),
    [filteredLines]
  )

  // Format remaining cooldown time as "Xm Ys"
  const formatRemainingTime = () => {
    if (!lastManualRefreshAt) return ""
    const remainingMs = REFRESH_COOLDOWN_MS - (now - lastManualRefreshAt)
    if (remainingMs <= 0) return ""
    const totalSeconds = Math.ceil(remainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) {
      return `Available in ${minutes}m ${seconds}s`
    }
    return `Available in ${seconds}s`
  }

  return (
    <div
      className={cn(
        "w-full min-w-0",
        layout === "detailFill" && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <div
        className={cn(
          "px-3 py-3 liquid-glass-card",
          layout === "detailFill" && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <h2
              className="min-w-0 truncate text-lg font-semibold motion-title"
              style={{ transform: "translateZ(0)" }}
            >
              {name}
            </h2>
            {onRetry && (
              loading ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-1 pointer-events-none opacity-50"
                  style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
                  tabIndex={-1}
                >
                  <RefreshCw className="h-3 w-3 motion-spin-boost animate-spin" />
                </Button>
              ) : inCooldown ? (
                <Tooltip>
                  <TooltipTrigger
                    className="ml-1"
                    render={(props) => (
                      <span {...props} className={props.className}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="pointer-events-none opacity-50"
                          style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
                          tabIndex={-1}
                        >
                          <Hourglass className="h-3 w-3" />
                        </Button>
                      </span>
                    )}
                  />
                  <TooltipContent side="top">
                    {formatRemainingTime()}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    className="ml-1"
                    render={(props) => (
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Retry"
                        onClick={(e) => {
                          e.currentTarget.blur()
                          onRetry()
                        }}
                        className="opacity-0 hover:opacity-100 focus-visible:opacity-100"
                        style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                  />
                  {lastUpdatedAt != null && (
                    <TooltipContent side="top">
                      Updated {formatRelativeTime(Date.now() - lastUpdatedAt)}
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            )}
          </div>
          {(showAccountIdentity && accountIdentity) || plan ? (
            <div className="flex min-w-0 shrink items-center justify-end gap-1.5 overflow-hidden">
              {showAccountIdentity && accountIdentity && (
                <Badge
                  variant="secondary"
                  className="min-w-0 max-w-[9rem] shrink truncate"
                  title={accountIdentity}
                >
                  {accountIdentity}
                </Badge>
              )}
              {plan && (
                <Badge
                  variant="outline"
                  className="min-w-0 max-w-[11rem] shrink truncate"
                  title={plan}
                >
                  {plan}
                </Badge>
              )}
            </div>
          ) : null}
        </div>
        {visibleLinks.length > 0 && (
          <div className="mb-2 -mt-0.5 flex flex-wrap gap-1.5">
            {visibleLinks.map((link) => (
              <Button
                key={`${link.label}-${link.url}`}
                variant="outline"
                size="xs"
                className="h-6 max-w-full text-[11px]"
                onClick={() => {
                  openUrl(link.url).catch(console.error)
                }}
              >
                <span className="truncate">{link.label}</span>
                <ExternalLink className="size-3 opacity-70" />
              </Button>
            ))}
          </div>
        )}
        {warning ? (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{warning}</span>
          </div>
        ) : null}
        {error && !hasStaleData && <PluginError message={error} />}

        {error && hasStaleData && (
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <div
                  {...props}
                  className="flex items-center gap-1.5 mb-2 text-xs text-destructive"
                >
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{error}</span>
                </div>
              )}
            />
            <TooltipContent side="top" className="max-w-xs break-words text-xs">
              {error}
            </TooltipContent>
          </Tooltip>
        )}

        {loading && !hasStaleData && !error && (
          <SkeletonLines lines={filteredSkeletonLines} />
        )}

        {hasStaleData && (
          <div className="space-y-4">
            {groupLinesByType(displayLines).map((group, gi) =>
              group.kind === "text" ? (
                <div key={gi} className="space-y-1">
                  {group.lines.map((line, li) => (
                    <MetricLineRenderer
                      key={`${line.label}-${gi}-${li}`}
                      line={line}
                      displayMode={displayMode}
                      resetTimerDisplayMode={resetTimerDisplayMode}
                      timeFormatMode={timeFormatMode}
                      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
                      now={now}
                      refreshing={isRefreshingWithData}
                      pluginId={pluginId}
                      onRetry={onRetry}
                    />
                  ))}
                </div>
              ) : (
                <Fragment key={gi}>
                  {group.lines.map((line, li) => (
                    <MetricLineRenderer
                      key={`${line.label}-${gi}-${li}`}
                      line={line}
                      displayMode={displayMode}
                      resetTimerDisplayMode={resetTimerDisplayMode}
                      timeFormatMode={timeFormatMode}
                      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
                      now={now}
                      refreshing={isRefreshingWithData}
                      pluginId={pluginId}
                      onRetry={onRetry}
                    />
                  ))}
                </Fragment>
              )
            )}
          </div>
        )}

        {!loading && !error && filteredLines.length === 0 && !hasStaleData && (
          <p className="text-sm text-muted-foreground py-2">
            No metrics selected in Settings. Open Settings and choose which lines to show for this provider.
          </p>
        )}

        {layout === "detailFill" ? <div className="min-h-0 flex-1" aria-hidden /> : null}

      </div>
      {showSeparator && <Separator />}
    </div>
  )
}

const EXPIRY_DOT_CLASS: Record<ExpiryStatusDot, string> = {
  normal: "bg-blue-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
}

function TextMetricValue({
  line,
  showBreakdown,
  pluginId,
  onRetry,
}: {
  line: Extract<MetricLine, { type: "text" }>
  showBreakdown: boolean
  pluginId?: string
  onRetry?: () => void
}) {
  if (line.label === "Rate Limit Resets") {
    return (
      <RateLimitResetsValue
        countLabel={line.value}
        expiries={line.resetCreditExpiries ?? []}
        pluginId={pluginId}
        onClaimed={onRetry}
        compact
      />
    )
  }

  const valueNode = showBreakdown ? (
    <SpendBreakdownValue line={line} />
  ) : (
    <span
      className="text-xs text-muted-foreground truncate flex-shrink-0 max-w-[45%] text-right"
      style={line.color ? { color: line.color } : undefined}
      title={line.value}
    >
      {line.value}
    </span>
  )

  if (!line.statusDot) return valueNode

  const dot = (
    <span
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", EXPIRY_DOT_CLASS[line.statusDot])}
      aria-hidden
    />
  )

  if (line.expiryTooltip) {
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
          {line.expiryTooltip}
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

function SpendBreakdownValue({ line }: { line: Extract<MetricLine, { type: "text" }> }) {
  const breakdown = line.modelBreakdown ?? []
  const priced = breakdown.filter((row) => row.costUsd != null && row.costUsd > 0)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={cn(
              "text-xs text-muted-foreground truncate flex-shrink-0 max-w-[45%] text-right cursor-default underline decoration-dotted underline-offset-2",
              props.className,
            )}
            style={line.color ? { color: line.color } : undefined}
            title={line.value}
          >
            {line.value}
          </span>
        )}
      />
      <TooltipContent side="left" className="max-w-xs p-2">
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">By model</p>
        <ul className="space-y-1">
          {breakdown.map((row: ModelSpendBreakdown) => (
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

function MetricLineRenderer({
  line,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode,
  onResetTimerDisplayModeToggle,
  now,
  refreshing,
  pluginId,
  onRetry,
}: {
  line: MetricLine
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode: TimeFormatMode
  onResetTimerDisplayModeToggle?: () => void
  now: number
  refreshing?: boolean
  pluginId?: string
  onRetry?: () => void
}) {
  useAppPreferencesStore(
    useShallow((s) => ({
      displayCurrency: s.displayCurrency,
      exchangeRatesRevision: s.exchangeRatesRevision,
    })),
  )

  if (line.type === "text") {
    const spendLabels = new Set(["today", "yesterday", "last 30 days"])
    const showBreakdown =
      line.modelBreakdown &&
      line.modelBreakdown.length > 0 &&
      spendLabels.has(line.label.trim().toLowerCase())
    return (
      <div>
        <div className="flex justify-between items-center h-[18px] gap-2">
          <span className="text-xs text-muted-foreground min-w-0 truncate" title={line.label}>
            {line.label}
          </span>
          {showBreakdown || line.statusDot || line.label === "Rate Limit Resets" ? (
            <TextMetricValue
              line={line}
              showBreakdown={Boolean(showBreakdown)}
              pluginId={pluginId}
              onRetry={onRetry}
            />
          ) : (
            <span
              className="text-xs text-muted-foreground truncate flex-shrink-0 max-w-[45%] text-right"
              style={line.color ? { color: line.color } : undefined}
              title={line.value}
            >
              {line.value}
            </span>
          )}
        </div>
        {line.subtitle && (
          <div className="text-[10px] text-muted-foreground text-right -mt-0.5">{line.subtitle}</div>
        )}
      </div>
    )
  }

  if (line.type === "badge") {
    return (
      <div>
        <div className="flex justify-between items-center h-[22px]">
          <span className="text-sm text-muted-foreground flex-shrink-0">{line.label}</span>
          <Badge
            variant="outline"
            className="truncate min-w-0 max-w-[60%]"
            style={
              line.color
                ? { color: line.color, borderColor: line.color }
                : undefined
            }
            title={line.text}
          >
            {line.text}
          </Badge>
        </div>
        {line.subtitle && (
          <div className="text-xs text-muted-foreground text-right -mt-0.5">{line.subtitle}</div>
        )}
      </div>
    )
  }

  if (line.type === "barChart") {
    return (
      <UsageSparkline label={line.label} points={line.points} note={line.note} color={line.color} />
    )
  }

  if (line.type === "progress") {
    const resetsAtMs = line.resetsAt ? Date.parse(line.resetsAt) : Number.NaN
    const periodDurationMs = line.periodDurationMs
    const hasPaceContext = Number.isFinite(resetsAtMs) && Number.isFinite(periodDurationMs)
    const hasTimeMarkerContext = hasPaceContext && periodDurationMs! > 0
    const shownAmount =
      displayMode === "used"
        ? line.used
        : Math.max(0, line.limit - line.used)
    const percent = Math.round(clamp01(shownAmount / line.limit) * 10000) / 100
    const leftSuffix = displayMode === "left" ? " left" : ""

    const primaryText =
      line.format.kind === "percent"
        ? `${Math.round(shownAmount)}%${leftSuffix}`
        : line.format.kind === "dollars"
          ? `${formatMoney(shownAmount, { sourceCurrency: "USD" })}${leftSuffix}`
          : `${formatCountNumber(shownAmount)} ${line.format.suffix}${leftSuffix}`

    const resetLineContext = {
      used: line.used,
      periodDurationMs,
      label: line.label,
      sessionStartSignal: line.sessionStartSignal,
    }

    const resetLabel = line.resetsAt
      ? resetTimerDisplayMode === "absolute"
        ? formatResetAbsoluteLabel(now, line.resetsAt, timeFormatMode)
        : formatResetRelativeLabel(now, line.resetsAt, resetLineContext)
      : null
    const resetTooltipText = line.resetsAt
      ? formatResetTooltipText({
          nowMs: now,
          resetsAtIso: line.resetsAt,
          visibleMode: resetTimerDisplayMode,
          timeFormatMode,
          lineContext: resetLineContext,
        })
      : null

    const secondaryText =
      resetLabel ??
      (line.format.kind === "percent"
        ? `${line.limit}% cap`
        : line.format.kind === "dollars"
          ? `${formatMoney(line.limit, { sourceCurrency: "USD" })} limit`
          : `${formatCountNumber(line.limit)} ${line.format.suffix}`)

    // Calculate pace status if we have reset time and period duration
    const paceResult = hasPaceContext
      ? calculatePaceStatus(line.used, line.limit, resetsAtMs, periodDurationMs!, now)
      : null
    const paceStatus = paceResult?.status ?? null
    const paceMarkerValue = hasTimeMarkerContext && paceStatus && paceStatus !== "on-track"
      ? (() => {
          const periodStartMs = resetsAtMs - periodDurationMs!
          const elapsedFraction = clamp01((now - periodStartMs) / periodDurationMs!)
          const elapsedPercent = elapsedFraction * 100
          return displayMode === "used" ? elapsedPercent : 100 - elapsedPercent
        })()
      : undefined
    const isLimitReached = line.used >= line.limit
    const paceDetailText =
      hasPaceContext && !isLimitReached
        ? buildPaceDetailText({
            paceResult,
            used: line.used,
            limit: line.limit,
            periodDurationMs: periodDurationMs!,
            resetsAtMs,
            nowMs: now,
            displayMode,
          })
        : null

    const deficit = hasPaceContext && !isLimitReached
      ? calculateDeficit(line.used, line.limit, resetsAtMs, periodDurationMs!, now)
      : null
    const deficitText = deficit !== null
      ? formatDeficitText(deficit, line.format, displayMode)
      : null
    const runsOutText = hasPaceContext && !isLimitReached
      ? formatRunsOutText({
          paceResult,
          used: line.used,
          limit: line.limit,
          periodDurationMs: periodDurationMs!,
          resetsAtMs,
          nowMs: now,
        })
      : null

    return (
      <div>
        <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
          {line.label}
          {paceStatus && (
            <PaceIndicator status={paceStatus} detailText={paceDetailText} isLimitReached={isLimitReached} />
          )}
        </div>
        <Progress
          value={percent}
          indicatorColor={line.color}
          markerValue={paceMarkerValue}
          refreshing={refreshing}
        />
        <div className="flex justify-between items-center mt-1.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            <MotionNumber value={primaryText} className="motion-number" />
          </span>
          {secondaryText && (
            resetTooltipText ? (
              <Tooltip>
                <TooltipTrigger
                  render={(props) =>
                    resetLabel && onResetTimerDisplayModeToggle ? (
                      <button
                        {...props}
                        type="button"
                        onClick={onResetTimerDisplayModeToggle}
                        className="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
                      >
                        {secondaryText}
                      </button>
                    ) : (
                      <span {...props} className="text-xs text-muted-foreground tabular-nums">
                        {secondaryText}
                      </span>
                    )
                  }
                />
                <TooltipContent side="top">{resetTooltipText}</TooltipContent>
              </Tooltip>
            ) : resetLabel && onResetTimerDisplayModeToggle ? (
              <button
                type="button"
                onClick={onResetTimerDisplayModeToggle}
                className="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
              >
                {secondaryText}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {secondaryText}
              </span>
            )
          )}
        </div>
        {(deficitText || runsOutText) && (
          <div className="flex justify-between items-center mt-0.5">
            {deficitText && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {deficitText}
              </span>
            )}
            {runsOutText && (
              <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                {runsOutText}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return null
}
