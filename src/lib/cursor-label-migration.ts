const CURSOR_LABEL_MIGRATION: Record<string, string> = {
  "Auto usage": "Cursor Models",
  "API usage": "Other Models",
}

export function isCursorFamilyProviderId(providerId: string): boolean {
  return (
    providerId === "cursor" ||
    providerId.startsWith("cursor:") ||
    providerId === "cursor-nightly" ||
    providerId.startsWith("cursor-nightly:")
  )
}

export function migrateCursorLineLabel(providerId: string, lineLabel: string): string {
  if (!isCursorFamilyProviderId(providerId)) return lineLabel
  return CURSOR_LABEL_MIGRATION[lineLabel] ?? lineLabel
}
