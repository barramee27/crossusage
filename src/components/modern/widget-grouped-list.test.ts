import { describe, expect, it } from "vitest"
import { buildProviderWidgetGroups } from "@/components/modern/widget-grouped-list"
import { metricId } from "@/lib/metric-id"
import type { PluginMeta } from "@/lib/plugin-types"

describe("buildProviderWidgetGroups", () => {
  const cursorMeta: PluginMeta = {
    id: "cursor:work",
    baseProviderId: "cursor",
    instanceLabel: "Work",
    name: "Cursor (Work)",
    iconUrl: "",
    lines: [],
    primaryCandidates: [],
  }

  it("groups metrics for provider account instances", () => {
    const credits = metricId("cursor:work", "Credits")
    const groups = buildProviderWidgetGroups({
      placedMetricIds: [credits],
      providerOrder: ["cursor", "cursor:work"],
      metricOrderByProvider: {},
      widgetDataById: new Map(),
      getMeta: (id) => (id === "cursor:work" ? cursorMeta : undefined),
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.pluginId).toBe("cursor:work")
    expect(groups[0]?.name).toBe("Cursor (Work)")
    expect(groups[0]?.metrics).toHaveLength(1)
  })
})
