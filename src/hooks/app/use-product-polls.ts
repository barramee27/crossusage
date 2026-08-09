import { useCallback, useEffect, useRef } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { useShallow } from "zustand/react/shallow"
import {
  fetchActiveProductPoll,
  fetchProductPollResults,
  newInstallId,
  shouldShowUnansweredPoll,
  shouldThrottleFetch,
  submitProductPollVote,
  submitProductPollDismiss,
} from "@/lib/product-polls"
import {
  loadProductPollsAnswered,
  loadProductPollsDismissed,
  loadProductPollsEnabled,
  loadProductPollsInstallId,
  loadProductPollsLastFetchAt,
  saveProductPollsAnswered,
  saveProductPollsDismissed,
  saveProductPollsEnabled,
  saveProductPollsInstallId,
  saveProductPollsLastFetchAt,
} from "@/lib/settings"
import { useProductPollsStore } from "@/stores/product-polls-store"

/**
 * Hydrate local poll prefs + pull active poll (throttled ~1h).
 * Fail silent. Call once from App.
 */
export function useProductPolls(opts?: { onboardingComplete: boolean | null }) {
  const onboardingComplete = opts?.onboardingComplete ?? true
  const hydrated = useProductPollsStore((s) => s.hydrated)
  const enabled = useProductPollsStore((s) => s.enabled)
  const setHydrated = useProductPollsStore((s) => s.setHydrated)
  const setEnabled = useProductPollsStore((s) => s.setEnabled)
  const setInstallId = useProductPollsStore((s) => s.setInstallId)
  const setAnswered = useProductPollsStore((s) => s.setAnswered)
  const setDismissed = useProductPollsStore((s) => s.setDismissed)
  const setLastFetchAt = useProductPollsStore((s) => s.setLastFetchAt)
  const setActivePoll = useProductPollsStore((s) => s.setActivePoll)
  const setResults = useProductPollsStore((s) => s.setResults)

  const pullingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [en, storedId, ans, dis, last] = await Promise.all([
          loadProductPollsEnabled(),
          loadProductPollsInstallId(),
          loadProductPollsAnswered(),
          loadProductPollsDismissed(),
          loadProductPollsLastFetchAt(),
        ])
        if (cancelled) return
        let id = storedId
        if (!id) {
          id = newInstallId()
          await saveProductPollsInstallId(id)
        }
        setEnabled(en)
        setInstallId(id)
        setAnswered(ans)
        setDismissed(dis)
        setLastFetchAt(last)
      } catch (e) {
        console.error("product polls hydrate:", e)
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    setAnswered,
    setDismissed,
    setEnabled,
    setHydrated,
    setInstallId,
    setLastFetchAt,
  ])

  const refresh = useCallback(async (force = false) => {
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      await refreshProductPolls(force)
    } finally {
      pullingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (onboardingComplete === false) return
    if (!enabled) {
      setActivePoll(null)
      setResults(null)
      return
    }
    void refresh(false)
  }, [hydrated, onboardingComplete, enabled, refresh, setActivePoll, setResults])

  return { refresh }
}

/** Force a pull (e.g. Polls page open). Safe outside the hook. */
export async function refreshProductPolls(force = true): Promise<void> {
  const state = useProductPollsStore.getState()
  if (!state.hydrated || !state.enabled) {
    useProductPollsStore.getState().setActivePoll(null)
    return
  }
  // Throttle only when we already have a poll cached. Empty → keep trying so a
  // newly published server poll shows up without waiting a full hour.
  if (
    !force &&
    state.activePoll != null &&
    shouldThrottleFetch(state.lastFetchAt)
  ) {
    return
  }

  let appVersion: string | null = null
  try {
    if (isTauri()) appVersion = await getVersion()
  } catch {
    // ignore
  }

  const fetched = await fetchActiveProductPoll({ appVersion })
  if (!fetched.ok) {
    useProductPollsStore.getState().setFetchError(true)
    return
  }

  const poll = fetched.poll
  const now = Date.now()
  useProductPollsStore.getState().setLastFetchAt(now)
  try {
    await saveProductPollsLastFetchAt(now)
  } catch (e) {
    console.error("saveProductPollsLastFetchAt:", e)
  }

  if (poll == null) {
    console.info("[product-polls] active fetch returned empty")
  }
  useProductPollsStore.getState().setFetchError(false)
  useProductPollsStore.getState().setActivePoll(poll)

  const installId = useProductPollsStore.getState().installId
  const answered = useProductPollsStore.getState().answered
  if (poll && installId && (answered[poll.id] || poll.ended)) {
    const { results, status } = await fetchProductPollResults({
      pollId: poll.id,
      installId,
    })
    if (results) {
      useProductPollsStore.getState().setResults(results)
    } else if (status === 403) {
      // Local "answered" but server has no vote (e.g. DB purge) — clear stale so UI can vote again.
      const next = { ...answered }
      delete next[poll.id]
      useProductPollsStore.getState().setAnswered(next)
      useProductPollsStore.getState().setResults(null)
      try {
        await saveProductPollsAnswered(next)
      } catch (e) {
        console.error("saveProductPollsAnswered (stale clear):", e)
      }
    } else {
      // Transient failure: keep prior results for this poll if any.
      const prev = useProductPollsStore.getState().results
      if (!prev || prev.pollId !== poll.id) {
        useProductPollsStore.getState().setResults(null)
      }
    }
  } else {
    useProductPollsStore.getState().setResults(null)
  }
}

export function useProductPollsBadge(appVersion: string | null): boolean {
  const { enabled, activePoll, answered, dismissed, hydrated } = useProductPollsStore(
    useShallow((s) => ({
      enabled: s.enabled,
      activePoll: s.activePoll,
      answered: s.answered,
      dismissed: s.dismissed,
      hydrated: s.hydrated,
    })),
  )
  if (!hydrated || !enabled) return false
  return shouldShowUnansweredPoll({
    poll: activePoll,
    appVersion,
    answered,
    dismissed,
  })
}

export type VoteProductPollResult =
  | { ok: true }
  | { ok: false; error: "rate_limited" | "failed" }

export async function voteOnProductPoll(optionId: string): Promise<VoteProductPollResult> {
  const state = useProductPollsStore.getState()
  const poll = state.activePoll
  const installId = state.installId
  if (!poll || !installId || state.voting) return { ok: false, error: "failed" }

  useProductPollsStore.getState().setVoting(true)
  try {
    const { ok, results, error } = await submitProductPollVote({
      pollId: poll.id,
      installId,
      optionId,
    })
    if (!ok) return { ok: false, error: error ?? "failed" }
    const next = { ...state.answered, [poll.id]: optionId }
    useProductPollsStore.getState().setAnswered(next)
    if (results) {
      useProductPollsStore.getState().setResults(results)
    } else {
      // Vote accepted but results missing — pull explicitly.
      const pulled = await fetchProductPollResults({ pollId: poll.id, installId })
      useProductPollsStore.getState().setResults(pulled.results)
    }
    await saveProductPollsAnswered(next)
    return { ok: true }
  } catch (e) {
    console.error("voteOnProductPoll:", e)
    return { ok: false, error: "failed" }
  } finally {
    useProductPollsStore.getState().setVoting(false)
  }
}

export async function dismissProductPoll(reason: "not_now" | "dont_ask"): Promise<void> {
  const state = useProductPollsStore.getState()
  const poll = state.activePoll
  const installId = state.installId
  if (!poll) return
  const next = { ...state.dismissed, [poll.id]: Date.now() }
  useProductPollsStore.getState().setDismissed(next)
  try {
    await saveProductPollsDismissed(next)
  } catch (e) {
    console.error("dismissProductPoll:", e)
  }
  // Best-effort server telemetry; local dismiss already applied.
  if (installId) {
    void submitProductPollDismiss({
      pollId: poll.id,
      installId,
      reason,
    }).catch(() => {
      /* ignore */
    })
  }
}

export async function setProductPollsEnabled(checked: boolean): Promise<void> {
  const prev = useProductPollsStore.getState().enabled
  useProductPollsStore.getState().setEnabled(checked)
  try {
    await saveProductPollsEnabled(checked)
    if (!checked) {
      useProductPollsStore.getState().setActivePoll(null)
      useProductPollsStore.getState().setResults(null)
    }
  } catch (e) {
    console.error(e)
    useProductPollsStore.getState().setEnabled(prev)
    throw e
  }
}
