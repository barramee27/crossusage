/** BCP-47 tags supported by the app UI. `auto` is stored only in settings, not here. */
export const SUPPORTED_UI_LOCALES = [
  "en",
  "ko",
  "ja",
  "zh-CN",
  "zh-TW",
  "de",
  "fr",
  "nl",
  "pl",
  "cs",
  "pt-BR",
  "es",
  "it",
] as const

export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number]

export type AppLocale = "auto" | SupportedUiLocale

export const DEFAULT_APP_LOCALE: AppLocale = "auto"

/** ISO 4217 codes offered in Settings → Region. */
export const SUPPORTED_DISPLAY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "KRW",
  "CNY",
  "TWD",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "BRL",
  "MXN",
  "INR",
  "SGD",
  "HKD",
  "NZD",
] as const

export type DisplayCurrencyCode = (typeof SUPPORTED_DISPLAY_CURRENCIES)[number]

export type DisplayCurrency = "auto" | DisplayCurrencyCode

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = "auto"

/** Native language names for the language picker. */
export const UI_LOCALE_LABELS: Record<SupportedUiLocale, string> = {
  en: "English",
  ko: "한국어",
  ja: "日本語",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  de: "Deutsch",
  fr: "Français",
  nl: "Nederlands",
  pl: "Polski",
  cs: "Čeština",
  "pt-BR": "Português (Brasil)",
  es: "Español",
  it: "Italiano",
}

const LOCALE_TO_CURRENCY: Record<string, DisplayCurrencyCode> = {
  en: "USD",
  "en-US": "USD",
  "en-GB": "GBP",
  "en-AU": "AUD",
  "en-CA": "CAD",
  "en-NZ": "NZD",
  ko: "KRW",
  "ko-KR": "KRW",
  ja: "JPY",
  "ja-JP": "JPY",
  "zh-CN": "CNY",
  "zh-TW": "TWD",
  de: "EUR",
  "de-DE": "EUR",
  fr: "EUR",
  "fr-FR": "EUR",
  nl: "EUR",
  "nl-NL": "EUR",
  pl: "PLN",
  "pl-PL": "PLN",
  cs: "CZK",
  "cs-CZ": "CZK",
  "pt-BR": "BRL",
  es: "EUR",
  "es-ES": "EUR",
  it: "EUR",
  "it-IT": "EUR",
}

export function matchSupportedLocale(tag: string): SupportedUiLocale | null {
  const normalized = tag.trim()
  if (!normalized) return null
  const direct = SUPPORTED_UI_LOCALES.find((l) => l.toLowerCase() === normalized.toLowerCase())
  if (direct) return direct
  const base = normalized.split("-")[0]?.toLowerCase()
  if (base === "zh") {
    if (normalized.toLowerCase().includes("tw") || normalized.toLowerCase().includes("hk")) {
      return "zh-TW"
    }
    return "zh-CN"
  }
  if (base === "pt") return "pt-BR"
  const byBase = SUPPORTED_UI_LOCALES.find((l) => l.split("-")[0]?.toLowerCase() === base)
  return byBase ?? null
}

export function resolveUiLocale(stored: AppLocale): SupportedUiLocale {
  if (stored !== "auto") return stored
  if (typeof navigator !== "undefined" && navigator.language) {
    return matchSupportedLocale(navigator.language) ?? "en"
  }
  return "en"
}

export function resolveIntlLocale(stored: AppLocale): string {
  const ui = resolveUiLocale(stored)
  return ui
}

export function resolveDisplayCurrency(
  stored: DisplayCurrency,
  uiLocale: SupportedUiLocale,
): DisplayCurrencyCode {
  if (stored !== "auto") return stored
  return LOCALE_TO_CURRENCY[uiLocale] ?? LOCALE_TO_CURRENCY[uiLocale.split("-")[0] ?? ""] ?? "USD"
}
