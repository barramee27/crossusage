import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { MetricDescriptor } from "@/lib/metric-registry"
import { cn } from "@/lib/utils"

type CustomizeViewProps = {
  descriptors: MetricDescriptor[]
  providerOrder: string[]
  metricOrderByProvider: Record<string, string[]>
  placedMetricIds: string[]
  onTogglePlaced: (metricId: string, enabled: boolean) => void
  onSetProviderMetricsEnabled: (pluginId: string, metricIds: string[], enabled: boolean) => void
  onProviderReorder: (order: string[]) => void
  onMetricReorder: (pluginId: string, order: string[]) => void
  compact?: boolean
}

function orderDescriptors(
  descriptors: MetricDescriptor[],
  providerOrder: string[],
  metricOrderByProvider: Record<string, string[]>,
): { pluginId: string; items: MetricDescriptor[] }[] {
  const byProvider = new Map<string, MetricDescriptor[]>()
  for (const d of descriptors) {
    const list = byProvider.get(d.pluginId) ?? []
    list.push(d)
    byProvider.set(d.pluginId, list)
  }

  const order =
    providerOrder.length > 0
      ? providerOrder.filter((id) => byProvider.has(id))
      : Array.from(byProvider.keys())

  for (const id of byProvider.keys()) {
    if (!order.includes(id)) order.push(id)
  }

  return order.map((pluginId) => {
    const items = byProvider.get(pluginId) ?? []
    const metricOrder = metricOrderByProvider[pluginId]
    if (!metricOrder?.length) return { pluginId, items }
    const rank = new Map(metricOrder.map((id, i) => [id, i]))
    const sorted = [...items].sort(
      (a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999),
    )
    return { pluginId, items: sorted }
  })
}

function metricKindLabel(descriptor: MetricDescriptor): string {
  if (descriptor.bounded) return "quota"
  if (descriptor.manifest.type === "barChart") return "chart"
  if (descriptor.runtimeOnly) return "extra"
  return "info"
}

function SortableMetricRow({
  descriptor,
  isPlaced,
  compact,
  onTogglePlaced,
}: {
  descriptor: MetricDescriptor
  isPlaced: boolean
  compact?: boolean
  onTogglePlaced: (enabled: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: descriptor.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-center gap-2 px-3 bg-card/40",
        compact ? "py-1.5 text-xs" : "py-2 text-sm",
        isDragging && "opacity-60 ring-1 ring-border rounded-md",
      )}
    >
      <button
        type="button"
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
        aria-label={`Reorder ${descriptor.lineLabel}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Checkbox
        checked={isPlaced}
        onCheckedChange={(checked) => onTogglePlaced(checked === true)}
        aria-label={`Show ${descriptor.lineLabel} on dashboard`}
      />
      <span className="flex-1 truncate">{descriptor.lineLabel}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">{metricKindLabel(descriptor)}</span>
    </li>
  )
}

function SortableProviderBlock({
  pluginId,
  items,
  placed,
  compact,
  onTogglePlaced,
  onSetProviderMetricsEnabled,
  onMetricReorder,
  dragHandleProps,
}: {
  pluginId: string
  items: MetricDescriptor[]
  placed: Set<string>
  compact?: boolean
  onTogglePlaced: (metricId: string, enabled: boolean) => void
  onSetProviderMetricsEnabled: (pluginId: string, metricIds: string[], enabled: boolean) => void
  onMetricReorder: (pluginId: string, order: string[]) => void
  dragHandleProps: { attributes: object; listeners: object | undefined }
}) {
  const metricIds = items.map((d) => d.id)
  const allPlaced = metricIds.length > 0 && metricIds.every((id) => placed.has(id))
  const displayName = items[0]?.displayName ?? pluginId

  const handleMetricDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = metricIds.indexOf(String(active.id))
    const newIndex = metricIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onMetricReorder(pluginId, arrayMove(metricIds, oldIndex, newIndex))
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <section className="rounded-lg border bg-card/60 overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/30",
          compact ? "text-sm" : "text-base",
        )}
      >
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
          aria-label={`Reorder ${displayName} card`}
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <h3 className="font-semibold truncate flex-1">{displayName}</h3>
        <div className="flex gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => onSetProviderMetricsEnabled(pluginId, metricIds, !allPlaced)}
          >
            {allPlaced ? "Hide all" : "Show all"}
          </Button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMetricDragEnd}>
        <SortableContext items={metricIds} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-border/50">
            {items.map((d) => (
              <SortableMetricRow
                key={d.id}
                descriptor={d}
                isPlaced={placed.has(d.id)}
                compact={compact}
                onTogglePlaced={(enabled) => onTogglePlaced(d.id, enabled)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function SortableProviderSection(props: {
  pluginId: string
  items: MetricDescriptor[]
  placed: Set<string>
  compact?: boolean
  onTogglePlaced: (metricId: string, enabled: boolean) => void
  onSetProviderMetricsEnabled: (pluginId: string, metricIds: string[], enabled: boolean) => void
  onMetricReorder: (pluginId: string, order: string[]) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.pluginId,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-70" : undefined}
    >
      <SortableProviderBlock
        {...props}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  )
}

export function CustomizeView({
  descriptors,
  providerOrder,
  metricOrderByProvider,
  placedMetricIds,
  onTogglePlaced,
  onSetProviderMetricsEnabled,
  onProviderReorder,
  onMetricReorder,
  compact,
}: CustomizeViewProps) {
  const placed = new Set(placedMetricIds)
  const groups = orderDescriptors(descriptors, providerOrder, metricOrderByProvider)
  const providerIds = groups.map((g) => g.pluginId)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleProviderDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = providerIds.indexOf(String(active.id))
    const newIndex = providerIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onProviderReorder(arrayMove(providerIds, oldIndex, newIndex))
  }

  if (descriptors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Enable providers in Settings to customize metrics.
      </p>
    )
  }

  return (
    <div className="space-y-3 pb-2">
      <p className="text-xs text-muted-foreground px-0.5">
        Drag to reorder dashboard cards and rows. Metric toggles stay in sync with Classic provider lines.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProviderDragEnd}>
        <SortableContext items={providerIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {groups.map((group) => (
              <SortableProviderSection
                key={group.pluginId}
                pluginId={group.pluginId}
                items={group.items}
                placed={placed}
                compact={compact}
                onTogglePlaced={onTogglePlaced}
                onSetProviderMetricsEnabled={onSetProviderMetricsEnabled}
                onMetricReorder={onMetricReorder}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
