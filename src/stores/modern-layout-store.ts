import { create } from "zustand"
import { parseMetricId } from "@/lib/metric-id"
import {
  DEFAULT_PINNED_METRIC_IDS,
  EMPTY_MODERN_LAYOUT,
  canPinMetric,
  pinnedIdsFromTrayLines,
  placedIdsFromPluginSettings,
  providerOrderFromPluginSettings,
  type ModernLayoutState,
} from "@/lib/modern-layout"
import { loadModernLayout, saveModernLayout } from "@/lib/settings"
import type { MetricDescriptor } from "@/lib/metric-registry"
import type { PluginSettings } from "@/lib/settings"

type ModernLayoutStore = ModernLayoutState & {
  hydrated: boolean
  pinLimitNotice: string | null
  setFromPersisted: (state: ModernLayoutState) => void
  ensureInitialized: (
    descriptors: MetricDescriptor[],
    pluginSettings: PluginSettings,
    seedPinnedFromTray?: string[],
  ) => void
  setProviderOrder: (order: string[]) => void
  setMetricOrder: (pluginId: string, order: string[]) => void
  setMetricEnabled: (metricIdValue: string, enabled: boolean) => void
  setProviderMetricsEnabled: (pluginId: string, metricIds: string[], enabled: boolean) => void
  togglePin: (metricIdValue: string) => boolean
  setTrayFocusProvider: (pluginId: string | null) => void
  setPinnedOrder: (order: string[]) => void
  syncDescriptors: (descriptors: MetricDescriptor[]) => void
  syncPinsFromTrayLines: (trayLines: Record<string, string[]> | undefined, descriptors: MetricDescriptor[]) => void
  clearPinNotice: () => void
  persist: () => Promise<void>
}

function filterKnown(ids: string[], descriptors: MetricDescriptor[]): string[] {
  const known = new Set(descriptors.map((d) => d.id))
  return ids.filter((id) => known.has(id))
}

function defaultMetricOrderByProvider(descriptors: MetricDescriptor[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const d of descriptors) {
    if (!map[d.pluginId]) map[d.pluginId] = []
    map[d.pluginId].push(d.id)
  }
  return map
}

export const useModernLayoutStore = create<ModernLayoutStore>((set, get) => ({
  ...EMPTY_MODERN_LAYOUT,
  hydrated: false,
  pinLimitNotice: null,

  setFromPersisted: (state) => {
    set({ ...state, hydrated: true })
  },

  ensureInitialized: (descriptors, pluginSettings, seedPinnedFromTray = []) => {
    const current = get()
    if (current.initialized) return

    const placed = placedIdsFromPluginSettings(pluginSettings, descriptors)
    let pinned = filterKnown(
      seedPinnedFromTray.length > 0 ? seedPinnedFromTray : DEFAULT_PINNED_METRIC_IDS,
      descriptors,
    )
    if (pinned.length === 0 && placed.length > 0) {
      pinned = filterKnown(placed, descriptors).slice(0, 4)
    }
    if (pinned.length === 0) {
      pinned = filterKnown(DEFAULT_PINNED_METRIC_IDS, descriptors)
    }

    const next: ModernLayoutState = {
      placedMetricIds: placed,
      providerOrder: providerOrderFromPluginSettings(pluginSettings, descriptors),
      metricOrderByProvider: defaultMetricOrderByProvider(descriptors),
      pinnedMetricIds: pinned,
      trayFocusProviderId: pinned.length > 0 ? (parseMetricId(pinned[0])?.pluginId ?? null) : null,
      initialized: true,
    }
    set({ ...next, hydrated: true })
    void saveModernLayout(next).catch((e) => console.error("saveModernLayout:", e))
  },

  setProviderOrder: (order) => {
    set({ providerOrder: order })
    void get().persist()
  },

  setMetricOrder: (pluginId, order) => {
    set((s) => ({
      metricOrderByProvider: { ...s.metricOrderByProvider, [pluginId]: order },
    }))
    void get().persist()
  },

  setMetricEnabled: (metricIdValue, enabled) => {
    set((s) => {
      const placed = new Set(s.placedMetricIds)
      if (enabled) placed.add(metricIdValue)
      else placed.delete(metricIdValue)
      return { placedMetricIds: Array.from(placed) }
    })
    void get().persist()
  },

  setProviderMetricsEnabled: (pluginId, metricIds, enabled) => {
    set((s) => {
      const placed = new Set(s.placedMetricIds)
      for (const id of metricIds) {
        if (!id.startsWith(`${pluginId}:`)) continue
        if (enabled) placed.add(id)
        else placed.delete(id)
      }
      return { placedMetricIds: Array.from(placed) }
    })
    void get().persist()
  },

  setTrayFocusProvider: (pluginId) => {
    set({ trayFocusProviderId: pluginId })
    void get().persist()
  },

  setPinnedOrder: (order) => {
    set({ pinnedMetricIds: order, pinLimitNotice: null })
    void get().persist()
  },

  syncDescriptors: (descriptors) => {
    const current = get()
    if (!current.initialized) return

    const known = new Set(descriptors.map((d) => d.id))
    const pinned = filterKnown(current.pinnedMetricIds, descriptors)

    const defaultOrder = defaultMetricOrderByProvider(descriptors)
    const metricOrderByProvider: Record<string, string[]> = { ...current.metricOrderByProvider }
    for (const [pluginId, ids] of Object.entries(defaultOrder)) {
      const merged = [...(metricOrderByProvider[pluginId] ?? []).filter((id) => known.has(id))]
      for (const id of ids) {
        if (!merged.includes(id)) merged.push(id)
      }
      metricOrderByProvider[pluginId] = merged
    }

    set({ pinnedMetricIds: pinned, metricOrderByProvider })
    void get().persist()
  },

  syncPinsFromTrayLines: (trayLines: Record<string, string[]> | undefined, descriptors: MetricDescriptor[]) => {
    const current = get()
    if (!current.initialized || !trayLines || Object.keys(trayLines).length === 0) return

    const fromTray = filterKnown(pinnedIdsFromTrayLines(trayLines), descriptors)
    if (fromTray.length === 0) return

    const same =
      fromTray.length === current.pinnedMetricIds.length &&
      fromTray.every((id, i) => current.pinnedMetricIds[i] === id)
    if (same) return

    set({
      pinnedMetricIds: fromTray,
      trayFocusProviderId: parseMetricId(fromTray[0])?.pluginId ?? current.trayFocusProviderId,
    })
    void get().persist()
  },

  togglePin: (metricIdValue) => {
    const parsed = parseMetricId(metricIdValue)
    const s = get()
    const pinned = [...s.pinnedMetricIds]
    const idx = pinned.indexOf(metricIdValue)
    if (idx >= 0) {
      pinned.splice(idx, 1)
      const nextFocus =
        s.trayFocusProviderId === parsed?.pluginId && pinned.length > 0
          ? (parseMetricId(pinned[0])?.pluginId ?? null)
          : s.trayFocusProviderId
      set({ pinnedMetricIds: pinned, pinLimitNotice: null, trayFocusProviderId: nextFocus })
      void get().persist()
      return true
    }
    if (!canPinMetric(pinned, metricIdValue)) {
      set({ pinLimitNotice: "Up to 2 pins per provider" })
      return false
    }
    pinned.push(metricIdValue)
    set({
      pinnedMetricIds: pinned,
      pinLimitNotice: null,
      trayFocusProviderId: parsed?.pluginId ?? s.trayFocusProviderId,
    })
    void get().persist()
    return true
  },

  clearPinNotice: () => set({ pinLimitNotice: null }),

  persist: async () => {
    const {
      placedMetricIds,
      providerOrder,
      metricOrderByProvider,
      pinnedMetricIds,
      trayFocusProviderId,
      initialized,
    } = get()
    await saveModernLayout({
      placedMetricIds,
      providerOrder,
      metricOrderByProvider,
      pinnedMetricIds,
      trayFocusProviderId,
      initialized,
    })
  },
}))

export async function hydrateModernLayoutStore(): Promise<void> {
  const stored = await loadModernLayout()
  useModernLayoutStore.getState().setFromPersisted(stored)
}
