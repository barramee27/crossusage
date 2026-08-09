import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  dismissProductPoll,
  refreshProductPolls,
  voteOnProductPoll,
} from "@/hooks/app/use-product-polls"
import { useProductPollsStore } from "@/stores/product-polls-store"
import { cn } from "@/lib/utils"

export function PollsPage() {
  const {
    enabled,
    activePoll,
    answered,
    dismissed,
    results,
    voting,
    hydrated,
  } = useProductPollsStore(
    useShallow((s) => ({
      enabled: s.enabled,
      activePoll: s.activePoll,
      answered: s.answered,
      dismissed: s.dismissed,
      results: s.results,
      voting: s.voting,
      hydrated: s.hydrated,
    })),
  )
  const [voteError, setVoteError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const pollsVisitNonce = useProductPollsStore((s) => s.pollsVisitNonce)

  // Every Polls visit (nav click bumps pollsVisitNonce) force-pulls the API.
  useEffect(() => {
    if (!hydrated || !enabled) return
    void refreshProductPolls(true)
  }, [hydrated, enabled, pollsVisitNonce])

  const onCheckAgain = async () => {
    setChecking(true)
    try {
      await refreshProductPolls(true)
    } finally {
      setChecking(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Loading…</div>
    )
  }

  if (!enabled) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Header />
        <p className="text-sm text-muted-foreground">
          Product polls are off. Enable them in Settings to see occasional questions from the CrossUsage team.
        </p>
      </div>
    )
  }

  if (!activePoll) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Header />
        <p className="text-sm text-muted-foreground">
          No active poll right now. Check back later — nothing to do.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={checking}
          onClick={() => void onCheckAgain()}
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>
    )
  }

  const myAnswer = answered[activePoll.id]
  const isDismissed = Boolean(dismissed[activePoll.id])
  const showResults = Boolean(myAnswer) || activePoll.ended
  const total = results?.total ?? 0

  return (
    <div className="flex flex-col gap-3 p-4">
      <Header />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground leading-snug">
          {activePoll.title}
        </h2>
        {activePoll.body ? (
          <p className="text-sm text-muted-foreground leading-relaxed">{activePoll.body}</p>
        ) : null}
        {activePoll.ended ? (
          <p className="text-xs text-muted-foreground">This poll has ended.</p>
        ) : null}
      </div>

      {!myAnswer && !isDismissed && !activePoll.ended ? (
        <div className="flex flex-col gap-2">
          {activePoll.options.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              variant="outline"
              className="justify-start h-auto py-2 px-3 whitespace-normal text-left"
              disabled={voting}
              onClick={() => {
                setVoteError(null)
                void voteOnProductPoll(opt.id).then((res) => {
                  if (res.ok) return
                  if (res.error === "rate_limited") {
                    setVoteError(
                      "This network already used its vote (or is rate-limited). Try again later.",
                    )
                    return
                  }
                  setVoteError("Couldn’t send vote. Try again.")
                })
              }}
            >
              {opt.label}
            </Button>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={voting}
              onClick={() => void dismissProductPoll("not_now")}
            >
              Not now
            </Button>
            {activePoll.allowDismiss ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={voting}
                onClick={() => void dismissProductPoll("dont_ask")}
              >
                Don’t ask again
              </Button>
            ) : null}
          </div>
          {voteError ? (
            <p className="text-xs text-destructive" role="alert">
              {voteError}
            </p>
          ) : null}
        </div>
      ) : null}

      {isDismissed && !myAnswer ? (
        <p className="text-sm text-muted-foreground">
          You skipped this poll. It won’t show a badge until the next one.
        </p>
      ) : null}

      {showResults && results && results.pollId === activePoll.id ? (
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Results{total > 0 ? ` · ${total} vote${total === 1 ? "" : "s"}` : ""}
          </p>
          <ul className="space-y-2">
            {activePoll.options.map((opt) => {
              const count = results.counts[opt.id] ?? 0
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              const isWinner = results.winnerId === opt.id
              const isMine = myAnswer === opt.id
              return (
                <li key={opt.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        isWinner && "font-semibold text-foreground",
                        isMine && !isWinner && "text-foreground",
                      )}
                    >
                      {opt.label}
                      {isMine ? " · you" : ""}
                      {isWinner ? " · lead" : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        isWinner ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {myAnswer && !(results && results.pollId === activePoll.id) ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Thanks — vote recorded. Loading results…
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={checking}
            onClick={() => void onCheckAgain()}
          >
            {checking ? "Loading…" : "Load results"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <BarChart3 className="size-5 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">Polls</h1>
    </div>
  )
}
