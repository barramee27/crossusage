import { describe, expect, it } from "vitest"
import { metricId, migrateMetricId, parseMetricId } from "@/lib/metric-id"

describe("metric-id", () => {
  it("uses :: between plugin instance and line label", () => {
    expect(metricId("cursor", "Credits")).toBe("cursor::Credits")
    expect(metricId("cursor:work", "Credits")).toBe("cursor:work::Credits")
  })

  it("parses provider account metric ids", () => {
    expect(parseMetricId("cursor:work::Credits")).toEqual({
      pluginId: "cursor:work",
      lineLabel: "Credits",
    })
  })

  it("migrates legacy single-colon metric ids", () => {
    expect(migrateMetricId("cursor:Credits")).toBe("cursor::Credits")
    expect(migrateMetricId("cursor:work:Credits")).toBe("cursor:work::Credits")
    expect(parseMetricId("cursor:work:Credits")).toEqual({
      pluginId: "cursor:work",
      lineLabel: "Credits",
    })
  })
})
