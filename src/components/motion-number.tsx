import { useEffect, useRef, useState } from "react"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

const METRIC_RE = /^(\D*?)(-?\d+(?:[.,]\d+)?)(\D*)$/

export function splitMetricText(text: string) {
  const match = text.trim().match(METRIC_RE)
  if (!match) return null
  const raw = match[2].replace(",", ".")
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0
  return { prefix: match[1], n, decimals, suffix: match[3] }
}

function formatPart(n: number, decimals: number) {
  if (decimals > 0) return n.toFixed(Math.min(3, decimals))
  return String(Math.round(n))
}

export function useAnimatedMetricText(text: string, enabled: boolean) {
  const [shown, setShown] = useState(text)
  const fromRef = useRef(splitMetricText(text)?.n ?? 0)

  useEffect(() => {
    const parsed = splitMetricText(text)
    if (!enabled || !parsed) {
      setShown(text)
      if (parsed) fromRef.current = parsed.n
      return
    }
    const from = fromRef.current
    const to = parsed.n
    fromRef.current = to
    if (from === to) {
      setShown(text)
      return
    }
    const started = performance.now()
    const duration = 700
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - t) ** 3
      const n = from + (to - from) * eased
      setShown(`${parsed.prefix}${formatPart(n, parsed.decimals)}${parsed.suffix}`)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [enabled, text])

  return shown
}

export function MotionNumber({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const reduce = useAppPreferencesStore((s) => s.reduceAnimations)
  const shown = useAnimatedMetricText(value, !reduce)
  return (
    <span className={className} data-motion-number={splitMetricText(value) ? "1" : undefined}>
      {shown}
    </span>
  )
}
