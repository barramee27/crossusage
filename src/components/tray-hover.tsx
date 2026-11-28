import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { TrayHoverGroup } from "@/lib/tray-tooltip"

type TrayHoverModel = {
  dark: boolean
  glass: boolean
  groups: TrayHoverGroup[]
}

const EMPTY_MODEL: TrayHoverModel = { dark: false, glass: false, groups: [] }

export function TrayHoverApp() {
  const [model, setModel] = useState<TrayHoverModel>(EMPTY_MODEL)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = document.documentElement
    root.classList.add("tray-hover")
    return () => root.classList.remove("tray-hover")
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", model.dark)
    root.classList.toggle("glass", model.glass)
  }, [model.dark, model.glass])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<TrayHoverModel>("tray-hover-model", (event) => {
      setModel(event.payload)
    }).then((stop) => {
      unlisten = stop
    })
    void invoke<TrayHoverModel>("tray_hover_model")
      .then((snapshot) => setModel(snapshot))
      .catch(() => {})
    return () => {
      unlisten?.()
    }
  }, [])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const width = Math.ceil(card.offsetWidth)
    const height = Math.ceil(card.offsetHeight)
    if (width < 1 || height < 1) return
    void invoke("set_tray_hover_size", { width, height }).catch(() => {})
  }, [model])

  return (
    <div
      ref={cardRef}
      role="tooltip"
      aria-label="CrossUsage"
      className="inline-block w-[280px] max-h-[420px] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">CrossUsage</div>
      {model.groups.length === 0 ? (
        <div className="text-sm text-muted-foreground">No usage yet</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {model.groups.map((group, index) => (
            <section key={`${group.name}-${index}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: group.color ?? "var(--muted-foreground)" }}
                />
                {group.name}
              </div>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5">
                {group.items.map((item) => (
                  <div key={item.label} className="contents">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <span className="text-right text-xs tabular-nums">{item.caption}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
