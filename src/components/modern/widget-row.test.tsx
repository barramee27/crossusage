import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WidgetRow } from "@/components/modern/widget-row"
import type { WidgetData } from "@/lib/widget-data"

function meter(over: Partial<WidgetData> = {}): WidgetData {
  return {
    metricId: "p:session",
    label: "Session",
    displayName: "Test",
    kind: "progress",
    bounded: true,
    used: 90,
    limit: 100,
    resetsAt: null,
    periodDurationMs: null,
    textValue: "90% used",
    textSecondary: null,
    paceStatus: "behind",
    paceDetail: null,
    isLimitReached: false,
    ...over,
  }
}

describe("WidgetRow", () => {
  it("keeps Modern meters static (no bar sheen or sparks)", () => {
    const { container } = render(<WidgetRow data={meter()} />)
    expect(container.querySelector(".motion-bar-fill")).toBeNull()
    expect(container.querySelector(".motion-sparks")).toBeNull()
    expect(container.querySelector(".motion-bar-hot")).toBeNull()
  })
})
