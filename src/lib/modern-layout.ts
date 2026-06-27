import { metricId } from "@/lib/metric-id"

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
