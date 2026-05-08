import { renderHook, act } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useSystemDarkMode } from "@/hooks/use-system-dark-mode"

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  }))

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMedia,
  })

  return {
    setMatches(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener())
    },
  }
}

describe("useSystemDarkMode", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("reads the OS color scheme instead of the html dark class", () => {
    installMatchMedia(false)
    document.documentElement.classList.add("dark")
    const { result } = renderHook(() => useSystemDarkMode())
    expect(result.current).toBe(false)
  })

  it("updates when the OS color scheme changes", async () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useSystemDarkMode())
    expect(result.current).toBe(false)

    await act(async () => {
      media.setMatches(true)
    })

    expect(result.current).toBe(true)
  })
})
