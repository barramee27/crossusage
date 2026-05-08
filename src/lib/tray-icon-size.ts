/**
 * Tray icon **render** dimensions (logical pt baseline × devicePixelRatio).
 * The OS / desktop shell still scales the final bitmap into its tray slot; we
 * only control the source pixel size we generate.
 */

/** macOS menubar slots are ~18pt. */
export const TRAY_ICON_BASE_PT_MACOS = 18

/**
 * Windows / Linux notification areas often shrink wide tray bitmaps into a
 * square; base 30 keeps numeric labels legible after downsampling
 * (see barramee27/crossusage#1; was 26).
 */
export const TRAY_ICON_BASE_PT_WIN_LINUX = 30

export function resolveTrayIconBasePt(userAgent: string | undefined): number {
  if (typeof userAgent !== "string" || userAgent.length === 0) {
    return TRAY_ICON_BASE_PT_MACOS
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) return TRAY_ICON_BASE_PT_MACOS
  if (/Mac OS X|Macintosh/i.test(userAgent)) return TRAY_ICON_BASE_PT_MACOS
  if (/Windows/i.test(userAgent)) return TRAY_ICON_BASE_PT_WIN_LINUX
  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) {
    return TRAY_ICON_BASE_PT_WIN_LINUX
  }
  return TRAY_ICON_BASE_PT_MACOS
}

export function getTrayIconSizePx(devicePixelRatio: number | undefined): number {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1
  const basePt =
    typeof navigator !== "undefined"
      ? resolveTrayIconBasePt(navigator.userAgent)
      : TRAY_ICON_BASE_PT_MACOS
  return Math.max(basePt, Math.round(basePt * dpr))
}
