import { describe, expect, it } from "vitest"
import { getEffectiveTrayLines } from "@/lib/tray-line-selection"

describe("getEffectiveTrayLines", () => {
  const base: Parameters<typeof getEffectiveTrayLines>[1] = {
    order: ["a"],
    disabled: [],
    trayLines: {},
  }

  it("when key missing uses first primary candidate", () => {
    expect(
      getEffectiveTrayLines("codex", { ...base, trayLines: {} }, [
        "Session",
        "Weekly",
      ])
    ).toEqual(["Session"])
  })

  it("when trayLines key omitted uses first primary", () => {
    expect(
      getEffectiveTrayLines(
        "codex",
        { order: ["codex"], disabled: [] },
        ["Session"]
      )
    ).toEqual(["Session"])
  })

  it("when primaryCandidates empty returns empty", () => {
    expect(getEffectiveTrayLines("x", base, [])).toEqual([])
  })

  it("when raw is __NONE__ sentinel returns empty", () => {
    expect(
      getEffectiveTrayLines(
        "codex",
        {
          ...base,
          trayLines: { codex: ["__NONE__"] },
        },
        ["Session"]
      )
    ).toEqual([])
  })

  it("strips __NONE__ when mixed with real labels", () => {
    expect(
      getEffectiveTrayLines(
        "cursor",
        {
          ...base,
          trayLines: { cursor: ["__NONE__", "Credits"] },
        },
        ["Credits", "Total usage"]
      )
    ).toEqual(["Credits"])
  })

  it("returns explicit selection", () => {
    expect(
      getEffectiveTrayLines(
        "codex",
        {
          ...base,
          trayLines: { codex: ["Weekly", "Session"] },
        },
        ["Session", "Weekly"]
      )
    ).toEqual(["Weekly", "Session"])
  })
})
