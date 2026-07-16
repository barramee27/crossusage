import { describe, expect, it } from "vitest"
import type { PluginOutput } from "@/lib/plugin-types"
import {
  aggregateTotalSpend,
  formatTotalSpendCenter,
  metricFromStored,
  metricToStored,
  parseDollarsFromValue,
  parseTokensFromValue,
  projectTotalSpend,
  spendCapableProviders,
  type TotalSpendProvider,
} from "@/lib/total-spend"

const claude: TotalSpendProvider = { id: "claude", displayName: "Claude", brandColor: "#DE7356" }
const codex: TotalSpendProvider = { id: "codex", displayName: "Codex", brandColor: "#10A37F" }
const cursor: TotalSpendProvider = { id: "cursor", displayName: "Cursor" }

function output(lines: PluginOutput["lines"]): PluginOutput {
  return {
    providerId: "x",
    displayName: "X",
    lines,
    iconUrl: "",
  }
}

describe("total-spend parsing", () => {
  it("parses dollars and tokens from value strings", () => {
    expect(parseDollarsFromValue("$2.50 · 100K tokens")).toBe(2.5)
    expect(parseTokensFromValue("$2.50 · 100K tokens")).toBe(100_000)
    expect(parseTokensFromValue("1.2M tokens")).toBe(1_200_000)
    expect(parseDollarsFromValue("no money")).toBe(0)
  })

  it("round-trips stored metric keys", () => {
    expect(metricFromStored("apiSpend")).toBe("cost")
    expect(metricFromStored("costPerMtok")).toBe("costPerMtok")
    expect(metricToStored("cost")).toBe("apiSpend")
  })
})

describe("aggregateTotalSpend", () => {
  it("sums dollars and tokens across providers from modelBreakdown", () => {
    const outputs = {
      claude: output([
        {
          type: "text",
          label: "Today",
          value: "$2.50 · 100K tokens",
          subtitle: "Estimated",
          modelBreakdown: [
            { model: "opus", tokens: 100_000, costUsd: 2.5, percent: 100 },
          ],
        },
      ]),
      cursor: output([
        {
          type: "text",
          label: "Today",
          value: "$7.25 · 500K tokens",
          modelBreakdown: [
            { model: "auto", tokens: 500_000, costUsd: 7.25, percent: 100 },
          ],
        },
      ]),
      codex: output([{ type: "text", label: "Session", value: "40%" }]),
    }

    const total = aggregateTotalSpend({
      period: "Today",
      providers: [claude, codex, cursor],
      outputs,
    })

    expect(total.slices.map((s) => s.provider.id).sort()).toEqual(["claude", "cursor"])
    expect(total.slices.reduce((n, s) => n + s.amountUSD, 0)).toBeCloseTo(9.75)
    expect(total.slices.reduce((n, s) => n + s.tokenCount, 0)).toBe(600_000)

    const spend = projectTotalSpend(total, "cost")
    expect(spend.slices.map((s) => s.provider.id)).toEqual(["cursor", "claude"])
    expect(spend.centerValue).toBeCloseTo(9.75)
    expect(spend.isEstimated).toBe(true)
  })

  it("excludes providers without the period line", () => {
    const outputs = {
      claude: output([
        {
          type: "text",
          label: "Today",
          value: "$1.00",
          modelBreakdown: [{ model: "a", tokens: 1, costUsd: 1, percent: 100 }],
        },
      ]),
      codex: output([
        {
          type: "text",
          label: "Yesterday",
          value: "$3.00",
          modelBreakdown: [{ model: "b", tokens: 1, costUsd: 3, percent: 100 }],
        },
      ]),
    }
    const total = aggregateTotalSpend({
      period: "Today",
      providers: [claude, codex],
      outputs,
    })
    expect(total.slices.map((s) => s.provider.id)).toEqual(["claude"])
  })

  it("falls back to parsing $X.XX from value when breakdown lacks cost", () => {
    const outputs = {
      claude: output([
        {
          type: "text",
          label: "Today",
          value: "$4.00 · 50K tokens",
        },
      ]),
    }
    const total = aggregateTotalSpend({
      period: "Today",
      providers: [claude],
      outputs,
    })
    expect(total.slices[0]?.amountUSD).toBe(4)
    expect(total.slices[0]?.tokenCount).toBe(50_000)
  })

  it("projects costPerMtok by rate and blends the center", () => {
    const outputs = {
      claude: output([
        {
          type: "text",
          label: "Today",
          value: "$10",
          modelBreakdown: [{ model: "a", tokens: 1_000_000, costUsd: 10, percent: 100 }],
        },
      ]),
      cursor: output([
        {
          type: "text",
          label: "Today",
          value: "$30",
          modelBreakdown: [{ model: "b", tokens: 1_000_000, costUsd: 30, percent: 100 }],
        },
      ]),
    }
    const total = aggregateTotalSpend({
      period: "Today",
      providers: [claude, cursor],
      outputs,
    })
    const rates = projectTotalSpend(total, "costPerMtok")
    expect(rates.slices.map((s) => s.provider.id)).toEqual(["cursor", "claude"])
    expect(rates.centerValue).toBeCloseTo(20)
  })

  it("tokens projection ignores dollars and estimate flag", () => {
    const outputs = {
      claude: output([
        {
          type: "text",
          label: "Today",
          value: "$50 · Estimated",
          modelBreakdown: [{ model: "a", tokens: 100_000, costUsd: 50, percent: 100 }],
        },
      ]),
      cursor: output([
        {
          type: "text",
          label: "Today",
          value: "$1",
          modelBreakdown: [{ model: "b", tokens: 900_000, costUsd: 1, percent: 100 }],
        },
      ]),
    }
    const tokens = projectTotalSpend(
      aggregateTotalSpend({ period: "Today", providers: [claude, cursor], outputs }),
      "tokens",
    )
    expect(tokens.slices.map((s) => s.provider.id)).toEqual(["cursor", "claude"])
    expect(tokens.centerValue).toBe(1_000_000)
    expect(tokens.isEstimated).toBe(false)
  })

  it("marks spend-capable providers that have period tiles", () => {
    const outputs = {
      claude: output([
        {
          type: "text",
          label: "Today",
          value: "$0.00 · 0 tokens",
          modelBreakdown: [],
        },
      ]),
      codex: output([{ type: "badge", label: "Status", text: "ok" }]),
    }
    const capable = spendCapableProviders([claude, codex], outputs)
    expect(capable.map((p) => p.id)).toEqual(["claude"])
  })
})

describe("formatTotalSpendCenter", () => {
  it("formats cost and tokens", () => {
    expect(formatTotalSpendCenter(9.75, "cost")).toEqual({ primary: "$9.75", unit: "total" })
    expect(formatTotalSpendCenter(1_200_000, "tokens").unit).toBe("tokens")
  })
})
