import { describe, expect, it } from "vitest"

import { resolvePrimaryProgressLine } from "@/lib/primary-progress-line"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"

const baseMeta: PluginMeta = {
  id: "cursor",
  name: "Cursor",
  iconUrl: "",
  iconFilePath: "",
  primaryCandidates: ["Credits", "Total usage", "Requests"],
  lines: [
    { type: "progress", label: "Credits", scope: "overview" },
    { type: "progress", label: "Total usage", scope: "overview" },
    { type: "progress", label: "Weekly limit", scope: "overview" },
  ],
}

const baseData: PluginOutput = {
  providerId: "cursor",
  displayName: "Cursor",
  iconUrl: "",
  lines: [
    {
      type: "progress",
      label: "Credits",
      used: 10,
      limit: 100,
      format: { kind: "dollars" },
    },
    {
      type: "progress",
      label: "Total usage",
      used: 50,
      limit: 100,
      format: { kind: "percent" },
    },
    {
      type: "progress",
      label: "Weekly limit",
      used: 20,
      limit: 100,
      format: { kind: "percent" },
    },
  ],
}

const settings: PluginSettings = { order: ["cursor"], disabled: [] }

describe("resolvePrimaryProgressLine", () => {
  it("picks first available primaryCandidates", () => {
    const line = resolvePrimaryProgressLine({
      meta: baseMeta,
      data: baseData,
      pluginSettings: settings,
      instanceId: "cursor",
    })
    expect(line?.label).toBe("Credits")
  })

  it("prefers weekly overview line when preferWeeklyLimit", () => {
    const line = resolvePrimaryProgressLine({
      meta: baseMeta,
      data: baseData,
      pluginSettings: settings,
      instanceId: "cursor",
      preferWeeklyLimit: true,
    })
    expect(line?.label).toBe("Weekly limit")
  })

  it("uses first configured tray line when trayLines set", () => {
    const line = resolvePrimaryProgressLine({
      meta: baseMeta,
      data: baseData,
      pluginSettings: { ...settings, trayLines: { cursor: ["Total usage"] } },
      instanceId: "cursor",
    })
    expect(line?.label).toBe("Total usage")
  })

  it("returns null when trayLines is __NONE__", () => {
    const line = resolvePrimaryProgressLine({
      meta: baseMeta,
      data: baseData,
      pluginSettings: { ...settings, trayLines: { cursor: ["__NONE__"] } },
      instanceId: "cursor",
    })
    expect(line).toBeNull()
  })
})
