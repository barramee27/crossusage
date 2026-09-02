/** Full-color raster icons (e.g. Cursor Nightly) must not use CSS mask + brandColor. */
export function isRasterProviderIconUrl(iconUrl: string | undefined): boolean {
  if (!iconUrl) return false
  const trimmed = iconUrl.trim()
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(trimmed)
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

/** Raster logos, or SVGs that are not currentColor-tinted (e.g. Gemini 2025 gradient). */
export function isFullColorProviderIconUrl(iconUrl: string | undefined): boolean {
  if (!iconUrl) return false
  const trimmed = iconUrl.trim()
  if (isRasterProviderIconUrl(trimmed)) return true
  const svg = decodeSvgDataUrl(trimmed)
  if (!svg) return false
  return !/currentColor/i.test(svg)
}
