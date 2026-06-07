import { useEffect, useState } from "react"
import { loadPersistUsageHistory } from "@/lib/settings"

export function usePersistUsageHistory() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    void loadPersistUsageHistory()
      .then((v) => {
        if (mounted) setEnabled(v)
      })
      .catch((e) => console.error("loadPersistUsageHistory:", e))
    return () => {
      mounted = false
    }
  }, [])

  return enabled
}
