import { useEffect, useRef } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { relaunch } from "@tauri-apps/plugin-process"
import type { UpdateStatus } from "@/hooks/use-app-update"

/**
 * Tray "Restart" asks the webview to either apply a downloaded updater (install + relaunch)
 * or plain relaunch — same as the footer "Restart to update" button when an update is ready.
 */
export function useTrayRestartBridge(
  updateStatus: UpdateStatus,
  triggerInstall: () => void,
) {
  const updateStatusRef = useRef(updateStatus)
  updateStatusRef.current = updateStatus
  const triggerInstallRef = useRef(triggerInstall)
  triggerInstallRef.current = triggerInstall

  useEffect(() => {
    if (!isTauri()) return
    const text =
      updateStatus.status === "ready" ? "Restart to update" : "Restart"
    void invoke("set_tray_restart_label", { text }).catch(() => {})
  }, [updateStatus.status])

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    void (async () => {
      unlisten = await listen("tray:restart-or-update", () => {
        const s = updateStatusRef.current
        if (s.status === "ready") {
          void triggerInstallRef.current()
        } else {
          void relaunch()
        }
      })
      if (cancelled) {
        unlisten()
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
