interface LiquidGlassFilterProps {
  /** Whether the glass theme is currently active */
  active: boolean
}

/**
 * Previously rendered SVG caustic filters, now a no-op.
 * The glass effect is achieved purely with CSS backdrop-filter + gradients.
 */
export function LiquidGlassFilter(_props: LiquidGlassFilterProps) {
  return null
}
