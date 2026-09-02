import type { UILayout } from "@/lib/settings"

export function pickTrayProviderId(args: {
  uiLayout: UILayout
  enabledPluginIds: string[]
  activeProviderId: string | null
  trayFocusProviderId: string | null
  lastTrayProviderId: string | null
  firstPinnedProviderId: string | null
}): string | null {
  const enabled = args.enabledPluginIds
  const isEnabled = (id: string | null | undefined): id is string =>
    Boolean(id) && enabled.includes(id)

  // Classic follows the sidebar. Modern pin focus must not freeze Classic on one logo.
  if (args.uiLayout === "modern" && isEnabled(args.trayFocusProviderId)) {
    return args.trayFocusProviderId
  }
  if (isEnabled(args.activeProviderId)) return args.activeProviderId
  if (isEnabled(args.lastTrayProviderId)) return args.lastTrayProviderId
  if (args.uiLayout === "modern" && isEnabled(args.firstPinnedProviderId)) {
    return args.firstPinnedProviderId
  }
  return enabled[0] ?? null
}
