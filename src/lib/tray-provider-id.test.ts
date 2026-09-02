import { describe, expect, it } from "vitest"

import { pickTrayProviderId } from "@/lib/tray-provider-id"

const enabled = ["claude", "cursor", "codex"]

describe("pickTrayProviderId", () => {
  it("classic follows the open sidebar provider", () => {
    expect(
      pickTrayProviderId({
        uiLayout: "classic",
        enabledPluginIds: enabled,
        activeProviderId: "cursor",
        trayFocusProviderId: "claude",
        lastTrayProviderId: "claude",
        firstPinnedProviderId: "claude",
      }),
    ).toBe("cursor")
  })

  it("classic ignores pin focus on home and uses last viewed", () => {
    expect(
      pickTrayProviderId({
        uiLayout: "classic",
        enabledPluginIds: [...enabled, "antigravity"],
        activeProviderId: null,
        trayFocusProviderId: "antigravity",
        lastTrayProviderId: "cursor",
        firstPinnedProviderId: "claude",
      }),
    ).toBe("cursor")
  })

  it("falls back to last viewed when tray focus is missing", () => {
    expect(
      pickTrayProviderId({
        uiLayout: "classic",
        enabledPluginIds: enabled,
        activeProviderId: null,
        trayFocusProviderId: null,
        lastTrayProviderId: "cursor",
        firstPinnedProviderId: "claude",
      }),
    ).toBe("cursor")
  })

  it("modern dashboard with no open provider uses tray focus", () => {
    expect(
      pickTrayProviderId({
        uiLayout: "modern",
        enabledPluginIds: enabled,
        activeProviderId: null,
        trayFocusProviderId: "claude",
        lastTrayProviderId: "codex",
        firstPinnedProviderId: "cursor",
      }),
    ).toBe("claude")
  })

  it("falls back to the open provider when tray focus is missing", () => {
    expect(
      pickTrayProviderId({
        uiLayout: "modern",
        enabledPluginIds: enabled,
        activeProviderId: "cursor",
        trayFocusProviderId: null,
        lastTrayProviderId: null,
        firstPinnedProviderId: null,
      }),
    ).toBe("cursor")
  })

  it("modern uses first pinned when nothing else is selected", () => {
    expect(
      pickTrayProviderId({
        uiLayout: "modern",
        enabledPluginIds: enabled,
        activeProviderId: null,
        trayFocusProviderId: null,
        lastTrayProviderId: null,
        firstPinnedProviderId: "cursor",
      }),
    ).toBe("cursor")
  })
})
