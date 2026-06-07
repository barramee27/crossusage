import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"

export type ProgressLine = Extract<
  PluginOutput["lines"][number],
  { type: "progress"; label: string; used: number; limit: number }
>

export function isProgressLine(line: PluginOutput["lines"][number]): line is ProgressLine {
  return line.type === "progress"
}

function isWeeklyOverviewLine(meta: PluginMeta, label: string): boolean {
  return meta.lines.some(
    (line) =>
      line.type === "progress" &&
      line.scope === "overview" &&
      line.label === label &&
      /weekly/i.test(label),
  )
}

/** Tray line labels configured for an instance, or undefined when using primary auto-pick. */
export function resolveConfiguredTrayLineLabels(
  pluginSettings: PluginSettings,
  instanceId: string,
): string[] | undefined {
  const configured = pluginSettings.trayLines?.[instanceId]
  if (configured === undefined) return undefined
  if (configured[0] === "__NONE__") return []
  return configured
}

/** Primary overview progress line for insights, alerts, and default tray bar. */
export function resolvePrimaryProgressLine(args: {
  meta: PluginMeta
  data: PluginOutput
  pluginSettings: PluginSettings
  instanceId: string
  preferWeeklyLimit?: boolean
}): ProgressLine | null {
  const { meta, data, pluginSettings, instanceId, preferWeeklyLimit = false } = args

  const configuredLabels = resolveConfiguredTrayLineLabels(pluginSettings, instanceId)
  if (configuredLabels !== undefined) {
    const first = configuredLabels[0]
    if (!first) return null
    return (
      data.lines.find((l): l is ProgressLine => isProgressLine(l) && l.label === first) ?? null
    )
  }

  const weeklyLabel = preferWeeklyLimit
    ? data.lines
        .filter(isProgressLine)
        .find((line) => isWeeklyOverviewLine(meta, line.label))?.label
    : undefined

  const primaryLabel =
    weeklyLabel ??
    (meta.primaryCandidates ?? []).find((label) =>
      data.lines.some((line) => isProgressLine(line) && line.label === label),
    )

  if (!primaryLabel) return null
  return (
    data.lines.find(
      (line): line is ProgressLine => isProgressLine(line) && line.label === primaryLabel,
    ) ?? null
  )
}

/** All configured or primary tray progress lines for one instance. */
export function resolveTrayProgressLines(args: {
  meta: PluginMeta
  data: PluginOutput
  pluginSettings: PluginSettings
  instanceId: string
  preferWeeklyLimit?: boolean
}): ProgressLine[] {
  const { meta, data, pluginSettings, instanceId, preferWeeklyLimit = false } = args
  const configuredLabels = resolveConfiguredTrayLineLabels(pluginSettings, instanceId)

  if (configuredLabels !== undefined) {
    const lines: ProgressLine[] = []
    for (const label of configuredLabels) {
      const line = data.lines.find((l): l is ProgressLine => isProgressLine(l) && l.label === label)
      if (line) lines.push(line)
    }
    return lines
  }

  const primary = resolvePrimaryProgressLine({
    meta,
    data,
    pluginSettings,
    instanceId,
    preferWeeklyLimit,
  })
  return primary ? [primary] : []
}
