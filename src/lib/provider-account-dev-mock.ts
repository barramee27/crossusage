/** Matches `ProviderAccountCredentialInput` in settings (kept here to avoid circular imports). */
export type DevMockCredentialPayload = {
  label?: string;
  accessToken: string;
  refreshToken: string;
  sessionKey: string;
};

/**
 * Opt-in for `vite` / `tauri dev`: set `VITE_PROVIDER_ACCOUNT_DEV_MOCK=1` (or `true` / `yes`) to save
 * placeholder credentials instead of pasted values. Default dev behavior matches production (real saves).
 */
export function isProviderAccountDevMockEnvEnabled(): boolean {
  const v = import.meta.env.VITE_PROVIDER_ACCOUNT_DEV_MOCK;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/** True only in Vite `development` mode when {@link isProviderAccountDevMockEnvEnabled} is on. */
export function shouldApplyProviderAccountDevMock(): boolean {
  return import.meta.env.MODE === "development" && isProviderAccountDevMockEnvEnabled();
}

/** Deterministic placeholders so plugins never see real secrets during local UI dev. */
export function buildDevMockProviderCredentials(label: string): DevMockCredentialPayload {
  const safe = label.trim() || "Account";
  return {
    label: safe,
    accessToken: "crossusage-dev-mock-access-token",
    refreshToken: "crossusage-dev-mock-refresh-token",
    sessionKey: `crossusage-dev-mock-session:${encodeURIComponent(safe)}`,
  };
}
