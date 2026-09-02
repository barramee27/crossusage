import { cn } from "@/lib/utils"
import { getRelativeLuminance } from "@/lib/color"
import { isFullColorProviderIconUrl } from "@/lib/provider-icon-url"

function getMaskIconColor(brandColor: string | undefined, isDark: boolean): string {
  if (!brandColor) return "currentColor"
  const luminance = getRelativeLuminance(brandColor)
  if (isDark && luminance < 0.15) return "#ffffff"
  if (!isDark && luminance > 0.85) return "currentColor"
  return brandColor
}

type ProviderIconProps = {
  iconUrl?: string
  brandColor?: string
  isDark?: boolean
  sizePx: number
  className?: string
  /** When set, mask icons use primary-foreground vs foreground (settings previews). */
  isActive?: boolean
  alt?: string
}

export function ProviderIcon({
  iconUrl,
  brandColor,
  isDark = false,
  sizePx,
  className,
  isActive,
  alt = "",
}: ProviderIconProps) {
  const sizeStyle = { width: `${sizePx}px`, height: `${sizePx}px` }

  if (!iconUrl) {
    const textClass = isActive ? "text-primary-foreground" : "text-foreground"
    return (
      <svg
        aria-hidden
        viewBox="0 0 26 26"
        className={cn("shrink-0", textClass, className)}
        style={sizeStyle}
      >
        <circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" strokeWidth="3.5" opacity={0.3} />
      </svg>
    )
  }

  if (isFullColorProviderIconUrl(iconUrl)) {
    return (
      <img
        src={iconUrl}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        className={cn("shrink-0 object-contain", className)}
        style={sizeStyle}
      />
    )
  }

  const colorClass = isActive != null
    ? isActive
      ? "bg-primary-foreground"
      : "bg-foreground"
    : undefined

  return (
    <span
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className={cn("shrink-0 inline-block", colorClass, className)}
      style={{
        ...sizeStyle,
        backgroundColor:
          colorClass == null ? getMaskIconColor(brandColor, isDark) : undefined,
        WebkitMaskImage: `url(${iconUrl})`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url(${iconUrl})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  )
}
