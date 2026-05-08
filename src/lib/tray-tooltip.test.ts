import { describe, expect, it } from "vitest"
import { formatTrayItemCaption, formatTrayPercentText, formatTrayTooltip } from "./tray-tooltip"
import type { PluginMeta } from "./plugin-types"
import type { TrayPrimaryBar } from "./tray-primary-progress"

describe("tray-tooltip", () => {
  describe("formatTrayPercentText", () => {
    it("should format valid fractions", () => {
      expect(formatTrayPercentText(0.45)).toBe("45%")
      expect(formatTrayPercentText(0)).toBe("0%")
      expect(formatTrayPercentText(1)).toBe("100%")
    })

    it("should round fractions", () => {
      expect(formatTrayPercentText(0.456)).toBe("46%")
      expect(formatTrayPercentText(0.454)).toBe("45%")
    })

    it("should clamp fractions", () => {
      expect(formatTrayPercentText(-0.1)).toBe("0%")
      expect(formatTrayPercentText(1.1)).toBe("100%")
    })

    it("should handle undefined and NaN", () => {
      expect(formatTrayPercentText(undefined)).toBe("--%")
      expect(formatTrayPercentText(NaN)).toBe("--%")
    })
  })

  describe("formatTrayItemCaption", () => {
    it("formats dollar progress used/limit when usage mode is used", () => {
      expect(
        formatTrayItemCaption(
          { label: "Credits", fraction: 0.5, valueKind: "dollars", used: 5, limit: 20 },
          "used"
        )
      ).toBe("$5.00 / $20.00")
    })

    it("formats dollar progress as remaining when usage mode is left", () => {
      expect(
        formatTrayItemCaption(
          { label: "Credits", fraction: 0.5, valueKind: "dollars", used: 5, limit: 20 },
          "left"
        )
      ).toBe("$15.00 left")
    })
  })

  describe("formatTrayTooltip", () => {
    const mockMeta: PluginMeta[] = [
      { id: "p1", name: "Plugin 1", iconUrl: "", lines: [], links: [], primaryCandidates: [] },
      { id: "p2", name: "Plugin 2", iconUrl: "", lines: [], links: [], primaryCandidates: [] },
    ]

    it("formats dollar lines in tooltip when displayMode is used", () => {
      const bars: TrayPrimaryBar[] = [
        {
          id: "p1",
          items: [{ label: "Credits", fraction: 0.25, valueKind: "dollars", used: 2.5, limit: 10 }],
        },
      ]
      expect(formatTrayTooltip(bars, mockMeta, "used")).toBe("CrossUsage\nPlugin 1: $2.50 / $10.00")
    })

    it("should show app name when no bars", () => {
      expect(formatTrayTooltip([], mockMeta)).toBe("CrossUsage")
    })

    it("should list enabled plugins with percentages", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", items: [{ label: "Session", fraction: 0.45 }] },
        { id: "p2", items: [{ label: "Session", fraction: 0.12 }] },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("CrossUsage\nPlugin 1: 45%\nPlugin 2: 12%")
    })

    it("should handle missing plugin metadata gracefully", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", items: [{ label: "Session", fraction: 0.45 }] },
        { id: "unknown", items: [{ label: "Session", fraction: 0.5 }] },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("CrossUsage\nPlugin 1: 45%")
    })

    it("should show --% for missing fractions", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", items: [{ label: "Session", fraction: undefined }] },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("CrossUsage\nPlugin 1: --%")
    })

    it("should expand multiple primary lines per plugin", () => {
      const bars: TrayPrimaryBar[] = [
        {
          id: "p1",
          items: [
            { label: "A", fraction: 0.5 },
            { label: "B", fraction: 0.25 },
          ],
        },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("CrossUsage\nPlugin 1 · A: 50%\nPlugin 1 · B: 25%")
    })
  })
})
