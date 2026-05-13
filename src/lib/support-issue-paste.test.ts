import { describe, expect, it } from "vitest"
import { formatLogTailClipboard } from "@/lib/support-issue-paste"

describe("formatLogTailClipboard", () => {
  it("prepends diagnostics header and log tail", () => {
    const out = formatLogTailClipboard({
      appVersion: "1.0.0",
      os: "linux",
      arch: "x86_64",
      logLevel: "info",
      providerInstanceSlotCount: 2,
      enabledProviderInstanceIds: ["cursor", "claude"],
      runtime: { distro: "Pop", kernel: "6.1" },
      logTailRedacted: "line1\nline2",
    })
    expect(out).toContain("--- CrossUsage diagnostics")
    expect(out).toContain("build: CrossUsage 1.0.0 | linux | x86_64")
    expect(out).toContain("runtime: Pop | 6.1")
    expect(out).toContain("logLevel: info")
    expect(out).toContain("providerAccountSlots: 2")
    expect(out).toContain("enabledProviderInstances: cursor, claude")
    expect(out).toContain("--- redacted log tail")
    expect(out.endsWith("line2")).toBe(true)
    expect(out).toContain("line1")
  })

  it("handles missing or empty tail", () => {
    const empty = formatLogTailClipboard({})
    expect(empty).toContain("(no redacted log tail available)")
    expect(empty).toContain("--- CrossUsage diagnostics")

    expect(formatLogTailClipboard({ logTailRedacted: "   " })).toContain(
      "(no redacted log tail available)"
    )
  })
})
