/** Payload from Tauri `get_os_diagnostics` (camelCase). */
export type OsDiagnosticsPayload = {
  family: string
  arch: string
  distro: string | null
  kernel: string | null
}

/** One line for About / Settings (Linux: distro + kernel + arch). */
export function formatOsDiagnosticsLine(o: OsDiagnosticsPayload): string {
  if (o.family === "linux") {
    const distro = o.distro?.trim() || "Linux"
    const k = o.kernel ? ` · kernel ${o.kernel}` : ""
    return `OS: ${distro}${k} · ${o.arch}`
  }
  const k = o.kernel ? ` · kernel ${o.kernel}` : ""
  return `OS: ${o.family}${k} · ${o.arch}`
}
