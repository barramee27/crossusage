import { useCallback, useEffect, useState } from "react"

/** Cursor spotlight via --mx/--my. No panel tilt/scale — that warped the window. */
export function useMotionPointer(enabled: boolean) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    setNode(el)
  }, [])

  useEffect(() => {
    const el = node
    if (!el) return

    const reset = () => {
      el.style.setProperty("--mx", "0.5")
      el.style.setProperty("--my", "0.5")
      el.style.removeProperty("--tilt-x")
      el.style.removeProperty("--tilt-y")
      el.style.removeProperty("--panel-scale")
    }

    if (!enabled) {
      reset()
      return
    }

    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return
      const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
      const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
      el.style.setProperty("--mx", x.toFixed(3))
      el.style.setProperty("--my", y.toFixed(3))
    }

    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerleave", reset)
    reset()
    return () => {
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerleave", reset)
      reset()
    }
  }, [enabled, node])

  return ref
}
