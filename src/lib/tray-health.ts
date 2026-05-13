import type { PluginState } from "@/hooks/app/types"
import type { PluginMeta } from "@/lib/plugin-types"
import { getEnabledPluginIds, getProviderDisplayName, type PluginSettings } from "@/lib/settings"

const DEFAULT_MAX_LEN = 220

function instanceHasStaleBackdrop(state: PluginState): boolean {
  return (
    state.lastUpdatedAt != null ||
    (state.data?.lines != null && state.data.lines.length > 0)
  )
}

function shorten(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

export type TrayIssueKind = "stale" | "error"

export type TrayIssueEntry = {
  instanceId: string
  displayName: string
  kind: TrayIssueKind
  /** Only for kind "error" when not stale; truncated for UI */
  detail?: string
}

/** Collect enabled instances that are in error or stale-error (matches ProviderCard stale semantics). */
export function collectTrayIssues(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
}): TrayIssueEntry[] {
  const { pluginsMeta, pluginSettings, pluginStates } = args
  if (!pluginSettings) return []

  const out: TrayIssueEntry[] = []
  for (const instanceId of getEnabledPluginIds(pluginSettings)) {
    const state = pluginStates[instanceId]
    if (!state?.error) continue
    const displayName = getProviderDisplayName(instanceId, pluginSettings, pluginsMeta)
    const stale = instanceHasStaleBackdrop(state)
    if (stale) {
      out.push({ instanceId, displayName, kind: "stale" })
    } else {
      out.push({
        instanceId,
        displayName,
        kind: "error",
        detail: shorten(state.error, 48),
      })
    }
  }
  return out
}

/**
 * One-line suffix for native tray tooltip / Linux mirrored menu row.
 * Returns null when there are no probe errors for enabled providers.
 */
export function formatTrayIssuesAppendage(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
  maxLen?: number
  maxProviders?: number
}): string | null {
  const maxLen = args.maxLen ?? DEFAULT_MAX_LEN
  const maxProviders = args.maxProviders ?? 4
  const issues = collectTrayIssues(args)
  if (issues.length === 0) return null

  const shown = issues.slice(0, maxProviders)
  const parts = shown.map((e) =>
    e.kind === "stale"
      ? `${e.displayName} (stale)`
      : `${e.displayName} (${e.detail ?? "error"})`
  )
  let more = ""
  if (issues.length > maxProviders) {
    more = ` +${issues.length - maxProviders} more`
  }
  let line = `Issues: ${parts.join(", ")}${more}`
  if (line.length > maxLen) {
    line = shorten(line, maxLen)
  }
  return line
}
