import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import { getProviderInstanceMeta, type PluginSettings } from "@/lib/settings"
import { DEFAULT_DISPLAY_MODE, type DisplayMode } from "@/lib/settings"
import { clamp01 } from "@/lib/utils"

type PluginState = {
  data: PluginOutput | null
  loading: boolean
  error: string | null
}

export type TrayPrimaryBarItem = {
  label: string
  fraction?: number
  /** When dollars, `used` / `limit` match the plugin progress line (dollar amounts). */
  valueKind?: "dollars"
  used?: number
  limit?: number
}

export type TrayPrimaryBar = {
  id: string
  color?: string
  items: TrayPrimaryBarItem[]
}

type ProgressLine = Extract<
  PluginOutput["lines"][number],
  { type: "progress"; label: string; used: number; limit: number }
>

function isProgressLine(line: PluginOutput["lines"][number]): line is ProgressLine {
  return line.type === "progress"
}

function isWeeklyOverviewLine(meta: PluginMeta, label: string): boolean {
  return meta.lines.some((line) =>
    line.type === "progress" &&
    line.scope === "overview" &&
    line.label === label &&
    /weekly/i.test(label)
  )
}

export function getTrayPrimaryBars(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  maxBars?: number
  displayMode?: DisplayMode
  pluginId?: string
  preferWeeklyLimit?: boolean
}): TrayPrimaryBar[] {
  const {
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars = 4,
    displayMode = DEFAULT_DISPLAY_MODE,
    pluginId,
    preferWeeklyLimit = false,
  } = args
  if (!pluginSettings) return []

  const disabled = new Set(pluginSettings.disabled)
  const orderedIds = pluginId
    ? [pluginId]
    : pluginSettings.order

  const out: TrayPrimaryBar[] = []
  for (const id of orderedIds) {
    if (disabled.has(id)) continue
    const meta = getProviderInstanceMeta(id, pluginSettings, pluginsMeta)
    if (!meta) continue

    // Skip if no primary candidates defined
    if (!meta.primaryCandidates || meta.primaryCandidates.length === 0) continue

    const state = pluginStates[id]
    const data = state?.data ?? null

    let items: TrayPrimaryBarItem[] = []
    if (data) {
      const weeklyLabel = preferWeeklyLimit
        ? data.lines
            .filter(isProgressLine)
            .find((line) => isWeeklyOverviewLine(meta, line.label))
            ?.label
        : undefined

      // Find first candidate that exists in runtime data
      const primaryLabel = weeklyLabel ?? meta.primaryCandidates.find((label) =>
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
          if (primaryLine.format?.kind === "dollars") {
            items.push({
              label: primaryLabel,
              fraction,
              valueKind: "dollars",
              used: primaryLine.used,
              limit: primaryLine.limit,
            })
          } else {
            items.push({ label: primaryLabel, fraction })
          }
        }
      }
    }

    out.push({ id, color: meta.brandColor, items })
    if (out.length >= maxBars) break
  }

  return out
}
