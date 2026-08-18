import { useEffect, useState } from "react"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

const ORBS = [
  { x: "8%", y: "18%", s: "56px", t: "7.2s", d: "0s" },
  { x: "78%", y: "12%", s: "38px", t: "9.1s", d: "0.4s" },
  { x: "52%", y: "72%", s: "72px", t: "11s", d: "0.8s" },
  { x: "18%", y: "64%", s: "28px", t: "6.4s", d: "1.1s" },
  { x: "88%", y: "48%", s: "44px", t: "8.3s", d: "0.2s" },
  { x: "40%", y: "28%", s: "22px", t: "5.5s", d: "1.6s" },
  { x: "64%", y: "82%", s: "34px", t: "10s", d: "0.6s" },
  { x: "6%", y: "88%", s: "48px", t: "7.8s", d: "1.3s" },
  { x: "30%", y: "8%", s: "26px", t: "6.1s", d: "0.9s" },
  { x: "92%", y: "78%", s: "40px", t: "8.8s", d: "1.8s" },
  { x: "14%", y: "42%", s: "18px", t: "4.9s", d: "0.3s" },
  { x: "70%", y: "36%", s: "52px", t: "9.6s", d: "1.4s" },
] as const

export function MotionField() {
  const reduce = useAppPreferencesStore((s) => s.reduceAnimations)
  const [shock, setShock] = useState(false)

  useEffect(() => {
    const onShock = () => {
      setShock(true)
      window.setTimeout(() => setShock(false), 750)
    }
    window.addEventListener("crossusage:motion-shock", onShock)
    return () => window.removeEventListener("crossusage:motion-shock", onShock)
  }, [])

  if (reduce) return null

  return (
    <div className="motion-field" aria-hidden="true">
      <div className="motion-aurora" />
      <div className="motion-aurora motion-aurora-alt" />
      <div className="motion-grid" />
      <div className="motion-dust" />
      <div className="motion-edge" />
      <div className="motion-scan" />
      <div className="motion-scan motion-scan-slow" />
      <span className="motion-cursor" />
      <span className="motion-cursor-lag" />
      <span className="motion-cursor motion-cursor-spark" />
      {ORBS.map((orb, i) => (
        <span
          key={i}
          className="motion-orb"
          style={{
            ["--orb-x" as string]: orb.x,
            ["--orb-y" as string]: orb.y,
            ["--orb-s" as string]: orb.s,
            ["--orb-t" as string]: orb.t,
            ["--orb-d" as string]: orb.d,
          }}
        />
      ))}
      {shock ? (
        <>
          <span className="motion-shock-ring" />
          <span className="motion-shock-ring motion-shock-late" />
          <span className="motion-shock-ring motion-shock-later" />
        </>
      ) : null}
    </div>
  )
}

export function fireMotionShock() {
  window.dispatchEvent(new Event("crossusage:motion-shock"))
}
