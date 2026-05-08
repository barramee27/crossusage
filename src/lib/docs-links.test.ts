import { describe, expect, it } from "vitest"
import { multiAccountCredentialsGuideUrl } from "@/lib/docs-links"

describe("multiAccountCredentialsGuideUrl", () => {
  it("points at the fork repo blob path for the tutorial", () => {
    expect(multiAccountCredentialsGuideUrl()).toBe(
      "https://github.com/barramee27/crossusage/blob/HEAD/docs/providers/multi-account-credentials.md"
    )
  })
})
