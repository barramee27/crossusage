import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { SUPPORTED_UI_LOCALES } from "@/i18n/locale-meta"
import en from "@/i18n/locales/en.json"
import ko from "@/i18n/locales/ko.json"
import ja from "@/i18n/locales/ja.json"
import zhCN from "@/i18n/locales/zh-CN.json"
import zhTW from "@/i18n/locales/zh-TW.json"
import de from "@/i18n/locales/de.json"
import fr from "@/i18n/locales/fr.json"
import nl from "@/i18n/locales/nl.json"
import pl from "@/i18n/locales/pl.json"
import cs from "@/i18n/locales/cs.json"
import ptBR from "@/i18n/locales/pt-BR.json"
import es from "@/i18n/locales/es.json"
import it from "@/i18n/locales/it.json"

const resources = {
  en: { translation: en },
  ko: { translation: ko },
  ja: { translation: ja },
  "zh-CN": { translation: zhCN },
  "zh-TW": { translation: zhTW },
  de: { translation: de },
  fr: { translation: fr },
  nl: { translation: nl },
  pl: { translation: pl },
  cs: { translation: cs },
  "pt-BR": { translation: ptBR },
  es: { translation: es },
  it: { translation: it },
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_UI_LOCALES],
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false },
})

export default i18n
