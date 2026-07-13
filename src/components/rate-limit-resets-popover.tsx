import { useMemo, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import {
  claimBannerText,
  expirySeverity,
  formatExpiryCountdown,
  formatExpiryTime,
  parseAvailableCount,
  resetsDetailContent,
  type ResetClaimOutcome,
} from "@/lib/codex-reset-claim"
import { cn } from "@/lib/utils"

type RateLimitResetsPopoverProps = {
  countLabel: string
  expiries: string[]
  pluginId?: string
  onClaimed?: () => void
  compact?: boolean
  className?: string
  /** When true, show Use / claim controls. */
  claimable?: boolean
}

const SEVERITY_DOT: Record<string, string> = {
  normal: "bg-blue-500 text-white",
  warning: "bg-yellow-400 text-black",
  critical: "bg-red-500 text-white",
}

export function RateLimitResetsValue({
  countLabel,
  expiries,
  pluginId,
  onClaimed,
  compact,
  className,
  claimable = true,
}: RateLimitResetsPopoverProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<Set<string>>(() => new Set())
  const [banner, setBanner] = useState<{ text: string; tone: string } | null>(null)
  const [nothingToReset, setNothingToReset] = useState(false)
  const redeemIds = useRef<Map<string, string>>(new Map())
  const closeTimer = useRef<number | null>(null)

  const count = parseAvailableCount(countLabel)
  const visibleExpiries = useMemo(
    () => expiries.filter((iso) => !claimed.has(iso)),
    [expiries, claimed],
  )
  const content = resetsDetailContent(count - claimed.size, visibleExpiries)
  const nowMs = Date.now()

  const clearClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    if (pinned) return
    clearClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), 180)
  }

  const beginConfirm = (iso: string) => {
    if (!redeemIds.current.has(iso)) {
      redeemIds.current.set(iso, crypto.randomUUID())
    }
    setBanner(null)
    setConfirming(iso)
    setPinned(true)
    setOpen(true)
  }

  const cancelConfirm = () => {
    setConfirming(null)
    setPinned(false)
  }

  const runClaim = async (iso: string) => {
    const redeemRequestId = redeemIds.current.get(iso) ?? crypto.randomUUID()
    redeemIds.current.set(iso, redeemRequestId)
    setConfirming(null)
    setClaiming(iso)
    setPinned(true)
    let outcome: ResetClaimOutcome = "failed"
    try {
      if (isTauri()) {
        outcome = (await invoke<ResetClaimOutcome>("codex_claim_reset_credit", {
          expiresAtIso: iso,
          redeemRequestId,
          pluginId: pluginId ?? "codex",
        })) as ResetClaimOutcome
      } else {
        outcome = "failed"
      }
    } catch (e) {
      console.error("codex_claim_reset_credit:", e)
      outcome = "failed"
    }
    setClaiming(null)
    setPinned(false)
    setBanner({
      text: claimBannerText(outcome),
      tone:
        outcome === "success"
          ? "text-green-600 bg-green-500/10"
          : outcome === "nothing_to_reset"
            ? "text-blue-600 bg-blue-500/10"
            : outcome === "no_credit"
              ? "text-amber-600 bg-amber-500/10"
              : "text-red-600 bg-red-500/10",
    })
    if (outcome === "success" || outcome === "no_credit") {
      setClaimed((prev) => new Set(prev).add(iso))
    }
    if (outcome === "success" || outcome === "nothing_to_reset") {
      setNothingToReset(true)
    }
    if (outcome === "success" || outcome === "nothing_to_reset" || outcome === "no_credit") {
      onClaimed?.()
    }
  }

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => {
        clearClose()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
    >
      <span
        className={cn(
          "font-medium tabular-nums shrink-0 underline decoration-dotted underline-offset-2 cursor-default",
          compact ? "text-xs" : "text-sm",
          open && "text-foreground",
        )}
      >
        {countLabel}
      </span>

      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-[250px] rounded-lg border bg-popover p-3.5 shadow-md"
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
        >
          {banner ? (
            <div className={cn("mb-2 rounded-md px-2.5 py-2 text-xs font-medium", banner.tone)}>
              {banner.text}
            </div>
          ) : null}

          {claiming && !visibleExpiries.includes(claiming) ? (
            <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
              <span>Resetting your usage…</span>
              <span className="ml-auto animate-pulse">…</span>
            </div>
          ) : null}

          {content.kind === "empty" ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              You have no rate limit resets
            </p>
          ) : null}

          {content.kind === "unknownExpiries" ? (
            <div className="py-3 text-center">
              <p className="text-sm font-medium">{content.count} available</p>
              <p className="text-xs text-muted-foreground">Expiry times unavailable</p>
            </div>
          ) : null}

          {content.kind === "timeline" ? (
            <ul className="space-y-0">
              {content.expiries.map((iso, index) => {
                const remaining = Date.parse(iso) - nowMs
                const severity = expirySeverity(remaining)
                const countdown = formatExpiryCountdown(remaining)
                const isConfirm = confirming === iso
                const isClaiming = claiming === iso
                const claimBusy = confirming != null || claiming != null

                return (
                  <li key={iso} className="flex gap-2.5">
                    <div className="flex w-[18px] flex-col items-center">
                      <span
                        className={cn(
                          "flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-medium",
                          SEVERITY_DOT[severity],
                        )}
                      >
                        {index + 1}
                      </span>
                      {index < content.expiries.length - 1 ? (
                        <span className="mt-0.5 w-px flex-1 bg-border" />
                      ) : null}
                    </div>
                    <div className={cn("min-w-0 flex-1 pb-2", claimBusy && !isConfirm && !isClaiming && "opacity-45")}>
                      {isClaiming ? (
                        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                          Resetting your usage…
                        </div>
                      ) : isConfirm ? (
                        <div className="rounded-md bg-muted/50 p-2.5 space-y-2">
                          <p className="text-sm font-medium">Use this reset?</p>
                          <p className="text-[11px] text-muted-foreground">
                            Immediately reset your usage limits. This can&apos;t be undone.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="flex-1"
                              onClick={() => void runClaim(iso)}
                            >
                              Reset
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={cancelConfirm}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="group flex items-center gap-2 py-0.5">
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {formatExpiryTime(iso, nowMs)}
                          </span>
                          {claimable && isTauri() ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] opacity-0 group-hover:opacity-100"
                              disabled={nothingToReset || claimBusy}
                              title={nothingToReset ? "Nothing to reset right now" : undefined}
                              onClick={() => beginConfirm(iso)}
                            >
                              Use
                            </Button>
                          ) : null}
                          {countdown && !(claimable && isTauri()) ? (
                            <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                              {countdown}
                            </span>
                          ) : null}
                          {countdown && claimable && isTauri() ? (
                            <span className="shrink-0 tabular-nums text-sm text-muted-foreground group-hover:hidden">
                              {countdown}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
