import { describe, expect, it } from "vitest"
import { formatHistoryTightestMessage } from "@/lib/usage-history-insights"

describe("formatHistoryTightestMessage", () => {
  it("formats used and remaining from a saved snapshot row", () => {
    expect(
      formatHistoryTightestMessage({
        instanceId: "claude",
        displayName: "Claude",
        primaryPercent: 94.2,
        remainingPercent: 5.8,
        capturedAtMs: 1,
        resetTime: null,
      }),
    ).toBe("Claude — 94% used (6% left) · saved snapshot")
  })
})
