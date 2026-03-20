import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"

export function usePlatform(): string | null {
  const [platform, setPlatform] = useState<string | null>(null)

  useEffect(() => {
    invoke<string>("get_platform")
      .then(setPlatform)
      .catch(() => setPlatform(null))
  }, [])

  return platform
}
