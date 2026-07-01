import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  SUPPORTED_UI_LOCALES,
  UI_LOCALE_LABELS,
  type AppLocale,
  type DisplayCurrency,
  type SupportedUiLocale,
} from "@/i18n/locale-meta"
import { buildDisplayCurrencyOptions } from "@/lib/currency-display"
import { getEffectiveIntlLocale } from "@/lib/locale-format"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

type LanguageRegionSectionProps = {
  appLocale: AppLocale
  displayCurrency: DisplayCurrency
  onAppLocaleChange: (value: AppLocale) => void
  onDisplayCurrencyChange: (value: DisplayCurrency) => void
}

export function LanguageRegionSection({
  appLocale,
  displayCurrency,
  onAppLocaleChange,
  onDisplayCurrencyChange,
}: LanguageRegionSectionProps) {
  const { t } = useTranslation()
  const exchangeRatesRevision = useAppPreferencesStore((s) => s.exchangeRatesRevision)
  const intlLocale = getEffectiveIntlLocale()

  const languageOptions = useMemo(
    () => [
      { value: "auto" as const, label: t("common.auto") },
      ...SUPPORTED_UI_LOCALES.map((locale) => ({
        value: locale as SupportedUiLocale,
        label: UI_LOCALE_LABELS[locale],
      })),
    ],
    [t],
  )

  const currencyOptions = useMemo(
    () => buildDisplayCurrencyOptions(t, intlLocale),
    [t, intlLocale, exchangeRatesRevision],
  )

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">{t("settings.languageRegion.title")}</h3>
      <p className="text-sm text-muted-foreground mb-2">{t("settings.languageRegion.description")}</p>
      <p className="text-sm font-medium mb-1">{t("settings.languageRegion.language")}</p>
      <div className="bg-muted/50 rounded-lg p-1 mb-3">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("settings.languageRegion.languageAria")}>
          {languageOptions.map((option) => {
            const isActive = option.value === appLocale
            return (
              <Button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="shrink-0"
                onClick={() => onAppLocaleChange(option.value)}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      </div>
      <p className="text-sm font-medium mb-1">{t("settings.languageRegion.currency")}</p>
      {displayCurrency === "auto" ? (
        <p className="text-xs text-muted-foreground mb-2">{t("settings.languageRegion.currencyAutoHint")}</p>
      ) : null}
      <div className="bg-muted/50 rounded-lg p-1">
        <div
          className="flex flex-wrap gap-1"
          role="radiogroup"
          aria-label={t("settings.languageRegion.currencyAria")}
        >
          {currencyOptions.map((option) => {
            const isActive = option.value === displayCurrency
            return (
              <Button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="shrink-0 text-left h-auto min-h-8 py-1.5"
                onClick={() => onDisplayCurrencyChange(option.value)}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
