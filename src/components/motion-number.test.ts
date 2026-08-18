import { describe, expect, it } from "vitest"
import { splitMetricText } from "@/components/motion-number"

describe("splitMetricText", () => {
  it("splits percents and money", () => {
    expect(splitMetricText("12.5%")).toEqual({
      prefix: "",
      n: 12.5,
      decimals: 1,
      suffix: "%",
    })
    expect(splitMetricText("$3.20")).toEqual({
      prefix: "$",
      n: 3.2,
      decimals: 2,
      suffix: "",
    })
  })

  it("returns null when there is no number", () => {
    expect(splitMetricText("No usage data")).toBeNull()
  })
})
