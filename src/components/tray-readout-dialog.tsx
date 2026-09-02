import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  defaultTrayReadoutLine,
  enabledTrayReadoutPlugins,
  type TrayReadoutPlugin,
} from "@/lib/tray-readout-pick"
import type { MenubarIconStyle } from "@/lib/settings"

export type TrayReadoutDialogState = {
  nextStyle: MenubarIconStyle
  pluginId: string
  lineLabel: string
}

type TrayReadoutDialogProps = {
  dialog: TrayReadoutDialogState | null
  plugins: TrayReadoutPlugin[]
  onClose: () => void
  onApply: (pluginId: string, lineLabel: string, nextStyle: MenubarIconStyle) => void
}

export function TrayReadoutDialog({ dialog, plugins, onClose, onApply }: TrayReadoutDialogProps) {
  const enabled = enabledTrayReadoutPlugins(plugins)
  const [pluginId, setPluginId] = useState(dialog?.pluginId ?? "")
  const [lineLabel, setLineLabel] = useState(dialog?.lineLabel ?? "")

  useEffect(() => {
    if (!dialog) return
    setPluginId(dialog.pluginId)
    setLineLabel(dialog.lineLabel)
  }, [dialog])

  if (!dialog) return null

  const selected = enabled.find((p) => p.id === pluginId) ?? enabled[0]
  const lines = selected?.trayReadoutLabels ?? []

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tray-readout-dialog-title"
        className="max-w-md w-full max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-4 pt-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="tray-readout-dialog-title" className="text-base font-semibold text-foreground leading-normal">
          Tray readout
        </h3>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          Pick which provider the tray icon follows, then which meter from that provider’s plugin.json.
        </p>
        {enabled.length > 1 ? (
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Provider</p>
            <div
              className="flex flex-col gap-1 max-h-36 overflow-y-auto"
              role="radiogroup"
              aria-label="Tray provider"
            >
              {enabled.map((plugin) => (
                <button
                  key={plugin.id}
                  type="button"
                  role="radio"
                  aria-checked={plugin.id === selected?.id}
                  className={cn(
                    "text-left text-sm rounded-md border px-2 py-1.5",
                    plugin.id === selected?.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50",
                  )}
                  onClick={() => {
                    setPluginId(plugin.id)
                    setLineLabel(defaultTrayReadoutLine(plugin))
                  }}
                >
                  {plugin.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Tray metric">
          {lines.map((line) => (
            <label key={line} className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="radio"
                name="tray-readout-metric"
                className="accent-primary"
                checked={lineLabel === line}
                onChange={() => setLineLabel(line)}
              />
              <span>{line}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selected || !lineLabel}
            onClick={() => {
              if (!selected || !lineLabel) return
              onApply(selected.id, lineLabel, dialog.nextStyle)
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
