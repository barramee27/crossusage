import type { AppLocale, DisplayCurrency, DisplayCurrencyCode, SupportedUiLocale } from "@/i18n/locale-meta"
import { resolveDisplayCurrency, resolveIntlLocale } from "@/i18n/locale-meta"
import { convertFromUsd } from "@/lib/exchange-rates"

export type LocaleFormatContext = {
  appLocale: AppLocale
  displayCurrency: DisplayCurrency
}

let formatContext: LocaleFormatContext = {
  appLocale: "auto",
  displayCurrency: "auto",
}

export function setLocaleFormatContext(ctx: LocaleFormatContext): void {
  formatContext = ctx
}

export function getLocaleFormatContext(): LocaleFormatContext {
  return formatContext
}

export function getEffectiveUiLocale(): SupportedUiLocale {
  return resolveIntlLocale(formatContext.appLocale) as SupportedUiLocale
}

export function getEffectiveIntlLocale(): string {
  return resolveIntlLocale(formatContext.appLocale)
}

export function getEffectiveDisplayCurrency(): DisplayCurrencyCode {
  return resolveDisplayCurrency(formatContext.displayCurrency, getEffectiveUiLocale())
}

const ZERO_DECIMAL_CURRENCIES = new Set<DisplayCurrencyCode>(["JPY", "KRW"])

export function currencyFractionDigits(code: DisplayCurrencyCode): number {
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2
}

export function formatCountNumber(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return "0"
  const maximumFractionDigits = Number.isInteger(value) ? 0 : 2
  return new Intl.NumberFormat(locale ?? getEffectiveIntlLocale(), {
    maximumFractionDigits,
  }).format(value)
}

export function formatFixedPrecisionNumber(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return "0"
  const fractionDigits = Number.isInteger(value) ? 0 : 2
  return new Intl.NumberFormat(locale ?? getEffectiveIntlLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/**
 * Format a monetary amount. Provider quotas are reported in USD; converts using cached FX when available.
 * Always uses the target currency symbol/locale — never falls back to USD formatting for non-USD targets.
 */
export function formatMoney(
  amount: number,
  options?: {
    sourceCurrency?: DisplayCurrencyCode
    locale?: string
    displayCurrency?: DisplayCurrencyCode
  },
): string {
  if (!Number.isFinite(amount)) return "—"
  const locale = options?.locale ?? getEffectiveIntlLocale()
  const target = options?.displayCurrency ?? getEffectiveDisplayCurrency()
  const source = options?.sourceCurrency ?? "USD"
  let value = amount
  if (source === "USD" && target !== "USD") {
    value = convertFromUsd(amount, target)
  }
  const fractionDigits = currencyFractionDigits(target)
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: target,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** @deprecated use formatMoney — kept for tray code paths during migration */
export function formatUsdTrayAmount(amount: number): string {
  return formatMoney(amount, { sourceCurrency: "USD" })
}
