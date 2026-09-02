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
    lines: primaryCandidates.map((label) => ({
      type: "progress" as const,
      label,
      scope: "overview" as const,
    })),
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
      { id: "codex", baseProviderId: "codex", name: "Codex", enabled: true, primaryCandidates: [], trayReadoutLabels: [], trayLines: [] },
      { id: "cursor", baseProviderId: "cursor", name: "Cursor", enabled: false, primaryCandidates: [], trayReadoutLabels: [], trayLines: [] },
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
        trayReadoutLabels: ["Usage"],
        trayLines: ["Usage"],
      },
      {
        id: "claude:work",
        baseProviderId: "claude",
        instanceLabel: "Work",
        name: "Claude (Work)",
        enabled: true,
        primaryCandidates: ["Usage"],
        trayReadoutLabels: ["Usage"],
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
        trayReadoutLabels: ["Session", "Weekly"],
        trayLines: ["Session"],
      },
    ])
  })

  it("lists every plugin.json progress line even without primaryOrder", () => {
    const pluginSettings: PluginSettings = {
      order: ["cursor"],
      disabled: [],
    }

    const { result } = renderHook(() =>
      useSettingsPluginList({
        pluginSettings,
        pluginsMeta: [
          {
            id: "cursor",
            name: "Cursor",
            iconUrl: "/cursor.svg",
            iconFilePath: "",
            brandColor: "#000",
            lines: [
              { type: "progress", label: "Credits", scope: "overview" },
              { type: "progress", label: "Total usage", scope: "overview" },
              { type: "progress", label: "Cursor Models", scope: "detail" },
              { type: "text", label: "Today", scope: "detail" },
            ],
            primaryCandidates: ["Total usage", "Credits"],
          },
        ],
      })
    )

    expect(result.current[0]?.trayReadoutLabels).toEqual([
      "Credits",
      "Total usage",
      "Cursor Models",
    ])
    expect(result.current[0]?.primaryCandidates).toEqual(["Total usage", "Credits"])
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
