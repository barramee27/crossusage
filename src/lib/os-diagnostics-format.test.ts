import { describe, expect, it } from "vitest"
import { formatOsDiagnosticsLine } from "@/lib/os-diagnostics-format"

describe("formatOsDiagnosticsLine", () => {
  it("formats Linux with distro and kernel", () => {
    const s = formatOsDiagnosticsLine({
      family: "linux",
      arch: "x86_64",
      distro: "Pop!_OS 22.04",
      kernel: "6.12.7-generic",
    })
    expect(s).toBe("OS: Pop!_OS 22.04 · kernel 6.12.7-generic · x86_64")
  })

  it("falls back when distro missing on Linux", () => {
    const s = formatOsDiagnosticsLine({
      family: "linux",
      arch: "aarch64",
      distro: null,
      kernel: "6.1.0",
    })
    expect(s).toBe("OS: Linux · kernel 6.1.0 · aarch64")
  })
})
