import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  AUTO_UPDATE_OPTIONS,
  DISPLAY_MODE_OPTIONS,
  MENUBAR_ICON_STYLE_OPTIONS,
  MODERN_DENSITY_OPTIONS,
  RESET_TIMER_DISPLAY_OPTIONS,
  THEME_OPTIONS,
  TIME_FORMAT_OPTIONS,
  UI_LAYOUT_OPTIONS,
  UI_SCALE_OPTIONS,
  USAGE_ALERT_THRESHOLD_OPTIONS,
  USAGE_HISTORY_RETENTION_OPTIONS,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type MenubarIconStyle,
  type ModernDensity,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TimeFormatMode,
  type UILayout,
  type UIScale,
  type UsageAlertThreshold,
} from "@/lib/settings"

export function useTranslatedSettingsOptions() {
  const { t } = useTranslation()

  return useMemo(
    () => ({
      autoUpdateOptions: AUTO_UPDATE_OPTIONS.map((o) => ({
        value: o.value,
        label: t(`settings.options.autoUpdate.${o.value}`),
      })),
      displayModeOptions: DISPLAY_MODE_OPTIONS.map((o) => ({
        value: o.value as DisplayMode,
        label: t(`settings.options.displayMode.${o.value}`),
      })),
      resetTimerOptions: RESET_TIMER_DISPLAY_OPTIONS.map((o) => ({
        value: o.value as ResetTimerDisplayMode,
        label: t(`settings.options.resetTimer.${o.value}`),
      })),
      timeFormatOptions: TIME_FORMAT_OPTIONS.map((o) => ({
        value: o.value as TimeFormatMode,
        label: t(`settings.options.timeFormat.${o.value}`),
      })),
      uiLayoutOptions: UI_LAYOUT_OPTIONS.map((o) => ({
        value: o.value as UILayout,
        label: t(`settings.options.uiLayout.${o.value}`),
      })),
      modernDensityOptions: MODERN_DENSITY_OPTIONS.map((o) => ({
        value: o.value as ModernDensity,
        label: t(`settings.options.modernDensity.${o.value}`),
      })),
      themeOptions: THEME_OPTIONS.map((o) => ({
        value: o.value as ThemeMode,
        label: t(`settings.options.theme.${o.value}`),
      })),
      uiScaleOptions: UI_SCALE_OPTIONS.map((o) => ({
        value: o.value as UIScale,
        label: t(`settings.options.uiScale.${o.value}`),
      })),
      menubarIconOptions: MENUBAR_ICON_STYLE_OPTIONS.map((o) => ({
        value: o.value as MenubarIconStyle,
        label: t(`settings.options.menubarIcon.${o.value}`),
      })),
      usageAlertThresholdOptions: USAGE_ALERT_THRESHOLD_OPTIONS.map((o) => ({
        value: o.value as UsageAlertThreshold,
        label:
          o.value === "custom"
            ? t("settings.options.usageAlertThreshold.custom")
            : t(`settings.options.usageAlertThreshold.${o.value}`),
      })),
      usageHistoryRetentionOptions: USAGE_HISTORY_RETENTION_OPTIONS.map((o) => ({
        value: o.value,
        label: t(`settings.options.usageHistoryRetention.${o.value}`),
      })),
      modernTabs: [
        { id: "general" as const, label: t("modern.settingsTabGeneral") },
        { id: "tray" as const, label: t("modern.settingsTabTray") },
        { id: "appearance" as const, label: t("modern.settingsTabLook") },
        { id: "providers" as const, label: t("modern.settingsTabProviders") },
        { id: "advanced" as const, label: t("modern.settingsTabAdvanced") },
      ],
    }),
    [t],
  )
}
