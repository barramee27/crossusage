/** Separator between plugin instance id and line label (instance ids use a single `:`). */
export const METRIC_ID_SEP = "::"

/** Canonical metric id: `pluginId::lineLabel` */
export function metricId(pluginId: string, lineLabel: string): string {
  return `${pluginId}${METRIC_ID_SEP}${lineLabel}`
}

export function metricIdPrefix(pluginId: string): string {
  return `${pluginId}${METRIC_ID_SEP}`
}

/** Upgrade legacy `cursor:Label` and `cursor:work:Label` ids to `::` form. */
export function migrateMetricId(id: string): string {
  if (id.includes(METRIC_ID_SEP)) return id
  const first = id.indexOf(":")
  if (first < 0) return id

  const second = id.indexOf(":", first + 1)
  if (second < 0) {
    return `${id.slice(0, first)}${METRIC_ID_SEP}${id.slice(first + 1)}`
  }
  return `${id.slice(0, second)}${METRIC_ID_SEP}${id.slice(second + 1)}`
}

export function parseMetricId(id: string): { pluginId: string; lineLabel: string } | null {
  const normalized = migrateMetricId(id)
  const idx = normalized.indexOf(METRIC_ID_SEP)
  if (idx <= 0 || idx >= normalized.length - METRIC_ID_SEP.length) return null
  return {
    pluginId: normalized.slice(0, idx),
    lineLabel: normalized.slice(idx + METRIC_ID_SEP.length),
  }
}

export function baseProviderIdFromMetricId(metricIdValue: string): string | null {
  const parsed = parseMetricId(metricIdValue)
  if (!parsed) return null
  const colon = parsed.pluginId.indexOf(":")
  return colon >= 0 ? parsed.pluginId.slice(0, colon) : parsed.pluginId
}
