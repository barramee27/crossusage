import { useEffect, useState } from "react"

function getSystemDarkMode(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** OS color scheme, independent from CrossUsage's selected App Theme. */
export function useSystemDarkMode(): boolean {
  const [isDark, setIsDark] = useState(getSystemDarkMode)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const update = () => setIsDark(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  return isDark
}
