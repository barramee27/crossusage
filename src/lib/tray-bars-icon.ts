import { Image } from "@tauri-apps/api/image"
import { getRelativeLuminance } from "@/lib/color"
import type { MenubarIconStyle } from "@/lib/settings"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"

export type TrayGridCell = {
  text: string
}

export type TrayProviderIcon = {
  id: string
  iconUrl?: string
  color?: string
}

const BARS_TRACK_OPACITY = 0.16
const BARS_REMAINDER_OPACITY = 0.24
const BARS_FILL_OPACITY = 1
const LOGO_REMAINDER_OPACITY = 0.18
const PROVIDER_ICON_TRAY_SCALE = 1.45

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

function decodeSvgDataUrl(url: string): string | null {
  const match = url.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,(.*)$/i)
  if (!match) return null

  const payload = match[2]
  try {
    if (match[1]) {
      if (typeof atob !== "function") return null
      return atob(payload)
    }
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

function inlineSvgImage(args: {
  svgText: string
  x: number
  y: number
  size: number
  color: string
}): string | null {
  const { svgText, x, y, size, color } = args
  const viewBox = svgText.match(/\bviewBox=(["'])(.*?)\1/i)?.[2] ?? "0 0 100 100"
  const body = svgText
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!doctype[\s\S]*?>/i, "")
    .match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)?.[1]

  if (!body) return null

  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${escapeXmlText(viewBox)}" color="${color}" fill="currentColor" preserveAspectRatio="xMidYMid meet">${body}</svg>`
}

function providerIconMarkup(args: {
  href: string
  x: number
  y: number
  size: number
  color: string
  opacity?: number
  clipPathId?: string
}): string {
  const { href, x, y, size, color, opacity = 1, clipPathId } = args
  const bleed = Math.max(0, Math.round((size * (PROVIDER_ICON_TRAY_SCALE - 1)) / 2))
  const drawX = x - bleed
  const drawY = y - bleed
  const drawSize = size + bleed * 2
  const svgText = href.length > 0 ? decodeSvgDataUrl(href) : null
  const inlineSvg =
    svgText && /currentColor/i.test(svgText)
      ? inlineSvgImage({ svgText, x: drawX, y: drawY, size: drawSize, color })
      : null
  const content = inlineSvg
    ? inlineSvg
    : href.length > 0
      ? `<image x="${drawX}" y="${drawY}" width="${drawSize}" height="${drawSize}" href="${escapeXmlText(href)}" preserveAspectRatio="xMidYMid meet" />`
      : (() => {
          const cx = x + size / 2
          const cy = y + size / 2
          const radius = Math.max(2, drawSize / 2 - 1.5)
          const strokeW = Math.max(1.5, Math.round(drawSize * 0.14))
          return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeW}" opacity="1" shape-rendering="geometricPrecision" />`
        })()

  const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : ""
  const clipAttr = clipPathId ? ` clip-path="url(#${clipPathId})"` : ""
  return `<g${clipAttr}${opacityAttr}>${content}</g>`
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

function providerColor(color: string | undefined, fallback: string): string {
  const trimmed = typeof color === "string" ? color.trim() : ""
  return trimmed.length > 0 ? trimmed : fallback
}

/** currentColor-only logos (e.g. Cursor): pure brand black/white vanishes on real tray chrome — use tray ink. */
function trayContrastBrandHex(brandHex: string, foregroundHex: string): string {
  const fg = foregroundHex.trim().toLowerCase()
  const lum = getRelativeLuminance(brandHex)
  if ((fg === "#ffffff" || fg === "#fff") && lum < 0.08) return "#ffffff"
  if ((fg === "#000000" || fg === "#000") && lum > 0.92) return "#000000"
  return brandHex
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
  iconX?: number
  iconY?: number
  texts: {
    x: number
    y: number
    text: string
    fontSize: number
    anchor?: "start" | "middle"
    textLength?: number
  }[]
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

  if (style === "logoBar" || style === "logoGrid" || style === "donut") {
    const logoPad = Math.max(1, Math.round(sizePx * 0.08))
    return {
      width: sizePx,
      height: sizePx,
      pad: logoPad,
      gap,
      barsX: logoPad,
      barsWidth: sizePx - 2 * logoPad,
      iconSize: sizePx - 2 * logoPad,
      iconX: logoPad,
      iconY: logoPad,
      texts: [],
    }
  }

  if (style === "provider") {
    // Square stacked layout: icon top half, percent bottom half.
    // Stays square so Linux/Windows trays can't squash icon+text into a sliver.
    const cellsForProvider = [...gridCells]
    if (cellsForProvider.length === 0 && hasPercentText) {
      cellsForProvider.push({ text: percentText! })
    }
    const cellText = cellsForProvider[0]?.text ?? ""
    const stackPad = Math.max(1, Math.round(sizePx * 0.06))
    const innerW = sizePx - 2 * stackPad

    if (hideIcon) {
      // Text-only square badge: one big readable percent centered.
      if (!cellText) {
        return { width: sizePx, height, pad: stackPad, gap, barsX, barsWidth, iconSize: 0, texts: [] }
      }
      const fontSize = Math.max(11, Math.round(sizePx * 0.62))
      const desired = estimateTextWidthPx(cellText, fontSize)
      const textLength = Math.min(innerW, desired)
      return {
        width: sizePx,
        height: sizePx,
        pad: stackPad,
        gap,
        barsX: stackPad,
        barsWidth: innerW,
        iconSize: 0,
        texts: [
          {
            x: Math.round(sizePx / 2),
            y: Math.round(sizePx / 2) + verticalNudgePx,
            text: cellText,
            fontSize,
            anchor: "middle",
            textLength,
          },
        ],
      }
    }

    if (!cellText) {
      // Icon-only square. Use the full tray tile so provider logos match
      // native tray icons instead of looking like a small glyph with padding.
      const iconOnlySize = sizePx
      return {
        width: sizePx,
        height: sizePx,
        pad: stackPad,
        gap,
        barsX: stackPad,
        barsWidth: innerW,
        iconSize: iconOnlySize,
        iconX: 0,
        iconY: 0,
        texts: [],
      }
    }

    // Icon (top ~58%) + percent (bottom) inside a square bitmap — favours logo readability.
    const iconAreaH = Math.round(sizePx * 0.58)
    const stackedIconSize = Math.max(8, iconAreaH - stackPad)
    const stackedIconX = Math.round((sizePx - stackedIconSize) / 2)
    const stackedIconY = stackPad

    const textTop = stackPad + iconAreaH
    const textAreaH = Math.max(8, sizePx - textTop - stackPad)
    const fontSize = Math.max(9, textAreaH + 1)
    const desired = estimateTextWidthPx(cellText, fontSize)
    const textLength = Math.min(innerW, desired)

    return {
      width: sizePx,
      height: sizePx,
      pad: stackPad,
      gap,
      barsX: stackPad,
      barsWidth: innerW,
      iconSize: stackedIconSize,
      iconX: stackedIconX,
      iconY: stackedIconY,
      texts: [
        {
          x: Math.round(sizePx / 2),
          y: textTop + Math.round(textAreaH / 2) + verticalNudgePx,
          text: cellText,
          fontSize,
          anchor: "middle",
          textLength,
        },
      ],
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

  const fontSize =
    numRows === 1 ? Math.max(11, Math.round(sizePx * 0.76)) : Math.max(9, Math.round(sizePx * 0.6))
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

/** Bars / text / strokes for generated tray SVGs: dark UI → light ink; light UI → dark ink. */
export function getTrayForegroundHex(isDarkUi: boolean): "#000000" | "#ffffff" {
  return isDarkUi ? "#ffffff" : "#000000"
}

export type TrayBarsIconArgs = {
  bars?: TrayPrimaryBar[]
  sizePx: number
  style?: MenubarIconStyle
  percentText?: string
  providerIconUrl?: string
  providerColor?: string
  providerIcons?: TrayProviderIcon[]
  gridCells?: TrayGridCell[]
  hideIcon?: boolean
  /** SVG stroke/fill color (default black). Provider raster logos unchanged. */
  foregroundHex?: string
}

function logoFraction(bar: TrayPrimaryBar | undefined): number {
  const fraction = bar?.items?.[0]?.fraction
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return 0
  return Math.max(0, Math.min(1, fraction))
}

function logoProgressParts(args: {
  href: string
  x: number
  y: number
  size: number
  fraction: number
  color: string
  clipPathId: string
}): string[] {
  const { href, x, y, size, fraction, color, clipPathId } = args
  const fillH = Math.round(size * Math.max(0, Math.min(1, fraction)))
  const parts = [
    providerIconMarkup({
      href,
      x,
      y,
      size,
      color,
      opacity: LOGO_REMAINDER_OPACITY,
    }),
  ]

  if (fillH > 0) {
    const fillY = y + size - fillH
    parts.push(`<clipPath id="${clipPathId}"><rect x="${x}" y="${fillY}" width="${size}" height="${fillH}" /></clipPath>`)
    parts.push(
      providerIconMarkup({
        href,
        x,
        y,
        size,
        color,
        clipPathId,
      })
    )
  }

  return parts
}

function polarPoint(cx: number, cy: number, radius: number, angleDeg: number): {
  x: number
  y: number
} {
  const radians = (angleDeg * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  }
}

function pieClipPathMarkup(args: {
  clipPathId: string
  x: number
  y: number
  size: number
  fraction: number
}): string | null {
  const fraction = Math.max(0, Math.min(1, args.fraction))
  if (fraction <= 0) return null
  const { clipPathId, x, y, size } = args
  if (fraction >= 1) {
    return `<clipPath id="${clipPathId}"><rect x="${x}" y="${y}" width="${size}" height="${size}" /></clipPath>`
  }

  const cx = x + size / 2
  const cy = y + size / 2
  const radius = size * 0.72 // covers square icon corners, not only the inscribed circle.
  const start = polarPoint(cx, cy, radius, -90)
  const end = polarPoint(cx, cy, radius, -90 + 360 * fraction)
  const largeArc = fraction > 0.5 ? 1 : 0
  const path = [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ")
  return `<clipPath id="${clipPathId}"><path d="${path}" /></clipPath>`
}

function logoPieParts(args: {
  href: string
  x: number
  y: number
  size: number
  fraction: number
  color: string
  clipPathId: string
}): string[] {
  const { href, x, y, size, fraction, color, clipPathId } = args
  const parts = [
    providerIconMarkup({
      href,
      x,
      y,
      size,
      color,
      opacity: LOGO_REMAINDER_OPACITY,
    }),
  ]
  const clipPath = pieClipPathMarkup({ clipPathId, x, y, size, fraction })
  if (clipPath) {
    parts.push(clipPath)
    parts.push(providerIconMarkup({ href, x, y, size, color, clipPathId }))
  }
  return parts
}

function logoGridCells(args: {
  sizePx: number
  count: number
}): { x: number; y: number; size: number }[] {
  const { sizePx } = args
  const count = Math.max(1, Math.min(4, args.count))
  const cols = count === 1 ? 1 : 2
  const rows = count <= 2 ? 1 : 2
  const pad = Math.max(1, Math.round(sizePx * 0.08))
  const gap = Math.max(1, Math.round(sizePx * 0.06))
  const cellW = Math.floor((sizePx - 2 * pad - (cols - 1) * gap) / cols)
  const cellH = Math.floor((sizePx - 2 * pad - (rows - 1) * gap) / rows)
  const iconSize = Math.max(6, Math.min(cellW, cellH))
  const gridW = cols * cellW + (cols - 1) * gap
  const gridH = rows * cellH + (rows - 1) * gap
  const startX = Math.floor((sizePx - gridW) / 2)
  const startY = Math.floor((sizePx - gridH) / 2)

  return Array.from({ length: count }, (_, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = startX + col * (cellW + gap) + Math.floor((cellW - iconSize) / 2)
    const y = startY + row * (cellH + gap) + Math.floor((cellH - iconSize) / 2)
    return { x, y, size: iconSize }
  })
}

export function makeTrayBarsSvg(args: TrayBarsIconArgs): string {
  const {
    bars = [],
    sizePx,
    style = "provider",
    percentText,
    providerIconUrl,
    providerColor: singleProviderColor,
    providerIcons = [],
    gridCells = [],
    hideIcon = false,
    foregroundHex = "#000000",
  } = args
  const resolvedProviderBrand = providerColor(singleProviderColor, foregroundHex)
  const trayGlyphTint = trayContrastBrandHex(resolvedProviderBrand, foregroundHex)
  const barsForStyle = style === "bars" || style === "logoGrid" ? bars : bars.slice(0, 1)
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
  } else if (style === "logoBar") {
    const href = typeof providerIconUrl === "string" && !hideIcon ? providerIconUrl.trim() : ""
    parts.push(
      ...logoProgressParts({
        href,
        x: layout.iconX ?? layout.pad,
        y: layout.iconY ?? layout.pad,
        size: layout.iconSize,
        fraction: logoFraction(barsForStyle[0]),
        color: trayContrastBrandHex(
          providerColor(barsForStyle[0]?.color, trayGlyphTint),
          foregroundHex
        ),
        clipPathId: "tray-logo-fill",
      })
    )
  } else if (style === "logoGrid") {
    const iconById = new Map(
      providerIcons.map((icon) => [
        icon.id,
        {
          url: icon.iconUrl?.trim() ?? "",
          color: icon.color,
        },
      ])
    )
    const cells = logoGridCells({ sizePx, count: barsForStyle.length || 1 })
    for (let i = 0; i < cells.length; i += 1) {
      const bar = barsForStyle[i]
      const cell = cells[i]
      const provider = bar ? iconById.get(bar.id) : undefined
      const href = provider?.url ?? ""
      parts.push(
        ...logoProgressParts({
          href,
          x: cell.x,
          y: cell.y,
          size: cell.size,
          fraction: logoFraction(bar),
          color: trayContrastBrandHex(
            providerColor(provider?.color ?? bar?.color, foregroundHex),
            foregroundHex
          ),
          clipPathId: `tray-logo-grid-fill-${i}`,
        })
      )
    }
  } else if (style === "donut") {
    const href = typeof providerIconUrl === "string" && !hideIcon ? providerIconUrl.trim() : ""
    parts.push(
      ...logoPieParts({
        href,
        x: layout.iconX ?? layout.pad,
        y: layout.iconY ?? layout.pad,
        size: layout.iconSize,
        fraction: logoFraction(barsForStyle[0]),
        color: trayContrastBrandHex(
          providerColor(barsForStyle[0]?.color, trayGlyphTint),
          foregroundHex
        ),
        clipPathId: "tray-logo-pie",
      })
    )
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
      const barColor = providerColor(bar?.color, foregroundHex)
      const y = yOffset + i * (trackH + layout.gap) + 1
      const x = layout.barsX

      parts.push(
        `<rect x="${x}" y="${y}" width="${trackW}" height="${trackH}" rx="${rx}" fill="${barColor}" opacity="${trackOpacity}" />`
      )

      const fraction = bar?.items?.[0]?.fraction
      if (typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0) {
        const { fillW, remainderDrawW, dividerX } = getBarFillLayout(trackW, fraction)
        if (fillW > 0) {
          const movingEdgeRadius = Math.max(0, Math.floor(rx * 0.35))
          if (fillW >= trackW) {
            parts.push(
              `<rect x="${x}" y="${y}" width="${fillW}" height="${trackH}" rx="${rx}" fill="${barColor}" opacity="${fillOpacity}" />`
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
            parts.push(`<path d="${fillPath}" fill="${barColor}" opacity="${fillOpacity}" />`)
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
          parts.push(`<path d="${remainderPath}" fill="${barColor}" opacity="${remainderOpacity}" />`)
        }
      }
    }
  }

  const x = layout.iconX ?? layout.barsX
  const y = layout.iconY ?? Math.round((height - layout.iconSize) / 2) + 1
  const href = typeof providerIconUrl === "string" ? providerIconUrl.trim() : ""

  if (!hideIcon && style !== "bars" && style !== "logoBar" && style !== "logoGrid" && style !== "donut") {
    parts.push(providerIconMarkup({ href, x, y, size: layout.iconSize, color: trayGlyphTint }))
  }

  for (const { x: tX, y: tY, text, fontSize, anchor: textAnchor, textLength } of layout.texts) {
    const anchor = text === "|" ? "middle" : (textAnchor ?? "start")
    const opacity = text === "|" ? "0.3" : "1"
    const strokeExtra = text === "|" ? "" : ` ${trayPercentTextStrokeAttrs(foregroundHex, fontSize)}`
    const lengthExtra =
      typeof textLength === "number"
        ? ` textLength="${textLength}" lengthAdjust="spacingAndGlyphs"`
        : ""
    parts.push(
      `<text x="${tX}" y="${tY}" fill="${foregroundHex}" opacity="${opacity}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="900" text-anchor="${anchor}" dominant-baseline="middle" text-rendering="geometricPrecision"${lengthExtra}${strokeExtra}>${escapeXmlText(text)}</text>`
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

/** Dark outline behind light glyphs (and vice versa) so scaled tray bitmaps stay readable. */
function trayPercentTextStrokeAttrs(foregroundHex: string, fontSize: number): string {
  const hex = foregroundHex.trim().toLowerCase()
  const isLightInk = hex === "#ffffff" || hex === "#fff"
  const stroke = isLightInk ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.55)"
  const sw = Math.max(1.25, Math.min(2.75, fontSize * 0.09))
  return `stroke="${stroke}" stroke-width="${sw.toFixed(2)}" paint-order="stroke fill" stroke-linejoin="round"`
}

export async function renderTrayBarsIcon(args: TrayBarsIconArgs): Promise<Image> {
  const {
    bars = [],
    sizePx,
    style = "provider",
    percentText,
    providerIconUrl,
    providerColor: singleProviderColor,
    providerIcons = [],
    gridCells = [],
    hideIcon = false,
    foregroundHex = "#000000",
  } = args
  const text = normalizePercentText(percentText)
  const svg = makeTrayBarsSvg({
    bars,
    sizePx,
    style,
    percentText: text,
    providerIconUrl,
    providerColor: singleProviderColor,
    providerIcons,
    gridCells,
    hideIcon,
    foregroundHex,
  })
  const layout = getSvgLayout({
    sizePx,
    style,
    percentText: text,
    gridCells,
    hideIcon,
  })
  const rgba = await rasterizeSvgToRgba(svg, layout.width, layout.height)
  return await Image.new(rgba, layout.width, layout.height)
}
