import type { DisplayCurrency, DisplayCurrencyCode } from "@/i18n/locale-meta"
import { SUPPORTED_DISPLAY_CURRENCIES } from "@/i18n/locale-meta"
import { convertFromUsd } from "@/lib/exchange-rates"
import {
  currencyFractionDigits,
  formatMoney,
  getEffectiveIntlLocale,
} from "@/lib/locale-format"

const CURRENCY_SAMPLE_USD = 12.4

export function formatCurrencyOptionLabel(
  code: DisplayCurrencyCode,
  locale?: string,
): string {
  const intlLocale = locale ?? getEffectiveIntlLocale()
  let name = code
  try {
    name = new Intl.DisplayNames([intlLocale], { type: "currency" }).of(code) ?? code
  } catch {
    // keep code
  }
  const converted = convertFromUsd(CURRENCY_SAMPLE_USD, code)
  const fractionDigits = currencyFractionDigits(code)
  const sample = new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(converted)
  return `${code} · ${name} (${sample})`
}

export function buildDisplayCurrencyOptions(
  t: (key: string) => string,
  locale?: string,
): { value: DisplayCurrency; label: string }[] {
  const intlLocale = locale ?? getEffectiveIntlLocale()
  return [
    { value: "auto", label: t("common.auto") },
    ...SUPPORTED_DISPLAY_CURRENCIES.map((code) => ({
      value: code as DisplayCurrency,
      label: formatCurrencyOptionLabel(code, intlLocale),
    })),
  ]
}

/** Format money using explicit target (for previews independent of user setting). */
export function formatMoneyInCurrency(
  amountUsd: number,
  code: DisplayCurrencyCode,
  locale?: string,
): string {
  return formatMoney(amountUsd, { sourceCurrency: "USD", displayCurrency: code, locale })
}
