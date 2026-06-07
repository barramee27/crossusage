/** Full-color raster icons (e.g. Cursor Nightly) must not use CSS mask + brandColor. */
export function isRasterProviderIconUrl(iconUrl: string | undefined): boolean {
  if (!iconUrl) return false
  const trimmed = iconUrl.trim()
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(trimmed)
}
