/** Runtime log levels stored in settings.json `logLevel` — keep in sync with tray.rs. */
export const LOG_LEVEL_OPTIONS = [
  { value: "error", label: "Error", hint: "Failures only" },
  { value: "warn", label: "Warn", hint: "Warnings and errors" },
  { value: "info", label: "Info", hint: "Normal operation (default)" },
  { value: "debug", label: "Debug", hint: "Verbose plugin and probe detail" },
  { value: "trace", label: "Trace", hint: "Maximum detail" },
  { value: "off", label: "Off", hint: "Disable file logging" },
] as const

export type LogLevel = (typeof LOG_LEVEL_OPTIONS)[number]["value"]

export const DEFAULT_LOG_LEVEL: LogLevel = "info"

export function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVEL_OPTIONS.some((opt) => opt.value === value)
}
