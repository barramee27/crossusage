import { metricId, parseMetricId } from "@/lib/metric-id"
import type { PluginSettings } from "@/lib/settings"
import type { MetricDescriptor } from "@/lib/metric-registry"

export const MAX_PINS_PER_PROVIDER = 2

export type ModernLayoutState = {
  placedMetricIds: string[]
  providerOrder: string[]
  metricOrderByProvider: Record<string, string[]>
  pinnedMetricIds: string[]
  /** Which provider logo/readout to use for single-provider tray icon styles (Plugin, Pie, Logo). */
  trayFocusProviderId: string | null
  initialized: boolean
}

export const EMPTY_MODERN_LAYOUT: ModernLayoutState = {
  placedMetricIds: [],
  providerOrder: [],
  metricOrderByProvider: {},
  pinnedMetricIds: [],
  trayFocusProviderId: null,
  initialized: false,
}

/** First-launch defaults ported from upstream DefaultLayout.swift (filtered to known plugins at runtime). */
export const DEFAULT_PLACED_METRIC_IDS: string[] = [
  metricId("claude", "Session"),
  metricId("claude", "Weekly"),
  metricId("codex", "Session"),
  metricId("codex", "Weekly"),
  metricId("devin", "Weekly quota"),
  metricId("devin", "Daily quota"),
  metricId("grok", "Credits used"),
  metricId("cursor", "Credits"),
  metricId("cursor", "Total usage"),
  metricId("cursor", "Auto usage"),
  metricId("cursor", "API usage"),
]

export const DEFAULT_PINNED_METRIC_IDS: string[] = [
  metricId("claude", "Session"),
  metricId("claude", "Weekly"),
  metricId("codex", "Session"),
  metricId("codex", "Weekly"),
  metricId("cursor", "Auto usage"),
  metricId("cursor", "API usage"),
]

export function countPinsForProvider(pinnedIds: string[], pluginId: string): number {
  let count = 0
  for (const id of pinnedIds) {
    if (id.startsWith(`${pluginId}:`)) count += 1
  }
  return count
}

export function canPinMetric(pinnedIds: string[], metricIdValue: string): boolean {
  const colon = metricIdValue.indexOf(":")
  if (colon <= 0) return false
  const pluginId = metricIdValue.slice(0, colon)
  if (pinnedIds.includes(metricIdValue)) return true
  return countPinsForProvider(pinnedIds, pluginId) < MAX_PINS_PER_PROVIDER
}

export function normalizeModernLayout(raw: unknown): ModernLayoutState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_MODERN_LAYOUT }
  const o = raw as Record<string, unknown>
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  const metricOrder: Record<string, string[]> = {}
  if (o.metricOrderByProvider && typeof o.metricOrderByProvider === "object") {
    for (const [k, v] of Object.entries(o.metricOrderByProvider as Record<string, unknown>)) {
      metricOrder[k] = strArray(v)
    }
  }
  return {
    placedMetricIds: strArray(o.placedMetricIds),
    providerOrder: strArray(o.providerOrder),
    metricOrderByProvider: metricOrder,
    pinnedMetricIds: strArray(o.pinnedMetricIds),
    trayFocusProviderId:
      typeof o.trayFocusProviderId === "string" ? o.trayFocusProviderId : null,
    initialized: o.initialized === true,
  }
}

/** Seed pinned metrics from legacy trayLines on first switch to Modern. */
export function pinnedIdsFromTrayLines(trayLines: Record<string, string[]> | undefined): string[] {
  if (!trayLines) return []
  const out: string[] = []
  for (const [pluginId, lines] of Object.entries(trayLines)) {
    if (!Array.isArray(lines) || lines[0] === "__NONE__") continue
    for (const label of lines) {
      if (label === "__NONE__") continue
      const id = metricId(pluginId, label)
      if (!canPinMetric(out, id)) continue
      out.push(id)
    }
  }
  return out
}

/**
 * Dashboard-visible metrics — matches Classic `ProviderDetailPage` `allowedLabels` logic:
 * - trayLines unset → all metrics for enabled providers
 * - `__NONE__` → none
 * - explicit list → those labels only
 */
export function placedIdsFromPluginSettings(
  pluginSettings: PluginSettings,
  descriptors: MetricDescriptor[],
): string[] {
  const disabled = new Set(pluginSettings.disabled)
  const byPlugin = new Map<string, MetricDescriptor[]>()
  for (const d of descriptors) {
    const list = byPlugin.get(d.pluginId) ?? []
    list.push(d)
    byPlugin.set(d.pluginId, list)
  }

  const out: string[] = []
  for (const instanceId of pluginSettings.order) {
    if (disabled.has(instanceId)) continue
    const items = byPlugin.get(instanceId)
    if (!items?.length) continue

    const raw = pluginSettings.trayLines?.[instanceId]
    if (raw == null || raw.length === 0) {
      out.push(...items.map((d) => d.id))
      continue
    }
    if (raw[0] === "__NONE__") continue
    for (const label of raw) {
      if (label === "__NONE__") continue
      const id = metricId(instanceId, label)
      if (items.some((d) => d.id === id)) out.push(id)
    }
  }
  return out
}

export function providerOrderFromPluginSettings(
  pluginSettings: PluginSettings,
  descriptors: MetricDescriptor[],
): string[] {
  const disabled = new Set(pluginSettings.disabled)
  const known = new Set(descriptors.map((d) => d.pluginId))
  const order: string[] = []
  for (const id of pluginSettings.order) {
    if (disabled.has(id) || !known.has(id)) continue
    if (!order.includes(id)) order.push(id)
  }
  for (const id of known) {
    if (!order.includes(id)) order.push(id)
  }
  return order
}

export function isDashboardMetricPlaced(
  metricIdValue: string,
  pluginSettings: PluginSettings,
  descriptors: MetricDescriptor[],
): boolean {
  return placedIdsFromPluginSettings(pluginSettings, descriptors).includes(metricIdValue)
}

function effectiveDashboardLabels(
  pluginSettings: PluginSettings,
  pluginId: string,
  allLabels: string[],
): string[] {
  const raw = pluginSettings.trayLines?.[pluginId]
  if (raw == null || raw.length === 0) return [...allLabels]
  if (raw[0] === "__NONE__") return []
  return raw.filter((l) => l !== "__NONE__")
}

function trayLinesAfterDashboardLabels(
  prev: Record<string, string[]>,
  pluginId: string,
  labels: string[],
  allLabels: string[],
): Record<string, string[]> {
  const next = { ...prev }
  if (labels.length === 0) {
    next[pluginId] = ["__NONE__"]
  } else if (
    labels.length === allLabels.length &&
    allLabels.every((l) => labels.includes(l))
  ) {
    delete next[pluginId]
  } else {
    next[pluginId] = labels
  }
  return next
}

/** Toggle one dashboard metric; keeps Classic provider detail + Modern Customize in sync. */
export function applyDashboardMetricToggle(
  pluginSettings: PluginSettings,
  pluginId: string,
  lineLabel: string,
  checked: boolean,
  allLabels: string[],
): PluginSettings {
  const current = effectiveDashboardLabels(pluginSettings, pluginId, allLabels)
  let next: string[]
  if (checked) {
    next = current.includes(lineLabel) ? current : [...current, lineLabel]
  } else {
    next = current.filter((l) => l !== lineLabel)
  }
  return {
    ...pluginSettings,
    trayLines: trayLinesAfterDashboardLabels(
      pluginSettings.trayLines ?? {},
      pluginId,
      next,
      allLabels,
    ),
  }
}

/** Show all / hide all metrics for a provider on the Modern dashboard (and Classic detail). */
export function applyProviderDashboardMetrics(
  pluginSettings: PluginSettings,
  pluginId: string,
  allLabels: string[],
  enabled: boolean,
): PluginSettings {
  const labels = enabled ? [...allLabels] : []
  return {
    ...pluginSettings,
    trayLines: trayLinesAfterDashboardLabels(
      pluginSettings.trayLines ?? {},
      pluginId,
      labels,
      allLabels,
    ),
  }
}

export function parseMetricPluginId(metricIdValue: string): string | null {
  return parseMetricId(metricIdValue)?.pluginId ?? null
}

/**
 * One-time bridge: users who customized Modern dashboard before tray-line sync
 * keep their placed metrics by writing them into shared trayLines.
 */
export function migrateModernPlacedToTrayLines(
  pluginSettings: PluginSettings,
  placedMetricIds: string[],
): PluginSettings {
  if (placedMetricIds.length === 0) return pluginSettings
  if (pluginSettings.trayLines && Object.keys(pluginSettings.trayLines).length > 0) {
    return pluginSettings
  }

  const byPlugin = new Map<string, string[]>()
  for (const id of placedMetricIds) {
    const parsed = parseMetricId(id)
    if (!parsed) continue
    const list = byPlugin.get(parsed.pluginId) ?? []
    if (!list.includes(parsed.lineLabel)) list.push(parsed.lineLabel)
    byPlugin.set(parsed.pluginId, list)
  }
  if (byPlugin.size === 0) return pluginSettings

  const trayLines = { ...(pluginSettings.trayLines ?? {}) }
  for (const [pluginId, labels] of byPlugin) {
    trayLines[pluginId] = labels
  }
  return { ...pluginSettings, trayLines }
}
