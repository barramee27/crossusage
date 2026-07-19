const ANTIGRAVITY_LABEL_MIGRATION: Record<string, string> = {
  "Gemini 3 Pro": "Session",
  "Gemini 3 Flash": "Session",
  "Gemini Pro": "Session",
  "Gemini Flash": "Session",
  "Claude Opus 4.5": "Session — Claude and GPT Models",
  "Claude Opus 4.6": "Session — Claude and GPT Models",
  "Claude": "Session — Claude and GPT Models",
}

export function isAntigravitySummaryProviderId(providerId: string): boolean {
  return (
    providerId === "antigravity" ||
    providerId.startsWith("antigravity:") ||
    providerId === "antigravity-cli" ||
    providerId.startsWith("antigravity-cli:")
  )
}

export function migrateAntigravityLineLabel(providerId: string, lineLabel: string): string {
  if (!isAntigravitySummaryProviderId(providerId)) return lineLabel
  return ANTIGRAVITY_LABEL_MIGRATION[lineLabel] ?? lineLabel
}
