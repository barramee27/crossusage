import { create } from "zustand"
import type {
  ProductPoll,
  ProductPollAnswerMap,
  ProductPollDismissMap,
  ProductPollResults,
} from "@/lib/product-polls"

type ProductPollsStore = {
  hydrated: boolean
  enabled: boolean
  installId: string | null
  answered: ProductPollAnswerMap
  dismissed: ProductPollDismissMap
  lastFetchAt: number | null
  activePoll: ProductPoll | null
  results: ProductPollResults | null
  voting: boolean
  fetchError: boolean
  /** Bumped each time the user navigates to the Polls page. */
  pollsVisitNonce: number

  setHydrated: (value: boolean) => void
  setEnabled: (value: boolean) => void
  setInstallId: (value: string) => void
  setAnswered: (value: ProductPollAnswerMap) => void
  setDismissed: (value: ProductPollDismissMap) => void
  setLastFetchAt: (value: number | null) => void
  setActivePoll: (value: ProductPoll | null) => void
  setResults: (value: ProductPollResults | null) => void
  setVoting: (value: boolean) => void
  setFetchError: (value: boolean) => void
  bumpPollsVisit: () => void
  resetState: () => void
}

const initialState = {
  hydrated: false,
  enabled: true,
  installId: null as string | null,
  answered: {} as ProductPollAnswerMap,
  dismissed: {} as ProductPollDismissMap,
  lastFetchAt: null as number | null,
  activePoll: null as ProductPoll | null,
  results: null as ProductPollResults | null,
  voting: false,
  fetchError: false,
  pollsVisitNonce: 0,
}

export const useProductPollsStore = create<ProductPollsStore>((set) => ({
  ...initialState,
  setHydrated: (value) => set({ hydrated: value }),
  setEnabled: (value) => set({ enabled: value }),
  setInstallId: (value) => set({ installId: value }),
  setAnswered: (value) => set({ answered: value }),
  setDismissed: (value) => set({ dismissed: value }),
  setLastFetchAt: (value) => set({ lastFetchAt: value }),
  setActivePoll: (value) => set({ activePoll: value }),
  setResults: (value) => set({ results: value }),
  setVoting: (value) => set({ voting: value }),
  setFetchError: (value) => set({ fetchError: value }),
  bumpPollsVisit: () => set((s) => ({ pollsVisitNonce: s.pollsVisitNonce + 1 })),
  resetState: () => set(initialState),
}))
