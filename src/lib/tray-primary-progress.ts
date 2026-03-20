import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"
import { DEFAULT_DISPLAY_MODE, type DisplayMode } from "@/lib/settings"
import { clamp01 } from "@/lib/utils"

type PluginState = {
  data: PluginOutput | null
  loading: boolean
  error: string | null
}

export type TrayPrimaryBar = {
  id: string
  items: { label: string; fraction?: number }[]
}

type ProgressLine = Extract<
  PluginOutput["lines"][number],
  { type: "progress"; label: string; used: number; limit: number }
>

function isProgressLine(line: PluginOutput["lines"][number]): line is ProgressLine {
  return line.type === "progress"
}

export function getTrayPrimaryBars(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  maxBars?: number
  displayMode?: DisplayMode
  pluginId?: string
}): TrayPrimaryBar[] {
  const {
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars = 4,
    displayMode = DEFAULT_DISPLAY_MODE,
    pluginId,
  } = args
  if (!pluginSettings) return []

  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const disabled = new Set(pluginSettings.disabled)
  const orderedIds = pluginId
    ? [pluginId]
    : pluginSettings.order

  const out: TrayPrimaryBar[] = []
  for (const id of orderedIds) {
    if (disabled.has(id)) continue
    const meta = metaById.get(id)
    if (!meta) continue

    // Skip if no primary candidates defined
    if (!meta.primaryCandidates || meta.primaryCandidates.length === 0) continue

    const state = pluginStates[id]
    const data = state?.data ?? null

    let items: { label: string; fraction?: number }[] = []
    if (data) {
      const configuredLabels = pluginSettings.trayLines?.[id]
      
      // ['__NONE__'] = user explicitly wants nothing shown (sentinel value)
      // undefined = never configured, show first primary as default
      // [...] = user selection
      let targetLabels: string[]
      if (configuredLabels?.[0] === '__NONE__') {
        targetLabels = [] // User wants nothing
      } else if (configuredLabels === undefined) {
        targetLabels = meta.primaryCandidates.length > 0 ? [meta.primaryCandidates[0]] : []
      } else {
        targetLabels = configuredLabels
      }

      for (const targetLabel of targetLabels) {
        const line = data.lines.find(
          (l): l is ProgressLine => isProgressLine(l) && l.label === targetLabel
        )
        if (line) {
          let fraction: number | undefined
          if (line.limit > 0) {
            const shownAmount =
              displayMode === "used"
                ? line.used
                : line.limit - line.used
            fraction = clamp01(shownAmount / line.limit)
          }
          items.push({ label: targetLabel, fraction })
        }
      }
    }

    // fallback to first primary ONLY if user never configured trayLines (undefined)
    // NOT if they explicitly unchecked everything (empty array)
    const wasEverConfigured = pluginSettings.trayLines?.[id] !== undefined
    if (items.length === 0 && data && !wasEverConfigured) {
      const primaryLabel = meta.primaryCandidates.find((label) =>
        data.lines.some((line) => isProgressLine(line) && line.label === label)
      )
      if (primaryLabel) {
        const primaryLine = data.lines.find(
          (line): line is ProgressLine =>
            isProgressLine(line) && line.label === primaryLabel
        )
        if (primaryLine && primaryLine.limit > 0) {
          const shownAmount =
            displayMode === "used"
              ? primaryLine.used
              : primaryLine.limit - primaryLine.used
          const fraction = clamp01(shownAmount / primaryLine.limit)
          items.push({ label: primaryLabel, fraction })
        }
      }
    }

    out.push({ id, items })
    if (out.length >= maxBars) break
  }

  return out
}

