import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useSettingsPluginList } from "@/hooks/app/use-settings-plugin-list"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"

function createPluginMeta(
  id: string,
  name: string,
  primaryCandidates: string[] = []
): PluginMeta {
  return {
    id,
    name,
    iconUrl: `/${id}.svg`,
    brandColor: "#000000",
    lines: [],
    primaryCandidates,
  }
}

describe("useSettingsPluginList", () => {
  it("returns ordered settings plugins with enabled state", () => {
    const pluginSettings: PluginSettings = {
      order: ["codex", "missing", "cursor"],
      disabled: ["cursor"],
    }

    const { result } = renderHook(() =>
      useSettingsPluginList({
        pluginSettings,
        pluginsMeta: [
          createPluginMeta("cursor", "Cursor"),
          createPluginMeta("codex", "Codex"),
        ],
      })
    )

    expect(result.current).toEqual([
      { id: "codex", baseProviderId: "codex", name: "Codex", enabled: true, primaryCandidates: [], trayLines: [] },
      { id: "cursor", baseProviderId: "cursor", name: "Cursor", enabled: false, primaryCandidates: [], trayLines: [] },
    ])
  })

  it("shows provider account instances with base metadata", () => {
    const pluginSettings: PluginSettings = {
      order: ["claude", "claude:work"],
      disabled: [],
      providerInstances: {
        "claude:work": { baseProviderId: "claude", label: "Work" },
      },
      trayLines: { "claude:work": ["Usage"] },
    }

    const { result } = renderHook(() =>
      useSettingsPluginList({
        pluginSettings,
        pluginsMeta: [createPluginMeta("claude", "Claude", ["Usage"])],
      })
    )

    expect(result.current).toEqual([
      {
        id: "claude",
        baseProviderId: "claude",
        name: "Claude",
        enabled: true,
        primaryCandidates: ["Usage"],
        trayLines: ["Usage"],
      },
      {
        id: "claude:work",
        baseProviderId: "claude",
        instanceLabel: "Work",
        name: "Claude (Work)",
        enabled: true,
        primaryCandidates: ["Usage"],
        trayLines: ["Usage"],
      },
    ])
  })

  it("shows first primary as selected when trayLines never configured", () => {
    const pluginSettings: PluginSettings = {
      order: ["codex"],
      disabled: [],
      trayLines: {},
    }

    const { result } = renderHook(() =>
      useSettingsPluginList({
        pluginSettings,
        pluginsMeta: [createPluginMeta("codex", "Codex", ["Session", "Weekly"])],
      })
    )

    expect(result.current).toEqual([
      {
        id: "codex",
        baseProviderId: "codex",
        name: "Codex",
        enabled: true,
        primaryCandidates: ["Session", "Weekly"],
        trayLines: ["Session"],
      },
    ])
  })

  it("returns empty list when settings are not loaded", () => {
    const { result } = renderHook(() =>
      useSettingsPluginList({
        pluginSettings: null,
        pluginsMeta: [createPluginMeta("codex", "Codex")],
      })
    )

    expect(result.current).toEqual([])
  })
})
