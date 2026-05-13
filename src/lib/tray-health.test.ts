import { describe, expect, it } from "vitest"
import { collectTrayIssues, formatTrayIssuesAppendage } from "./tray-health"
import type { PluginMeta } from "./plugin-types"
import type { PluginSettings } from "./settings"
import type { PluginState } from "@/hooks/app/types"

const meta: PluginMeta[] = [
  {
    id: "cursor",
    name: "Cursor",
    iconUrl: "",
    lines: [],
    links: [],
    primaryCandidates: [],
  },
  {
    id: "codex",
    name: "Codex",
    iconUrl: "",
    lines: [],
    links: [],
    primaryCandidates: [],
  },
]

function baseSettings(): PluginSettings {
  return {
    order: ["cursor", "codex"],
    disabled: [],
    providerInstances: {
      cursor: { baseProviderId: "cursor", label: "" },
      codex: { baseProviderId: "codex", label: "" },
    },
  }
}

describe("tray-health", () => {
  it("returns null when no plugin settings", () => {
    expect(
      formatTrayIssuesAppendage({
        pluginsMeta: meta,
        pluginSettings: null,
        pluginStates: {},
      })
    ).toBeNull()
  })

  it("returns null when no errors", () => {
    const states: Record<string, PluginState> = {
      cursor: {
        data: { providerId: "cursor", lines: [{ type: "text", label: "x", value: "1" }] },
        loading: false,
        error: null,
        lastManualRefreshAt: null,
        lastUpdatedAt: Date.now(),
      },
    }
    expect(
      formatTrayIssuesAppendage({
        pluginsMeta: meta,
        pluginSettings: baseSettings(),
        pluginStates: states,
      })
    ).toBeNull()
  })

  it("marks stale when error and prior lines", () => {
    const states: Record<string, PluginState> = {
      cursor: {
        data: { providerId: "cursor", lines: [{ type: "text", label: "x", value: "1" }] },
        loading: false,
        error: "network down",
        lastManualRefreshAt: null,
        lastUpdatedAt: 1,
      },
    }
    const issues = collectTrayIssues({
      pluginsMeta: meta,
      pluginSettings: baseSettings(),
      pluginStates: states,
    })
    expect(issues).toEqual([
      { instanceId: "cursor", displayName: "Cursor", kind: "stale" },
    ])
    expect(
      formatTrayIssuesAppendage({
        pluginsMeta: meta,
        pluginSettings: baseSettings(),
        pluginStates: states,
      })
    ).toBe("Issues: Cursor (stale)")
  })

  it("marks error when no prior data", () => {
    const states: Record<string, PluginState> = {
      codex: {
        data: null,
        loading: false,
        error: "bad token",
        lastManualRefreshAt: null,
        lastUpdatedAt: null,
      },
    }
    expect(
      formatTrayIssuesAppendage({
        pluginsMeta: meta,
        pluginSettings: baseSettings(),
        pluginStates: states,
      })
    ).toBe("Issues: Codex (bad token)")
  })

  it("truncates long combined line", () => {
    const settings = baseSettings()
    const states: Record<string, PluginState> = {
      cursor: {
        data: null,
        loading: false,
        error: "x",
        lastManualRefreshAt: null,
        lastUpdatedAt: null,
      },
      codex: {
        data: null,
        loading: false,
        error: "y",
        lastManualRefreshAt: null,
        lastUpdatedAt: null,
      },
    }
    const line = formatTrayIssuesAppendage({
      pluginsMeta: meta,
      pluginSettings: settings,
      pluginStates: states,
      maxLen: 40,
    })
    expect(line).not.toBeNull()
    expect(line!.length).toBeLessThanOrEqual(40)
  })
})
