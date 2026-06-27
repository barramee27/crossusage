import type { ManifestLine, MetricLine, PluginMeta } from "@/lib/plugin-types"
import { metricId, parseMetricId } from "@/lib/metric-id"
import type { PluginSettings } from "@/lib/settings"
import { getProviderInstanceMeta } from "@/lib/settings"

export type MetricDescriptor = {
  id: string
  pluginId: string
  lineLabel: string
  manifest: ManifestLine
  displayName: string
  bounded: boolean
  runtimeOnly?: boolean
}

export function isBoundedManifestLine(line: ManifestLine): boolean {
  return line.type === "progress"
}

function manifestFromLine(line: MetricLine): ManifestLine {
  if (line.type === "barChart") {
    return { type: "barChart", label: line.label, scope: "detail" }
  }
  if (line.type === "progress") {
    return { type: "progress", label: line.label, scope: "detail" }
  }
  if (line.type === "badge") {
    return { type: "badge", label: line.label, scope: "detail" }
  }
  return { type: "text", label: line.label, scope: "detail" }
}

export function buildMetricDescriptors(
  pluginsMeta: PluginMeta[],
  pluginSettings: PluginSettings | null,
  pluginStates?: Record<string, { data?: { lines?: MetricLine[] } | null } | undefined>,
): MetricDescriptor[] {
  if (!pluginSettings) return []
  const disabled = new Set(pluginSettings.disabled)
  const out: MetricDescriptor[] = []
  const known = new Set<string>()

  for (const instanceId of pluginSettings.order) {
    if (disabled.has(instanceId)) continue
    const meta = getProviderInstanceMeta(instanceId, pluginSettings, pluginsMeta)
    if (!meta) continue

    if (meta.lines?.length) {
      for (const manifest of meta.lines) {
        const id = metricId(instanceId, manifest.label)
        known.add(id)
        out.push({
          id,
          pluginId: instanceId,
          lineLabel: manifest.label,
          manifest,
          displayName: meta.name,
          bounded: isBoundedManifestLine(manifest),
        })
      }
    }

    const liveLines = pluginStates?.[instanceId]?.data?.lines ?? []
    for (const line of liveLines) {
      const id = metricId(instanceId, line.label)
      if (known.has(id)) continue
      known.add(id)
      const manifest = manifestFromLine(line)
      out.push({
        id,
        pluginId: instanceId,
        lineLabel: line.label,
        manifest,
        displayName: meta.name,
        bounded: line.type === "progress",
        runtimeOnly: true,
      })
    }
  }
  return out
}

export function findMetricLine(
  lines: MetricLine[] | undefined,
  label: string,
): MetricLine | undefined {
  if (!lines) return undefined
  return lines.find((l) => l.label === label)
}

export function defaultOverviewMetricIds(descriptors: MetricDescriptor[]): string[] {
  return descriptors
    .filter((d) => d.manifest.scope === "overview")
    .map((d) => d.id)
}

export function descriptorLabel(metricIdValue: string): string {
  return parseMetricId(metricIdValue)?.lineLabel ?? metricIdValue
}
