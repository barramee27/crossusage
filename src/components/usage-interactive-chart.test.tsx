import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { UsageInteractiveChart } from "@/components/usage-interactive-chart"

describe("UsageInteractiveChart bar mode", () => {
  it("renders grouped bars for multiple series on the same day keys", () => {
    const { container } = render(
      <UsageInteractiveChart
        mode="bar"
        defaultRange="all"
        rangeOptions={["all"]}
        series={[
          {
            id: "a",
            name: "Pro",
            color: "blue",
            points: [
              { key: "2026-06-20", label: "Jun 20", value: 10 },
              { key: "2026-06-21", label: "Jun 21", value: 20 },
            ],
          },
          {
            id: "b",
            name: "Nightly",
            color: "green",
            points: [
              { key: "2026-06-20", label: "Jun 20", value: 15 },
              { key: "2026-06-21", label: "Jun 21", value: 5 },
            ],
          },
        ]}
      />,
    )

    const rects = container.querySelectorAll("rect")
    expect(rects.length).toBe(4)
    const xs = [...rects].map((r) => Number(r.getAttribute("x")))
    const uniqueX = new Set(xs)
    expect(uniqueX.size).toBe(4)
  })
})
