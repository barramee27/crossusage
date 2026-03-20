import { Image } from "@tauri-apps/api/image"
import type { MenubarIconStyle } from "@/lib/settings"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"

export type TrayGridCell = {
  text: string
}

const BARS_TRACK_OPACITY = 0.16
const BARS_REMAINDER_OPACITY = 0.24
const BARS_FILL_OPACITY = 1

function rgbaToImageDataBytes(rgba: Uint8ClampedArray): Uint8Array {
  // Image.new expects Uint8Array. Uint8ClampedArray shares the same buffer layout.
  return new Uint8Array(rgba.buffer)
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function makeRoundedBarPath(args: {
  x: number
  y: number
  w: number
  h: number
  leftRadius: number
  rightRadius: number
}): string {
  const { x, y, w, h } = args
  const leftRadius = Math.max(0, Math.min(args.leftRadius, h / 2, w / 2))
  const rightRadius = Math.max(0, Math.min(args.rightRadius, h / 2, w / 2))
  const x1 = x + w
  const y1 = y + h
  return [
    `M ${x + leftRadius} ${y}`,
    `L ${x1 - rightRadius} ${y}`,
    `A ${rightRadius} ${rightRadius} 0 0 1 ${x1} ${y + rightRadius}`,
    `L ${x1} ${y1 - rightRadius}`,
    `A ${rightRadius} ${rightRadius} 0 0 1 ${x1 - rightRadius} ${y1}`,
    `L ${x + leftRadius} ${y1}`,
    `A ${leftRadius} ${leftRadius} 0 0 1 ${x} ${y1 - leftRadius}`,
    `L ${x} ${y + leftRadius}`,
    `A ${leftRadius} ${leftRadius} 0 0 1 ${x + leftRadius} ${y}`,
    "Z",
  ].join(" ")
}

function getMinVisibleRemainderPx(trackW: number): number {
  // Keep remainder clearly visible after tray downsampling.
  return Math.max(4, Math.round(trackW * 0.2))
}

function getVisualBarFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  const clamped = Math.max(0, Math.min(1, fraction))
  if (clamped > 0.7 && clamped < 1) {
    // Quantize high-end bars by remainder in 15% steps so near-full values
    // still leave a meaningful visible tail.
    const remainder = 1 - clamped
    const quantizedRemainder = Math.min(1, Math.ceil(remainder / 0.15) * 0.15)
    return Math.max(0, 1 - quantizedRemainder)
  }
  return clamped
}

export function getBarFillLayout(trackW: number, fraction: number): {
  fillW: number
  remainderDrawW: number
  dividerX: number | null
} {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return { fillW: 0, remainderDrawW: 0, dividerX: null }
  }

  const visual = getVisualBarFraction(fraction)
  if (visual >= 1) {
    return { fillW: trackW, remainderDrawW: 0, dividerX: null }
  }

  const minVisibleRemainderPx = getMinVisibleRemainderPx(trackW)
  const maxFillW = Math.max(1, trackW - minVisibleRemainderPx)
  const fillW = Math.max(1, Math.min(maxFillW, Math.round(trackW * visual)))
  const trueRemainderW = trackW - fillW
  const remainderDrawW = Math.min(trackW - 1, Math.max(trueRemainderW, minVisibleRemainderPx))
  const dividerX = trackW - remainderDrawW
  return { fillW, remainderDrawW, dividerX }
}

function normalizePercentText(percentText: string | undefined): string | undefined {
  if (typeof percentText !== "string") return undefined
  const trimmed = percentText.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function estimateTextWidthPx(text: string, fontSize: number): number {
  // Empirical estimate for SF Pro bold numeric glyphs in tray-sized icons.
  return Math.ceil(text.length * fontSize * 0.62 + fontSize * 0.2)
}

function getSvgLayout(args: {
  sizePx: number
  style?: MenubarIconStyle
  percentText?: string
  gridCells?: TrayGridCell[]
  hideIcon?: boolean
}): {
  width: number
  height: number
  pad: number
  gap: number
  barsX: number
  barsWidth: number
  iconSize: number
  texts: { x: number; y: number; text: string; fontSize: number }[]
} {
  const { sizePx, style = "provider", percentText, gridCells = [], hideIcon = false } = args
  const hasPercentText = typeof percentText === "string" && percentText.length > 0
  const verticalNudgePx = 1
  const pad = Math.max(1, Math.round(sizePx * 0.08)) // ~2px at 24–36px
  const gap = Math.max(1, Math.round(sizePx * 0.03)) // ~1px at 36px

  const height = sizePx
  const barsX = pad
  const barsWidth = sizePx - 2 * pad
  const iconSize = Math.max(6, Math.round(sizePx - 2 * pad * 0.5))

  if (style === "donut") {
    const donutGap = Math.max(1, Math.round(sizePx * 0.06))
    return {
      width: sizePx + donutGap + sizePx,
      height,
      pad,
      gap,
      barsX,
      barsWidth,
      iconSize,
      texts: [],
    }
  }

  const cellsToRender = [...gridCells]
  if (cellsToRender.length === 0 && hasPercentText) {
    cellsToRender.push({ text: percentText! })
  }

  if (cellsToRender.length === 0) {
    return {
      width: sizePx,
      height,
      pad,
      gap,
      barsX,
      barsWidth,
      iconSize,
      texts: [],
    }
  }

  const visibleCells = cellsToRender.slice(0, 4)
  const numItems = visibleCells.length
  const useTwoCols = numItems > 2
  const numRows = numItems > 1 ? 2 : 1

  const fontSize = numRows === 1 ? Math.max(9, Math.round(sizePx * 0.68)) : Math.max(8, Math.round(sizePx * 0.55))
  const textGap = Math.max(2, Math.round(sizePx * 0.08))
  const startX = hideIcon ? pad : sizePx + textGap

  const texts: { x: number; y: number; text: string; fontSize: number }[] = []

  let col1Width = 0
  let col2Width = 0

  for (let i = 0; i < visibleCells.length; i++) {
    const w = estimateTextWidthPx(visibleCells[i].text, fontSize)
    if (useTwoCols && i >= 2) {
      col2Width = Math.max(col2Width, w)
    } else {
      col1Width = Math.max(col1Width, w)
    }
  }

  const colGapPx = useTwoCols ? Math.max(6, Math.round(sizePx * 0.3)) : 0

  for (let i = 0; i < visibleCells.length; i++) {
    const isCol2 = useTwoCols && i >= 2
    const isRow2 = i % 2 === 1

    let textX = startX
    if (isCol2) {
      textX = startX + col1Width + colGapPx
    }

    let textY = Math.round(sizePx / 2) + 1 + (numRows === 1 ? verticalNudgePx : 0)
    if (numRows === 2) {
      if (!isRow2) {
        textY = Math.round(sizePx * 0.26) + 1
      } else {
        textY = Math.round(sizePx * 0.78) + 1
      }
    }

    texts.push({
      x: textX,
      y: textY,
      text: visibleCells[i].text,
      fontSize
    })
  }

  if (useTwoCols) {
    texts.push({
      x: startX + col1Width + Math.floor(colGapPx / 2),
      y: Math.round(sizePx / 2) + 1,
      text: "|",
      fontSize: Math.max(10, Math.round(sizePx * 0.7))
    })
  }

  const totalTextWidth = col1Width + (useTwoCols ? colGapPx + col2Width : 0)
  const rightPad = pad

  return {
    width: Math.round(startX + totalTextWidth + rightPad),
    height,
    pad,
    gap,
    barsX,
    barsWidth,
    iconSize,
    texts,
  }
}

export function makeTrayBarsSvg(args: {
  bars?: TrayPrimaryBar[]
  sizePx: number
  style?: MenubarIconStyle
  percentText?: string
  providerIconUrl?: string
  gridCells?: TrayGridCell[]
  hideIcon?: boolean
}): string {
  const { bars = [], sizePx, style = "provider", percentText, providerIconUrl, gridCells = [], hideIcon = false } = args
  const barsForStyle = style === "bars" ? bars : bars.slice(0, 1)
  const n = Math.max(1, Math.min(4, barsForStyle.length || 1))
  const text = normalizePercentText(percentText)
  
  const layout = getSvgLayout({
    sizePx,
    style,
    percentText: text,
    gridCells,
    hideIcon,
  })

  const width = layout.width
  const height = layout.height
  const trackW = layout.barsWidth

  const parts: string[] = []
  parts.push(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  )

  if (style === "provider") {
    // handled below
  } else if (style === "donut") {
    const cx = layout.pad + layout.barsWidth / 2
    const cy = height / 2
    const radius = Math.max(2, layout.barsWidth / 2 - 1)
    const strokeW = Math.max(1.5, Math.round(layout.barsWidth * 0.15))
    
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="black" stroke-width="${strokeW}" opacity="${BARS_TRACK_OPACITY}" shape-rendering="geometricPrecision" />`
    )

    const fraction = barsForStyle[0]?.items?.[0]?.fraction
    if (typeof fraction === "number" && Number.isFinite(fraction) && fraction > 0) {
      const visual = getVisualBarFraction(fraction)
      const circumference = 2 * Math.PI * radius
      const dasharray = `${circumference * visual} ${circumference}`
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="black" stroke-width="${strokeW}" stroke-dasharray="${dasharray}" stroke-dashoffset="${circumference / 4}" stroke-linecap="round" opacity="${BARS_FILL_OPACITY}" shape-rendering="geometricPrecision" transform="rotate(-90 ${cx} ${cy})" />`
      )
    }
  } else {
    // style === "bars"
    const trackOpacity = BARS_TRACK_OPACITY
    const remainderOpacity = BARS_REMAINDER_OPACITY
    const fillOpacity = BARS_FILL_OPACITY

    const layoutN = Math.max(2, n)
    const trackH = Math.max(
      1,
      Math.floor((height - 2 * layout.pad - (layoutN - 1) * layout.gap) / layoutN)
    )
    const rx = Math.max(1, Math.floor(trackH / 3))

    const totalBarsHeight = n * trackH + (n - 1) * layout.gap
    const availableHeight = height - 2 * layout.pad
    const yOffset = layout.pad + Math.floor((availableHeight - totalBarsHeight) / 2)

    for (let i = 0; i < n; i += 1) {
      const bar = barsForStyle[i]
      const y = yOffset + i * (trackH + layout.gap) + 1
      const x = layout.barsX

      parts.push(
        `<rect x="${x}" y="${y}" width="${trackW}" height="${trackH}" rx="${rx}" fill="black" opacity="${trackOpacity}" />`
      )

      const fraction = bar?.items?.[0]?.fraction
      if (typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0) {
        const { fillW, remainderDrawW, dividerX } = getBarFillLayout(trackW, fraction)
        if (fillW > 0) {
          const movingEdgeRadius = Math.max(0, Math.floor(rx * 0.35))
          if (fillW >= trackW) {
            parts.push(
              `<rect x="${x}" y="${y}" width="${fillW}" height="${trackH}" rx="${rx}" fill="black" opacity="${fillOpacity}" />`
            )
          } else {
            const fillPath = makeRoundedBarPath({
              x,
              y,
              w: fillW,
              h: trackH,
              leftRadius: rx,
              rightRadius: movingEdgeRadius,
            })
            parts.push(`<path d="${fillPath}" fill="black" opacity="${fillOpacity}" />`)
          }
        }

        if (fillW > 0 && remainderDrawW > 0 && dividerX !== null) {
          const remainderX = x + dividerX
          const remainderPath = makeRoundedBarPath({
            x: remainderX,
            y,
            w: remainderDrawW,
            h: trackH,
            leftRadius: Math.max(0, Math.floor(rx * 0.2)),
            rightRadius: rx,
          })
          parts.push(`<path d="${remainderPath}" fill="black" opacity="${remainderOpacity}" />`)
        }
      }
    }
  }

  const x = layout.barsX
  const y = Math.round((height - layout.iconSize) / 2) + 1
  const href = typeof providerIconUrl === "string" ? providerIconUrl.trim() : ""

  if (!hideIcon && style !== "bars") {
    if (href.length > 0) {
      parts.push(
        `<image x="${x}" y="${y}" width="${layout.iconSize}" height="${layout.iconSize}" href="${escapeXmlText(href)}" preserveAspectRatio="xMidYMid meet" />`
      )
    } else {
      const cx = x + layout.iconSize / 2
      const cy = y + layout.iconSize / 2
      const radius = Math.max(2, layout.iconSize / 2 - 1.5)
      const strokeW = Math.max(1.5, Math.round(layout.iconSize * 0.14))
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="black" stroke-width="${strokeW}" opacity="1" shape-rendering="geometricPrecision" />`
      )
    }
  }

  for (const { x: tX, y: tY, text, fontSize } of layout.texts) {
    const anchor = text === "|" ? "middle" : "start"
    const opacity = text === "|" ? "0.3" : "1"
    parts.push(
      `<text x="${tX}" y="${tY}" fill="black" opacity="${opacity}" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="${anchor}" dominant-baseline="middle">${escapeXmlText(text)}</text>`
    )
  }

  parts.push(`</svg>`)
  return parts.join("")
}
async function rasterizeSvgToRgba(svg: string, widthPx: number, heightPx: number): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)
  try {
    const img = new window.Image()
    img.decoding = "async"

    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("Failed to load SVG into image"))
    })

    img.src = url
    await loaded

    const canvas = document.createElement("canvas")
    canvas.width = widthPx
    canvas.height = heightPx

    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D context missing")

    // Clear to transparent; template icons use alpha as mask.
    ctx.clearRect(0, 0, widthPx, heightPx)
    ctx.drawImage(img, 0, 0, widthPx, heightPx)

    const imageData = ctx.getImageData(0, 0, widthPx, heightPx)
    return rgbaToImageDataBytes(imageData.data)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function renderTrayBarsIcon(args: {
  bars?: TrayPrimaryBar[]
  sizePx: number
  style?: MenubarIconStyle
  percentText?: string
  providerIconUrl?: string
  gridCells?: TrayGridCell[]
  hideIcon?: boolean
}): Promise<Image> {
  const { bars = [], sizePx, style = "provider", percentText, providerIconUrl, gridCells = [], hideIcon = false } = args
  const text = normalizePercentText(percentText)
  const svg = makeTrayBarsSvg({
    bars,
    sizePx,
    style,
    percentText: text,
    providerIconUrl,
    gridCells,
    hideIcon,
  })
  const layout = getSvgLayout({
    sizePx,
    style,
    percentText: text,
  })
  const rgba = await rasterizeSvgToRgba(svg, layout.width, layout.height)
  return await Image.new(rgba, layout.width, layout.height)
}

export function getTrayIconSizePx(devicePixelRatio: number | undefined): number {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1
  // 18pt-ish slot -> render at 18px * dpr for crispness (36px on Retina).
  return Math.max(18, Math.round(18 * dpr))
}
