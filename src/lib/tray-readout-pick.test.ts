import { describe, expect, it } from "vitest"

import {
  defaultTrayReadoutLine,
  defaultTrayReadoutPluginId,
  shouldOpenTrayReadoutDialog,
  trayReadoutLabelsFromManifest,
} from "@/lib/tray-readout-pick"

const antigravity = {
  id: "antigravity",
  name: "Antigravity",
  enabled: true,
  trayReadoutLabels: ["Session", "Weekly"],
  trayLines: ["Session"],
}

const claude = {
  id: "claude",
  name: "Claude",
  enabled: true,
  trayReadoutLabels: ["Session"],
  trayLines: ["Session"],
}

describe("trayReadoutLabelsFromManifest", () => {
  it("keeps plugin.json progress lines in file order and skips text/charts", () => {
    expect(
      trayReadoutLabelsFromManifest([
        { type: "progress", label: "Credits", scope: "overview" },
        { type: "progress", label: "Total usage", scope: "overview" },
        { type: "progress", label: "Cursor Models", scope: "detail" },
        { type: "text", label: "Today", scope: "detail" },
        { type: "barChart", label: "Usage Trend", scope: "detail" },
        { type: "progress", label: "On-demand", scope: "detail" },
      ]),
    ).toEqual(["Credits", "Total usage", "Cursor Models", "On-demand"])
  })
})

describe("shouldOpenTrayReadoutDialog", () => {
  it("skips battery bars", () => {
    expect(shouldOpenTrayReadoutDialog("bars", [antigravity, claude])).toBe(false)
  })

  it("skips a single plugin with one meter", () => {
    expect(shouldOpenTrayReadoutDialog("donut", [claude])).toBe(false)
  })

  it("opens for one plugin with several meters", () => {
    expect(shouldOpenTrayReadoutDialog("donut", [antigravity])).toBe(true)
  })

  it("opens when several plugins can drive the icon", () => {
    expect(shouldOpenTrayReadoutDialog("provider", [claude, antigravity])).toBe(true)
  })
})

describe("defaults", () => {
  it("prefers the current tray plugin when still enabled", () => {
    expect(defaultTrayReadoutPluginId([claude, antigravity], "antigravity")).toBe("antigravity")
  })

  it("uses the plugin's current tray line when it is still a candidate", () => {
    expect(defaultTrayReadoutLine({ ...antigravity, trayLines: ["Weekly"] })).toBe("Weekly")
  })
})
