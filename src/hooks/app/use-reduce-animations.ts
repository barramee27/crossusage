import { useEffect } from "react"
import {
  DEFAULT_REDUCE_ANIMATIONS,
  loadReduceAnimations,
} from "@/lib/settings"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

export function useReduceAnimations() {
  const reduceAnimations = useAppPreferencesStore((s) => s.reduceAnimations)
  const setReduceAnimations = useAppPreferencesStore((s) => s.setReduceAnimations)

  useEffect(() => {
    let cancelled = false
    void loadReduceAnimations()
      .then((value) => {
        if (!cancelled) setReduceAnimations(value)
      })
      .catch((error) => {
        console.error("Failed to load reduce animations:", error)
        if (!cancelled) setReduceAnimations(DEFAULT_REDUCE_ANIMATIONS)
      })
    return () => {
      cancelled = true
    }
  }, [setReduceAnimations])

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-animations", reduceAnimations)
  }, [reduceAnimations])
}
