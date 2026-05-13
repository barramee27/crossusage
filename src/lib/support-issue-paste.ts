/** Plain text for GitHub: short header from `get_support_bundle_json` + redacted `logTailRedacted`. */

function readRootString(bundle: Record<string, unknown>, key: string): string | null {
  const v = bundle[key]
  return typeof v === "string" && v.trim() !== "" ? v : null
}

function readRuntimeString(bundle: Record<string, unknown>, key: string): string | null {
  const runtime = bundle.runtime
  if (!runtime || typeof runtime !== "object") return null
  const v = (runtime as Record<string, unknown>)[key]
  return typeof v === "string" && v.trim() !== "" ? v : null
}

export function formatLogTailClipboard(bundle: Record<string, unknown>): string {
  const lines: string[] = []
  lines.push("--- CrossUsage diagnostics (add your description above this block) ---")

  const appVersion = readRootString(bundle, "appVersion")
  const os = readRootString(bundle, "os")
  const arch = readRootString(bundle, "arch")
  if (appVersion || os || arch) {
    const parts: string[] = []
    if (appVersion) parts.push(`CrossUsage ${appVersion}`)
    if (os) parts.push(os)
    if (arch) parts.push(arch)
    lines.push(`build: ${parts.join(" | ")}`)
  }

  const distro = readRuntimeString(bundle, "distro")
  const kernel = readRuntimeString(bundle, "kernel")
  if (distro || kernel) {
    lines.push(`runtime: ${[distro, kernel].filter(Boolean).join(" | ")}`)
  }

  const logLevel = readRootString(bundle, "logLevel")
  if (logLevel) lines.push(`logLevel: ${logLevel}`)

  const slots = bundle.providerInstanceSlotCount
  if (typeof slots === "number" && Number.isFinite(slots)) {
    lines.push(`providerAccountSlots: ${slots}`)
  }

  const enabled = bundle.enabledProviderInstanceIds
  if (Array.isArray(enabled)) {
    const ids = enabled.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    lines.push(`enabledProviderInstances: ${ids.length ? ids.join(", ") : "(none)"}`)
  }

  lines.push("--- redacted log tail (newest last) ---")
  lines.push("")

  const tail = bundle.logTailRedacted
  if (typeof tail !== "string" || !tail.trim()) {
    lines.push("(no redacted log tail available)")
    return lines.join("\n")
  }

  lines.push(tail.trimEnd())
  return lines.join("\n")
}
