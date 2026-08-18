import type { PluginMeta } from "@/lib/plugin-types"
import { metricIdPrefix, parseMetricId } from "@/lib/metric-id"
import { WidgetRow } from "@/components/modern/widget-row"
import type { WidgetData } from "@/lib/widget-data"
import { placeholderWidgetData } from "@/lib/widget-data"
import { descriptorLabel } from "@/lib/metric-registry"
import { cn } from "@/lib/utils"

export type ProviderWidgetGroup = {
  pluginId: string
  name: string
  iconUrl?: string
  brandColor?: string
  metrics: WidgetData[]
}

type WidgetGroupedListProps = {
  groups: ProviderWidgetGroup[]
  compact?: boolean
  className?: string
  onRefreshPlugin?: (pluginId: string) => void
}

export function WidgetGroupedList({ groups, compact, className, onRefreshPlugin }: WidgetGroupedListProps) {
  if (groups.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 text-sm">
        No metrics on dashboard — open Customize to add some.
      </div>
    )
  }

  return (
    <div className={cn("space-y-2 motion-stagger", className)}>
      {groups.map((group, index) => (
        <ProviderCard
          key={group.pluginId}
          group={group}
          compact={compact}
          onRefreshPlugin={onRefreshPlugin}
          index={index}
        />
      ))}
    </div>
  )
}

function ProviderCard({
  group,
  compact,
  onRefreshPlugin,
  index = 0,
}: {
  group: ProviderWidgetGroup
  compact?: boolean
  onRefreshPlugin?: (pluginId: string) => void
  index?: number
}) {
  const bounded = group.metrics.filter((m) => m.bounded && m.kind === "progress")
  const charts = group.metrics.filter((m) => m.kind === "barChart")
  const unbounded = group.metrics.filter((m) => !m.bounded && m.kind !== "barChart")

  return (
    <section
      className="rounded-lg border bg-card/80 overflow-hidden motion-card"
      style={{
        ["--i" as string]: index,
        ...(group.brandColor ? { borderColor: `${group.brandColor}33` } : {}),
      }}
    >
      <header
        className={cn(
          "flex items-center gap-2 px-3 border-b border-border/60",
          compact ? "py-1.5" : "py-2",
        )}
      >
        {group.iconUrl ? (
          <img src={group.iconUrl} alt="" className="h-4 w-4 shrink-0" />
        ) : (
          <span
            className="h-4 w-4 rounded-sm shrink-0 bg-muted"
            style={group.brandColor ? { backgroundColor: group.brandColor } : undefined}
          />
        )}
        <h3 className={cn("font-semibold truncate motion-title", compact ? "text-sm" : "text-base")}>
          {group.name}
        </h3>
      </header>
      <div className={cn("px-3", compact ? "py-1" : "py-2")}>
        {bounded.map((m) => (
          <WidgetRow key={m.metricId} data={m} compact={compact} onRefreshPlugin={onRefreshPlugin} />
        ))}
        {charts.map((m) => (
          <WidgetRow key={m.metricId} data={m} compact={compact} onRefreshPlugin={onRefreshPlugin} />
        ))}
        {unbounded.length > 0 ? (
          <div
            className={cn(
              bounded.length > 0 || charts.length > 0
                ? "mt-1 pt-1 border-t border-border/50"
                : "",
              "space-y-0",
            )}
          >
            {unbounded.map((m) => (
              <WidgetRow
                key={m.metricId}
                data={m}
                compact={compact}
                onRefreshPlugin={onRefreshPlugin}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function buildProviderWidgetGroups(args: {
  placedMetricIds: string[]
  providerOrder: string[]
  metricOrderByProvider: Record<string, string[]>
  widgetDataById: Map<string, WidgetData>
  getMeta: (pluginId: string) => PluginMeta | undefined
}): ProviderWidgetGroup[] {
  const {
    placedMetricIds,
    providerOrder,
    metricOrderByProvider,
    widgetDataById,
    getMeta,
  } = args

  const placedSet = new Set(placedMetricIds)
  const providersWithMetrics = new Set<string>()
  for (const id of placedMetricIds) {
    const pluginId = parseMetricId(id)?.pluginId
    if (pluginId) providersWithMetrics.add(pluginId)
  }

  const order =
    providerOrder.length > 0
      ? providerOrder.filter((p) => providersWithMetrics.has(p))
      : Array.from(providersWithMetrics)

  for (const p of providersWithMetrics) {
    if (!order.includes(p)) order.push(p)
  }

  return order
    .map((pluginId): ProviderWidgetGroup | null => {
      const meta = getMeta(pluginId)
      if (!meta) return null
      const orderIds =
        metricOrderByProvider[pluginId] ??
        placedMetricIds.filter((id) => id.startsWith(metricIdPrefix(pluginId)))
      const metrics: WidgetData[] = []
      for (const id of orderIds) {
        if (!placedSet.has(id)) continue
        const data =
          widgetDataById.get(id) ??
          placeholderWidgetData({
            metricId: id,
            label: descriptorLabel(id),
            displayName: meta.name,
          })
        metrics.push(data)
      }
      if (metrics.length === 0) return null
      return {
        pluginId,
        name: meta.name,
        iconUrl: meta.iconUrl,
        brandColor: meta.brandColor,
        metrics,
      }
    })
    .filter((g): g is ProviderWidgetGroup => g !== null)
}
