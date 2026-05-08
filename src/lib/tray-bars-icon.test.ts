import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/image", () => ({
  Image: {
    new: vi.fn(async () => ({})),
  },
}))

import {
  getTrayForegroundHex,
  makeTrayBarsSvg,
  renderTrayBarsIcon,
} from "@/lib/tray-bars-icon"

describe("tray-bars-icon", () => {
  it("getTrayForegroundHex matches app dark class semantics", () => {
    expect(getTrayForegroundHex(false)).toBe("#000000")
    expect(getTrayForegroundHex(true)).toBe("#ffffff")
  })

  it("default style is provider", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
    })
    expect(svg).toContain("<circle ")
    expect(svg).not.toContain("<rect ")
  })

  it("style=provider renders image and no bars", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).toContain("<image ")
    expect(svg).not.toContain("<rect ")
    expect(svg).not.toContain("<path ")
  })

  it("style=bars uses foregroundHex for fills", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", items: [{ label: "a", fraction: 0.5 }] }],
      sizePx: 36,
      style: "bars",
      foregroundHex: "#ffffff",
    })
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).not.toContain('fill="black"')
  })

  it("style=bars renders bar SVG elements and no image", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", items: [{ label: "a", fraction: 0.5 }] }],
      sizePx: 36,
      style: "bars",
    })
    expect(svg).toContain("<rect ")
    expect(svg).toContain("<path ")
    expect(svg).not.toContain("<image ")
  })

  it("style=bars with empty bars renders a single empty track", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "bars",
    })
    expect(svg).toContain("<rect ")
    expect(svg).not.toContain("<path ")
    expect(svg).not.toContain("<image ")
  })

  it("style=bars with high-end quantized fraction (0.95) renders bars (rect and path)", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", items: [{ label: "a", fraction: 0.95 }] }],
      sizePx: 36,
      style: "bars",
    })
    expect(svg).toContain("<rect ")
    expect(svg).toContain("<path ")
    expect(svg).not.toContain("<image ")
  })

  it("style=donut renders the provider logo as a clipped pie", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", items: [{ label: "a", fraction: 0.42 }] }],
      sizePx: 36,
      style: "donut",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).toContain('clipPath id="tray-logo-pie"')
    expect(svg).toContain("<image ")
    expect(svg).toContain("<path ")
    expect(svg).not.toContain('stroke-dasharray="')
    expect(svg).not.toContain("<rect ")
  })

  it("style=donut falls back to a clipped glyph when provider icon is missing", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", items: [{ label: "a", fraction: 0.42 }] }],
      sizePx: 36,
      style: "donut",
    })
    expect(svg).toContain('clipPath id="tray-logo-pie"')
    expect(svg).toContain("<circle ")
    expect(svg).not.toContain("<image ")
    expect(svg).not.toContain("<rect ")
  })

  it("style=logoBar uses a clipped provider logo as the progress fill", () => {
    const icon = encodeURIComponent(
      '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z" fill="currentColor"/></svg>'
    )
    const svg = makeTrayBarsSvg({
      bars: [{ id: "cursor", items: [{ label: "Credits", fraction: 0.75 }] }],
      sizePx: 30,
      style: "logoBar",
      providerIconUrl: `data:image/svg+xml,${icon}`,
      foregroundHex: "#ffffff",
    })
    expect(svg).toContain('clipPath id="tray-logo-fill"')
    expect(svg).toContain('<rect x="2" y="8" width="26" height="20" />')
    expect(svg).toContain('opacity="0.18"')
    expect(svg).toContain('fill="currentColor"')
  })

  it("style=logoGrid renders multiple provider logos with independent clips", () => {
    const svg = makeTrayBarsSvg({
      bars: [
        { id: "cursor", items: [{ label: "Credits", fraction: 0.75 }] },
        { id: "claude", items: [{ label: "Session", fraction: 0.2 }] },
      ],
      sizePx: 30,
      style: "logoGrid",
      providerIcons: [
        { id: "cursor", iconUrl: "data:image/svg+xml;base64,CURSOR" },
        { id: "claude", iconUrl: "data:image/svg+xml;base64,CLAUDE" },
      ],
    })
    expect(svg).toContain('clipPath id="tray-logo-grid-fill-0"')
    expect(svg).toContain('clipPath id="tray-logo-grid-fill-1"')
    expect(svg).toContain('href="data:image/svg+xml;base64,CURSOR"')
    expect(svg).toContain('href="data:image/svg+xml;base64,CLAUDE"')
    expect(svg).not.toContain('stroke-dasharray="')
  })

  it("renders provider icon", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })

    expect(svg).toContain("<image ")
    expect(svg).toContain('href="data:image/svg+xml;base64,ABC"')
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(viewBox).toBeTruthy()
    if (viewBox) {
      const width = Number(viewBox[1])
      const height = Number(viewBox[2])
      expect(width).toBe(height)
    }
  })

  it("falls back to circle glyph when provider icon is missing", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
    })
    expect(svg).not.toContain("<image ")
    expect(svg).toContain("<circle ")
  })

  it("never renders svg text", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 18,
    })
    expect(svg).not.toContain("<text ")
  })

  it("keeps non-zero size when icon is hidden and no text is rendered", () => {
    const svg = makeTrayBarsSvg({
      sizePx: 18,
      hideIcon: true,
      gridCells: [],
    })
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(viewBox).toBeTruthy()
    if (viewBox) {
      expect(Number(viewBox[1])).toBe(18)
      expect(Number(viewBox[2])).toBe(18)
    }
  })

  it("renders svg text when percentage is provided", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 18,
      gridCells: [{ text: "70%" }],
    })
    expect(svg).toContain(">70%</text>")
    expect(svg).toContain('paint-order="stroke fill"')
  })

  it("inlines currentColor svg provider icons so tray ink controls their color", () => {
    const icon = encodeURIComponent(
      '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z" fill="currentColor"/></svg>'
    )
    const svg = makeTrayBarsSvg({
      sizePx: 30,
      style: "provider",
      providerIconUrl: `data:image/svg+xml,${icon}`,
      foregroundHex: "#ffffff",
      gridCells: [{ text: "76%" }],
    })
    expect(svg).toContain('<svg x="')
    expect(svg).toContain('color="#ffffff"')
    expect(svg).toContain('fill="currentColor"')
    expect(svg).not.toContain("<image ")
  })

  it("renders at most four grid cells in bars mode", () => {
    const svg = makeTrayBarsSvg({
      sizePx: 18,
      style: "bars",
      gridCells: [
        { text: "A" },
        { text: "B" },
        { text: "C" },
        { text: "D" },
        { text: "E" },
      ],
    })
    expect(svg).toContain(">A</text>")
    expect(svg).toContain(">D</text>")
    expect(svg).not.toContain(">E</text>")
  })

  it("provider style renders a square stacked layout (icon over text) so trays can't squash it", () => {
    const svg = makeTrayBarsSvg({
      sizePx: 30,
      style: "provider",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      gridCells: [{ text: "76%" }],
    })
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(viewBox).toBeTruthy()
    if (viewBox) {
      expect(Number(viewBox[1])).toBe(Number(viewBox[2]))
    }
    expect(svg).toContain(">76%</text>")
    expect(svg).toContain('text-anchor="middle"')
  })

  it("renderTrayBarsIcon rasterizes SVG to an Image using canvas", async () => {
    const originalImage = window.Image
    const originalCreateElement = document.createElement.bind(document)

    // Stub Image loader to immediately fire onload once src is set.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).Image = class MockImage {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      decoding = "async"
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    // Stub canvas context
    const ctx = {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    }

    // Patch createElement for canvas only
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(document as any).createElement = (tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === "canvas") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(el as any).getContext = () => ctx
      }
      return el
    }

    try {
      const img = await renderTrayBarsIcon({
        bars: [],
        sizePx: 18,
      })
      expect(img).toBeTruthy()
    } finally {
      window.Image = originalImage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(document as any).createElement = originalCreateElement
    }
  })
})
