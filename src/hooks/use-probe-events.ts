import { useCallback, useEffect, useRef } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import type { PluginOutput, ProbeTarget } from "@/lib/plugin-types"

type ProbeResult = {
  batchId: string
  output: PluginOutput
}

type ProbeBatchComplete = {
  batchId: string
}

type ProbeBatchStarted = {
  batchId: string
  pluginIds: string[]
}

type UseProbeEventsOptions = {
  onResult: (output: PluginOutput) => void
  onBatchComplete: (pluginIds: string[]) => void
  getProbeTargets?: (pluginIds?: string[]) => ProbeTarget[] | undefined
}

export function useProbeEvents({ onResult, onBatchComplete, getProbeTargets }: UseProbeEventsOptions) {
  const activeBatchIds = useRef<Set<string>>(new Set())
  const batchPluginIdsRef = useRef<Map<string, string[]>>(new Map())
  const unlisteners = useRef<UnlistenFn[]>([])
  const listenersReadyRef = useRef<Promise<void> | null>(null)
  const listenersReadyResolveRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false

    // Create the promise that will resolve when listeners are ready
    listenersReadyRef.current = new Promise<void>((resolve) => {
      listenersReadyResolveRef.current = resolve
    })

    const setup = async () => {
      const resultUnlisten = await listen<ProbeResult>("probe:result", (event) => {
        if (activeBatchIds.current.has(event.payload.batchId)) {
          onResult(event.payload.output)
        }
      })

      if (cancelled) {
        resultUnlisten()
        return
      }

      const completeUnlisten = await listen<ProbeBatchComplete>(
        "probe:batch-complete",
        (event) => {
          if (activeBatchIds.current.delete(event.payload.batchId)) {
            const ids = batchPluginIdsRef.current.get(event.payload.batchId) ?? []
            batchPluginIdsRef.current.delete(event.payload.batchId)
            onBatchComplete(ids)
          }
        }
      )

      if (cancelled) {
        resultUnlisten()
        completeUnlisten()
        return
      }

      unlisteners.current.push(resultUnlisten, completeUnlisten)

      // Signal that listeners are ready
      listenersReadyResolveRef.current?.()
    }

    void setup()

    return () => {
      cancelled = true
      listenersReadyResolveRef.current?.()
      listenersReadyResolveRef.current = null
      listenersReadyRef.current = null
      unlisteners.current.forEach((unlisten) => unlisten())
      unlisteners.current = []
    }
  }, [onBatchComplete, onResult])

  const startBatch = useCallback(async (pluginIds?: string[]) => {
    // Wait for listeners to be ready before starting the batch
    if (listenersReadyRef.current) {
      await listenersReadyRef.current
    }

    const batchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`

    activeBatchIds.current.add(batchId)
    const probeTargets = getProbeTargets?.(pluginIds)
    const args = probeTargets
      ? { batchId, pluginIds, probeTargets }
      : pluginIds
        ? { batchId, pluginIds }
        : { batchId }
    try {
      const result = await invoke<ProbeBatchStarted>("start_probe_batch", args)
      batchPluginIdsRef.current.set(batchId, result.pluginIds)
      return result.pluginIds
    } catch (error) {
      activeBatchIds.current.delete(batchId)
      batchPluginIdsRef.current.delete(batchId)
      throw error
    }
  }, [getProbeTargets])

  return { startBatch }
}
