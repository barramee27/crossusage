/** Canonical metric id: `pluginId:lineLabel` (matches plugin manifest labels). */
export function metricId(pluginId: string, lineLabel: string): string {
  return `${pluginId}:${lineLabel}`
}

export function parseMetricId(id: string): { pluginId: string; lineLabel: string } | null {
  const idx = id.indexOf(":")
  if (idx <= 0 || idx >= id.length - 1) return null
  return { pluginId: id.slice(0, idx), lineLabel: id.slice(idx + 1) }
}

export function baseProviderIdFromMetricId(metricIdValue: string): string | null {
  const parsed = parseMetricId(metricIdValue)
  if (!parsed) return null
  const colon = parsed.pluginId.indexOf(":")
  return colon >= 0 ? parsed.pluginId.slice(0, colon) : parsed.pluginId
}
