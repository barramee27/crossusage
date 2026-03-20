import { useEffect } from "react"
import type { UIScale } from "@/lib/settings"

export function useSettingsCompact(uiScale: UIScale) {
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("small", "compact")
    if (uiScale === "small") {
      root.classList.add("small")
    } else if (uiScale === "compact") {
      root.classList.add("compact")
    }
  }, [uiScale])
}
