import { LazyStore } from "@tauri-apps/plugin-store";
import type { PluginMeta, ProbeTarget } from "@/lib/plugin-types";
import { normalizeModernLayout, EMPTY_MODERN_LAYOUT, type ModernLayoutState } from "@/lib/modern-layout";
import { migrateAntigravityLineLabel } from "@/lib/antigravity-label-migration";
import { migrateCursorLineLabel } from "@/lib/cursor-label-migration";
import {
  DEFAULT_APP_LOCALE,
  DEFAULT_DISPLAY_CURRENCY,
  SUPPORTED_DISPLAY_CURRENCIES,
  SUPPORTED_UI_LOCALES,
  type AppLocale,
  type DisplayCurrency,
  type DisplayCurrencyCode,
  type SupportedUiLocale,
} from "@/i18n/locale-meta";

// Refresh cooldown duration in milliseconds (5 minutes)
export const REFRESH_COOLDOWN_MS = 300_000;

// Spec: persist plugin order + disabled list; new plugins append, default disabled unless in DEFAULT_ENABLED_PLUGINS.
export type ProviderInstanceSettings = {
  baseProviderId: string;
  label: string;
};

export type PluginSettings = {
  order: string[];
  disabled: string[];
  trayLines?: Record<string, string[]>;
  providerInstances?: Record<string, ProviderInstanceSettings>;
};

export type AutoUpdateIntervalMinutes = 5 | 15 | 30 | 60;

export type ThemeMode = "system" | "light" | "dark" | "glass";

export type DisplayMode = "used" | "left";

export type ResetTimerDisplayMode = "relative" | "absolute";

export type TimeFormatMode = "auto" | "12h" | "24h";

export type { AppLocale, DisplayCurrency, DisplayCurrencyCode, SupportedUiLocale };
export {
  DEFAULT_APP_LOCALE,
  DEFAULT_DISPLAY_CURRENCY,
  SUPPORTED_DISPLAY_CURRENCIES,
  SUPPORTED_UI_LOCALES,
  UI_LOCALE_LABELS,
} from "@/i18n/locale-meta";

export type MenubarIconStyle = "provider" | "logoBar" | "logoGrid" | "bars" | "donut";

export type UILayout = "classic" | "modern";

export type ModernDensity = "regular" | "compact";

export type GlobalShortcut = string | null;

export type UsageAlertThreshold = 10 | 20 | 30 | "custom";

export type UsageAlertSound =
  | "Basso"
  | "Ping"
  | "Funk"
  | "Frog"
  | "Tink"
  | "Pop"
  | "Bottle"
  | "Blow"
  | "Glass"
  | "Hero"
  | "Morse"
  | "Purr"
  | "Submarine"
  | "Sosumi";

const SETTINGS_STORE_PATH = "settings.json";
const PLUGIN_SETTINGS_KEY = "plugins";
const AUTO_UPDATE_SETTINGS_KEY = "autoUpdateInterval";
const THEME_MODE_KEY = "themeMode";
const DISPLAY_MODE_KEY = "displayMode";
const RESET_TIMER_DISPLAY_MODE_KEY = "resetTimerDisplayMode";
const TIME_FORMAT_MODE_KEY = "timeFormatMode";
const APP_LOCALE_KEY = "appLocale";
const DISPLAY_CURRENCY_KEY = "displayCurrency";
const MENUBAR_ICON_STYLE_KEY = "menubarIconStyle";
const PREFER_MENUBAR_WEEKLY_LIMIT_KEY = "preferMenubarWeeklyLimit";
const LEGACY_TRAY_ICON_STYLE_KEY = "trayIconStyle";
const LEGACY_TRAY_SHOW_PERCENTAGE_KEY = "trayShowPercentage";
const GLOBAL_SHORTCUT_KEY = "globalShortcut";
const START_ON_LOGIN_KEY = "startOnLogin";
export const USAGE_ALERT_ENABLED_KEY = "usageAlertEnabled";
export const USAGE_ALERT_THRESHOLD_KEY = "usageAlertThreshold";
export const USAGE_ALERT_CUSTOM_THRESHOLD_KEY = "usageAlertCustomThreshold";
export const USAGE_ALERT_SOUND_KEY = "usageAlertSound";
export const USAGE_PACE_ALERT_ENABLED_KEY = "usagePaceAlertEnabled";
export const USAGE_SPIKE_ALERT_ENABLED_KEY = "usageSpikeAlertEnabled";
export const USAGE_SPIKE_ALERT_THRESHOLD_PCT_KEY = "usageSpikeAlertThresholdPct";

const UI_SCALE_KEY = "uiScale";
const REDUCE_ANIMATIONS_KEY = "reduceAnimations";
const SHOW_TRAY_ICON_KEY = "showTrayIcon";
const SHOW_TRAY_INSIGHT_KEY = "showTrayInsight";
const SHOW_TOTAL_SPEND_KEY = "showTotalSpend";
const TOTAL_SPEND_METRIC_KEY = "totalSpendMetric";
const SHOW_ACCOUNT_IDENTITY_KEY = "showAccountIdentity";
const PERSIST_USAGE_HISTORY_KEY = "persistUsageHistory";
const USAGE_HISTORY_RETENTION_DAYS_KEY = "usageHistoryRetentionDays";
const ONBOARDING_COMPLETE_V1_KEY = "onboardingCompleteV1";
/** App version string when user last completed the dual-UI onboarding wizard. */
const DUAL_UI_ONBOARDING_VERSION_KEY = "dualUiOnboardingVersion";
const UI_LAYOUT_KEY = "uiLayout";
const MODERN_LAYOUT_KEY = "modernLayout";
const MODERN_DENSITY_KEY = "modernDensity";

export const DEFAULT_AUTO_UPDATE_INTERVAL: AutoUpdateIntervalMinutes = 15;
export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_DISPLAY_MODE: DisplayMode = "left";
export const DEFAULT_RESET_TIMER_DISPLAY_MODE: ResetTimerDisplayMode = "relative";
export const DEFAULT_TIME_FORMAT_MODE: TimeFormatMode = "auto";
/** Default tray appearance for new installs and store reset (Plugin / provider style). */
export const DEFAULT_MENUBAR_ICON_STYLE: MenubarIconStyle = "provider";
export const DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT = false;
export const DEFAULT_GLOBAL_SHORTCUT: GlobalShortcut = null;
export const DEFAULT_START_ON_LOGIN = false;
export const DEFAULT_USAGE_ALERT_ENABLED = false;
export const DEFAULT_USAGE_ALERT_THRESHOLD: UsageAlertThreshold = 20;
export const DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD: number | null = null;
export const DEFAULT_USAGE_ALERT_SOUND: UsageAlertSound = "Basso";
export const DEFAULT_USAGE_PACE_ALERT_ENABLED = true;
export type UsageSpikeAlertThresholdPct = 25 | 50 | 100;
export const DEFAULT_USAGE_SPIKE_ALERT_ENABLED = false;
export const DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT: UsageSpikeAlertThresholdPct = 50;

export type UIScale = "normal" | "small" | "compact";
export const DEFAULT_UI_SCALE: UIScale = "normal";
export const DEFAULT_REDUCE_ANIMATIONS = false;
const UI_SCALE_VALUES: UIScale[] = ["normal", "small", "compact"];
export const UI_SCALE_OPTIONS: { value: UIScale; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "small", label: "Small" },
  { value: "compact", label: "Compact" },
];

export const UI_LAYOUT_OPTIONS: { value: UILayout; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "modern", label: "Modern" },
];

export const MODERN_DENSITY_OPTIONS: { value: ModernDensity; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "compact", label: "Compact" },
];

export const DEFAULT_SHOW_TRAY_ICON = true;
export const DEFAULT_SHOW_TRAY_INSIGHT = true;
export const DEFAULT_SHOW_TOTAL_SPEND = true;
export const DEFAULT_TOTAL_SPEND_METRIC = "apiSpend";
export const DEFAULT_UI_LAYOUT: UILayout = "classic";
export const DEFAULT_MODERN_DENSITY: ModernDensity = "regular";
export const DEFAULT_SHOW_ACCOUNT_IDENTITY = true;
/** `0` = keep forever (row cap still applies in SQLite). */
export const DEFAULT_USAGE_HISTORY_RETENTION_DAYS = 90;
export const USAGE_HISTORY_RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: 0, label: "Forever" },
];

const AUTO_UPDATE_INTERVALS: AutoUpdateIntervalMinutes[] = [5, 15, 30, 60];
const THEME_MODES: ThemeMode[] = ["system", "light", "dark", "glass"];
const DISPLAY_MODES: DisplayMode[] = ["used", "left"];
const RESET_TIMER_DISPLAY_MODES: ResetTimerDisplayMode[] = ["relative", "absolute"];
const TIME_FORMAT_MODES: TimeFormatMode[] = ["auto", "12h", "24h"];
const MENUBAR_ICON_STYLES: MenubarIconStyle[] = [
  "provider",
  "logoBar",
  "logoGrid",
  "donut",
  "bars",
];
const USAGE_ALERT_SOUNDS: UsageAlertSound[] = [
  "Basso",
  "Ping",
  "Funk",
  "Frog",
  "Tink",
  "Pop",
  "Bottle",
  "Blow",
  "Glass",
  "Hero",
  "Morse",
  "Purr",
  "Submarine",
  "Sosumi",
];

export const USAGE_ALERT_THRESHOLD_OPTIONS: { value: UsageAlertThreshold; label: string }[] = [
  { value: 10, label: "10%" },
  { value: 20, label: "20%" },
  { value: 30, label: "30%" },
  { value: "custom", label: "Custom" },
];

export const USAGE_ALERT_SOUND_OPTIONS: { value: UsageAlertSound; label: string }[] =
  USAGE_ALERT_SOUNDS.map((value) => ({ value, label: value }));

export const MENUBAR_ICON_STYLE_OPTIONS: { value: MenubarIconStyle; label: string }[] = [
  { value: "provider", label: "Logo + %" },
  { value: "logoBar", label: "Logo fill" },
  { value: "logoGrid", label: "All logos" },
  { value: "donut", label: "Pie chart" },
  { value: "bars", label: "Battery bars" },
];

export const AUTO_UPDATE_OPTIONS: { value: AutoUpdateIntervalMinutes; label: string }[] =
  AUTO_UPDATE_INTERVALS.map((value) => ({
    value,
    label: value === 60 ? "1 hour" : `${value} min`,
  }));

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] =
  THEME_MODES.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));

export const DISPLAY_MODE_OPTIONS: { value: DisplayMode; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "used", label: "Used" },
];

export const RESET_TIMER_DISPLAY_OPTIONS: { value: ResetTimerDisplayMode; label: string }[] = [
  { value: "relative", label: "Relative" },
  { value: "absolute", label: "Absolute" },
];

export const TIME_FORMAT_OPTIONS: { value: TimeFormatMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "12h", label: "12-hour" },
  { value: "24h", label: "24-hour" },
];

const store = new LazyStore(SETTINGS_STORE_PATH);

const DEFAULT_ENABLED_PLUGINS = new Set(["claude", "codex", "cursor"]);

export { DEFAULT_ENABLED_PLUGINS };

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  order: [],
  disabled: [],
  trayLines: {},
  providerInstances: {},
};

export async function loadPluginSettings(): Promise<PluginSettings> {
  const stored = await store.get<PluginSettings>(PLUGIN_SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_PLUGIN_SETTINGS };
  return {
    order: Array.isArray(stored.order) ? stored.order : [],
    disabled: Array.isArray(stored.disabled) ? stored.disabled : [],
    trayLines: stored.trayLines && typeof stored.trayLines === "object" ? stored.trayLines : {},
    providerInstances:
      stored.providerInstances && typeof stored.providerInstances === "object"
        ? stored.providerInstances
        : {},
  };
}

export async function savePluginSettings(settings: PluginSettings): Promise<void> {
  await store.set(PLUGIN_SETTINGS_KEY, settings);
  await store.save();
}

// TODO(remove after 2026-09-01): One-time Windsurf -> Devin settings migration.
export function migrateWindsurfToDevin(settings: PluginSettings): PluginSettings {
  const hasDevin = settings.order.includes("devin");
  const hasWindsurf = settings.order.includes("windsurf");
  const windsurfWasDisabled = settings.disabled.includes("windsurf");
  const order = Array.from(
    new Set(settings.order.map((id) => (id === "windsurf" ? "devin" : id)))
  );
  let disabled = settings.disabled.filter((id) => id !== "windsurf");

  if (hasWindsurf && !windsurfWasDisabled) {
    disabled = disabled.filter((id) => id !== "devin");
  }

  if (!hasDevin && windsurfWasDisabled && !disabled.includes("devin")) {
    disabled.push("devin");
  }

  return {
    order,
    disabled: Array.from(new Set(disabled)),
  };
}

function isAutoUpdateInterval(value: unknown): value is AutoUpdateIntervalMinutes {
  return (
    typeof value === "number" &&
    AUTO_UPDATE_INTERVALS.includes(value as AutoUpdateIntervalMinutes)
  );
}

export async function loadAutoUpdateInterval(): Promise<AutoUpdateIntervalMinutes> {
  const stored = await store.get<unknown>(AUTO_UPDATE_SETTINGS_KEY);
  if (isAutoUpdateInterval(stored)) return stored;
  return DEFAULT_AUTO_UPDATE_INTERVAL;
}

export async function saveAutoUpdateInterval(
  interval: AutoUpdateIntervalMinutes
): Promise<void> {
  await store.set(AUTO_UPDATE_SETTINGS_KEY, interval);
  await store.save();
}

export function normalizePluginSettings(
  settings: PluginSettings,
  plugins: PluginMeta[]
): PluginSettings {
  const knownBaseIds = plugins.map((plugin) => plugin.id);
  const knownBaseSet = new Set(knownBaseIds);

  const providerInstances: Record<string, ProviderInstanceSettings> = {};
  for (const [instanceId, instance] of Object.entries(settings.providerInstances ?? {})) {
    const id = instanceId.trim();
    const baseProviderId = instance?.baseProviderId?.trim();
    if (!id || !baseProviderId || !knownBaseSet.has(baseProviderId)) continue;
    if (knownBaseSet.has(id) && id !== baseProviderId) continue;
    const label = instance.label?.trim() || defaultProviderInstanceLabel(baseProviderId, id);
    providerInstances[id] = { baseProviderId, label };
  }

  const knownInstanceIds = new Set<string>(knownBaseIds);
  for (const instanceId of Object.keys(providerInstances)) {
    knownInstanceIds.add(instanceId);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of settings.order) {
    if (!knownInstanceIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const newlyAdded: string[] = [];
  for (const id of knownBaseIds) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
      newlyAdded.push(id);
    }
  }
  for (const id of Object.keys(providerInstances).sort()) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
      newlyAdded.push(id);
    }
  }

  const disabled = settings.disabled.filter((id) => knownInstanceIds.has(id));
  for (const id of newlyAdded) {
    const baseProviderId = getBaseProviderId(id, { ...settings, providerInstances });
    if (!DEFAULT_ENABLED_PLUGINS.has(baseProviderId) && !disabled.includes(id)) {
      disabled.push(id);
    }
  }
  const trayLines = { ...(settings.trayLines ?? {}) };
  for (const key in trayLines) {
    if (!knownInstanceIds.has(key)) {
      delete trayLines[key];
      continue;
    }
    const lines = trayLines[key];
    if (!Array.isArray(lines)) {
      delete trayLines[key];
      continue;
    }
    // Fix corrupted state: ['__NONE__', 'Credits'] kept trayLines[0] === '__NONE__' and broke Settings UI
    const real = lines.filter((l) => l !== "__NONE__");
    if (real.length > 0) {
      trayLines[key] = real;
    } else if (lines.includes("__NONE__")) {
      trayLines[key] = ["__NONE__"];
    }
    const normalizedLines = trayLines[key];
    if (
      Array.isArray(normalizedLines) &&
      normalizedLines[0] !== "__NONE__"
    ) {
      trayLines[key] = [
        ...new Set(
          normalizedLines.map((l) =>
            l === "All usage" || l === "Total usage" ? "Total usage" : l
          )
        ),
      ];
    }
    // Migrate old Antigravity line labels to new overview equivalents
    const migratedLines = trayLines[key];
    if (Array.isArray(migratedLines) && migratedLines[0] !== "__NONE__") {
      trayLines[key] = [
        ...new Set(
          migratedLines.map((l) =>
            migrateCursorLineLabel(key, migrateAntigravityLineLabel(key, l)),
          )
        ),
      ];
    }
  }

  const sortedOrder = sortPluginOrderAlphabetically(
    order,
    { providerInstances },
    plugins
  );

  return { order: sortedOrder, disabled, trayLines, providerInstances };
}

/**
 * Base plugin ids present in `plugins` but missing from stored `order`
 * (e.g. newly bundled after an app update). Used for #838-style notify-once UX.
 */
export function listNewlyBundledPluginIds(
  storedOrder: string[],
  plugins: PluginMeta[],
): string[] {
  const seen = new Set(storedOrder.map((id) => id.trim()).filter(Boolean));
  return plugins.map((p) => p.id).filter((id) => id && !seen.has(id));
}

/** On first-run onboarding, enable starter trio + any provider that already probed successfully. */
export function enableDetectedProvidersOnOnboarding(
  settings: PluginSettings,
  pluginStates: Record<string, { data?: unknown; error?: string | null } | undefined>,
): PluginSettings {
  const toEnable = new Set<string>()
  for (const id of settings.order) {
    const baseId = getBaseProviderId(id, settings)
    if (DEFAULT_ENABLED_PLUGINS.has(baseId)) {
      toEnable.add(id)
      continue
    }
    const state = pluginStates[id]
    if (state?.data && !state?.error) {
      toEnable.add(id)
    }
  }
  return {
    ...settings,
    disabled: settings.disabled.filter((id) => !toEnable.has(id)),
  }
}

export function arePluginSettingsEqual(
  a: PluginSettings,
  b: PluginSettings
): boolean {
  if (a.order.length !== b.order.length) return false;
  if (a.disabled.length !== b.disabled.length) return false;
  for (let i = 0; i < a.order.length; i += 1) {
    if (a.order[i] !== b.order[i]) return false;
  }
  for (let i = 0; i < a.disabled.length; i += 1) {
    if (a.disabled[i] !== b.disabled[i]) return false;
  }

  const aLines = a.trayLines || {};
  const bLines = b.trayLines || {};
  const aKeys = Object.keys(aLines);
  const bKeys = Object.keys(bLines);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bLines, key)) return false;
    const aArr = aLines[key] || [];
    const bArr = bLines[key] || [];
    if (aArr.length !== bArr.length) return false;
    for (let i = 0; i < aArr.length; i += 1) {
      if (aArr[i] !== bArr[i]) return false;
    }
  }

  const aInstances = a.providerInstances || {};
  const bInstances = b.providerInstances || {};
  const aInstanceKeys = Object.keys(aInstances).sort();
  const bInstanceKeys = Object.keys(bInstances).sort();
  if (aInstanceKeys.length !== bInstanceKeys.length) return false;
  for (let i = 0; i < aInstanceKeys.length; i += 1) {
    if (aInstanceKeys[i] !== bInstanceKeys[i]) return false;
    const key = aInstanceKeys[i];
    if (aInstances[key]?.baseProviderId !== bInstances[key]?.baseProviderId) return false;
    if (aInstances[key]?.label !== bInstances[key]?.label) return false;
  }

  return true;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export async function loadThemeMode(): Promise<ThemeMode> {
  const stored = await store.get<unknown>(THEME_MODE_KEY);
  if (isThemeMode(stored)) return stored;
  return DEFAULT_THEME_MODE;
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await store.set(THEME_MODE_KEY, mode);
  await store.save();
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === "string" && DISPLAY_MODES.includes(value as DisplayMode);
}

export async function loadDisplayMode(): Promise<DisplayMode> {
  const stored = await store.get<unknown>(DISPLAY_MODE_KEY);
  if (isDisplayMode(stored)) return stored;
  return DEFAULT_DISPLAY_MODE;
}

export async function saveDisplayMode(mode: DisplayMode): Promise<void> {
  await store.set(DISPLAY_MODE_KEY, mode);
  await store.save();
}

function isResetTimerDisplayMode(value: unknown): value is ResetTimerDisplayMode {
  return (
    typeof value === "string" &&
    RESET_TIMER_DISPLAY_MODES.includes(value as ResetTimerDisplayMode)
  );
}

export async function loadResetTimerDisplayMode(): Promise<ResetTimerDisplayMode> {
  const stored = await store.get<unknown>(RESET_TIMER_DISPLAY_MODE_KEY);
  if (isResetTimerDisplayMode(stored)) return stored;
  return DEFAULT_RESET_TIMER_DISPLAY_MODE;
}

export async function saveResetTimerDisplayMode(mode: ResetTimerDisplayMode): Promise<void> {
  await store.set(RESET_TIMER_DISPLAY_MODE_KEY, mode);
  await store.save();
}

function isTimeFormatMode(value: unknown): value is TimeFormatMode {
  return (
    typeof value === "string" &&
    TIME_FORMAT_MODES.includes(value as TimeFormatMode)
  );
}

export async function loadTimeFormatMode(): Promise<TimeFormatMode> {
  const stored = await store.get<unknown>(TIME_FORMAT_MODE_KEY);
  if (isTimeFormatMode(stored)) return stored;
  return DEFAULT_TIME_FORMAT_MODE;
}

export async function saveTimeFormatMode(mode: TimeFormatMode): Promise<void> {
  await store.set(TIME_FORMAT_MODE_KEY, mode);
  await store.save();
}

function isAppLocale(value: unknown): value is AppLocale {
  return value === "auto" || (typeof value === "string" && SUPPORTED_UI_LOCALES.includes(value as SupportedUiLocale));
}

export async function loadAppLocale(): Promise<AppLocale> {
  const stored = await store.get<unknown>(APP_LOCALE_KEY);
  if (isAppLocale(stored)) return stored;
  return DEFAULT_APP_LOCALE;
}

export async function saveAppLocale(locale: AppLocale): Promise<void> {
  await store.set(APP_LOCALE_KEY, locale);
  await store.save();
}

function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return (
    value === "auto" ||
    (typeof value === "string" && SUPPORTED_DISPLAY_CURRENCIES.includes(value as DisplayCurrencyCode))
  );
}

export async function loadDisplayCurrency(): Promise<DisplayCurrency> {
  const stored = await store.get<unknown>(DISPLAY_CURRENCY_KEY);
  if (isDisplayCurrency(stored)) return stored;
  return DEFAULT_DISPLAY_CURRENCY;
}

export async function saveDisplayCurrency(currency: DisplayCurrency): Promise<void> {
  await store.set(DISPLAY_CURRENCY_KEY, currency);
  await store.save();
}

function isMenubarIconStyle(value: unknown): value is MenubarIconStyle {
  return (
    typeof value === "string" &&
    MENUBAR_ICON_STYLES.includes(value as MenubarIconStyle)
  );
}

export async function loadMenubarIconStyle(): Promise<MenubarIconStyle> {
  const stored = await store.get<unknown>(MENUBAR_ICON_STYLE_KEY);
  if (isMenubarIconStyle(stored)) return stored;
  return DEFAULT_MENUBAR_ICON_STYLE;
}

export async function saveMenubarIconStyle(style: MenubarIconStyle): Promise<void> {
  await store.set(MENUBAR_ICON_STYLE_KEY, style);
  await store.save();
}

export async function loadPreferMenubarWeeklyLimit(): Promise<boolean> {
  const stored = await store.get<unknown>(PREFER_MENUBAR_WEEKLY_LIMIT_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT;
}

export async function savePreferMenubarWeeklyLimit(value: boolean): Promise<void> {
  await store.set(PREFER_MENUBAR_WEEKLY_LIMIT_KEY, value);
  await store.save();
}

type LegacyStoreWithDelete = {
  delete?: (key: string) => Promise<void>;
};

async function deleteStoreKey(key: string): Promise<void> {
  const maybeDelete = (store as unknown as LegacyStoreWithDelete).delete;
  if (typeof maybeDelete === "function") {
    await maybeDelete.call(store, key);
    return;
  }
  // Fallback for store implementations without delete support.
  await store.set(key, null);
}

export async function migrateLegacyTraySettings(): Promise<void> {
  const [legacyTrayStyle, legacyShowPercentage, currentMenubarStyle] = await Promise.all([
    store.get<unknown>(LEGACY_TRAY_ICON_STYLE_KEY),
    store.get<unknown>(LEGACY_TRAY_SHOW_PERCENTAGE_KEY),
    store.get<unknown>(MENUBAR_ICON_STYLE_KEY),
  ]);

  const hasLegacyTrayStyle = legacyTrayStyle != null;
  const hasLegacyShowPercentage = legacyShowPercentage != null;
  if (!hasLegacyTrayStyle && !hasLegacyShowPercentage) return;

  if (hasLegacyTrayStyle && currentMenubarStyle == null) {
    if (legacyTrayStyle === "bars") {
      await store.set(MENUBAR_ICON_STYLE_KEY, "bars");
    } else if (legacyTrayStyle === "circle") {
      await store.set(MENUBAR_ICON_STYLE_KEY, "donut");
    }
  }

  const removals: Promise<void>[] = [];
  if (hasLegacyTrayStyle) removals.push(deleteStoreKey(LEGACY_TRAY_ICON_STYLE_KEY));
  if (hasLegacyShowPercentage) removals.push(deleteStoreKey(LEGACY_TRAY_SHOW_PERCENTAGE_KEY));
  await Promise.all(removals);
  await store.save();
}

export function getEnabledPluginIds(settings: PluginSettings): string[] {
  const disabledSet = new Set(settings.disabled);
  return settings.order.filter((id) => !disabledSet.has(id));
}

export function getBaseProviderId(instanceId: string, settings: PluginSettings | null): string {
  return settings?.providerInstances?.[instanceId]?.baseProviderId ?? instanceId;
}

export function getProviderInstanceLabel(instanceId: string, settings: PluginSettings | null): string | null {
  return settings?.providerInstances?.[instanceId]?.label ?? null;
}

export function getProviderDisplayName(
  instanceId: string,
  settings: PluginSettings | null,
  plugins: PluginMeta[]
): string {
  const baseProviderId = getBaseProviderId(instanceId, settings);
  const baseName = plugins.find((plugin) => plugin.id === baseProviderId)?.name ?? baseProviderId;
  const label = getProviderInstanceLabel(instanceId, settings);
  if (!label || instanceId === baseProviderId) return baseName;
  return `${baseName} (${label})`;
}

export function getProviderInstanceMeta(
  instanceId: string,
  settings: PluginSettings | null,
  plugins: PluginMeta[]
): PluginMeta | null {
  const baseProviderId = getBaseProviderId(instanceId, settings);
  const base = plugins.find((plugin) => plugin.id === baseProviderId);
  if (!base) return null;
  const label = getProviderInstanceLabel(instanceId, settings) ?? undefined;
  return {
    ...base,
    id: instanceId,
    baseProviderId,
    instanceLabel: label,
    name: getProviderDisplayName(instanceId, settings, plugins),
  };
}

export function getProbeTargets(
  instanceIds: string[] | undefined,
  settings: PluginSettings | null
): ProbeTarget[] | undefined {
  if (!settings) return undefined;
  const ids = instanceIds ?? getEnabledPluginIds(settings);
  return ids.map((instanceId) => {
    const baseProviderId = getBaseProviderId(instanceId, settings);
    const label = getProviderInstanceLabel(instanceId, settings) ?? undefined;
    return { instanceId, baseProviderId, label };
  });
}

export function buildProviderInstanceId(baseProviderId: string, label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = slug || `account-${Date.now().toString(36)}`;
  return `${baseProviderId}:${suffix}`;
}

function defaultProviderInstanceLabel(baseProviderId: string, instanceId: string): string {
  if (instanceId === baseProviderId) return "";
  const suffix = instanceId.startsWith(`${baseProviderId}:`)
    ? instanceId.slice(baseProviderId.length + 1)
    : instanceId;
  return suffix || "Account";
}

/** Provider list order: A–Z by base provider, account instances grouped under their base. */
export function sortPluginOrderAlphabetically(
  order: string[],
  settings: Pick<PluginSettings, "providerInstances">,
  plugins: PluginMeta[],
): string[] {
  const partialSettings = {
    order,
    disabled: [],
    trayLines: {},
    providerInstances: settings.providerInstances ?? {},
  } satisfies PluginSettings;

  const bases = new Set<string>()
  for (const id of order) {
    bases.add(getBaseProviderId(id, partialSettings))
  }
  for (const plugin of plugins) {
    bases.add(plugin.id)
  }

  const sortedBases = [...bases].sort((a, b) => {
    const nameA = plugins.find((plugin) => plugin.id === a)?.name ?? a
    const nameB = plugins.find((plugin) => plugin.id === b)?.name ?? b
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" })
  })

  const result: string[] = []
  const seen = new Set<string>()
  for (const base of sortedBases) {
    const members = order.filter(
      (id) => getBaseProviderId(id, partialSettings) === base && !seen.has(id),
    )
    const baseEntry = members.find((id) => id === base)
    const instances = members
      .filter((id) => id !== base)
      .sort((a, b) =>
        getProviderDisplayName(a, partialSettings, plugins).localeCompare(
          getProviderDisplayName(b, partialSettings, plugins),
          undefined,
          { sensitivity: "base" },
        ),
      )
    if (baseEntry) {
      seen.add(baseEntry)
      result.push(baseEntry)
    }
    for (const instance of instances) {
      seen.add(instance)
      result.push(instance)
    }
  }
  for (const id of order) {
    if (!seen.has(id)) result.push(id)
  }
  return result
}

export function insertProviderInstanceInOrder(
  order: string[],
  instanceId: string,
  baseProviderId: string,
  settings: PluginSettings | null,
): string[] {
  if (order.includes(instanceId)) return order
  const baseIndex = order.indexOf(baseProviderId)
  if (baseIndex === -1) return [...order, instanceId]

  let insertAt = baseIndex + 1
  while (insertAt < order.length) {
    const candidate = order[insertAt]
    if (getBaseProviderId(candidate, settings) === baseProviderId) {
      insertAt += 1
      continue
    }
    break
  }

  const next = [...order]
  next.splice(insertAt, 0, instanceId)
  return next
}

export type StoredProviderAccountSummary = {
  instanceId: string
  baseProviderId: string
  label: string
}

/** Reconcile plugin settings with persisted provider_accounts.json on startup. */
export function mergeStoredProviderAccounts(
  settings: PluginSettings,
  accounts: StoredProviderAccountSummary[],
  plugins: PluginMeta[],
): PluginSettings {
  if (accounts.length === 0) return settings

  let order = [...settings.order]
  const providerInstances = { ...(settings.providerInstances ?? {}) }
  let changed = false

  for (const account of accounts) {
    const instanceId = account.instanceId?.trim()
    const baseProviderId = account.baseProviderId?.trim()
    const label = account.label?.trim()
    if (!instanceId || !baseProviderId || !label) continue

    const existing = providerInstances[instanceId]
    if (
      !existing ||
      existing.baseProviderId !== baseProviderId ||
      existing.label !== label
    ) {
      providerInstances[instanceId] = { baseProviderId, label }
      changed = true
    }
    if (!order.includes(instanceId)) {
      order = insertProviderInstanceInOrder(order, instanceId, baseProviderId, {
        ...settings,
        order,
        providerInstances,
      })
      changed = true
    }
  }

  if (!changed) return settings
  return normalizePluginSettings({ ...settings, order, providerInstances }, plugins)
}

function isGlobalShortcut(value: unknown): value is GlobalShortcut {
  if (value === null) return true;
  return typeof value === "string";
}

export async function loadGlobalShortcut(): Promise<GlobalShortcut> {
  const stored = await store.get<unknown>(GLOBAL_SHORTCUT_KEY);
  if (isGlobalShortcut(stored)) return stored;
  return DEFAULT_GLOBAL_SHORTCUT;
}

export async function saveGlobalShortcut(shortcut: GlobalShortcut): Promise<void> {
  await store.set(GLOBAL_SHORTCUT_KEY, shortcut);
  await store.save();
}

export async function loadStartOnLogin(): Promise<boolean> {
  const stored = await store.get<unknown>(START_ON_LOGIN_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_START_ON_LOGIN;
}

export async function saveStartOnLogin(value: boolean): Promise<void> {
  await store.set(START_ON_LOGIN_KEY, value);
  await store.save();
}

export function isUsageAlertThreshold(value: unknown): value is UsageAlertThreshold {
  return value === "custom" || (typeof value === "number" && [10, 20, 30].includes(value));
}

function isUsageAlertSound(value: unknown): value is UsageAlertSound {
  return typeof value === "string" && USAGE_ALERT_SOUNDS.includes(value as UsageAlertSound);
}

export async function loadUsageAlertEnabled(): Promise<boolean> {
  const stored = await store.get<unknown>(USAGE_ALERT_ENABLED_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_USAGE_ALERT_ENABLED;
}

export async function saveUsageAlertEnabled(value: boolean): Promise<void> {
  await store.set(USAGE_ALERT_ENABLED_KEY, value);
  await store.save();
}

export async function loadUsageAlertThreshold(): Promise<UsageAlertThreshold> {
  const stored = await store.get<unknown>(USAGE_ALERT_THRESHOLD_KEY);
  if (isUsageAlertThreshold(stored)) return stored;
  return DEFAULT_USAGE_ALERT_THRESHOLD;
}

export async function saveUsageAlertThreshold(value: UsageAlertThreshold): Promise<void> {
  await store.set(USAGE_ALERT_THRESHOLD_KEY, value);
  await store.save();
}

export async function loadUsageAlertCustomThreshold(): Promise<number | null> {
  const stored = await store.get<unknown>(USAGE_ALERT_CUSTOM_THRESHOLD_KEY);
  if (typeof stored === "number" && Number.isFinite(stored)) {
    if (stored < 1 || stored > 99) return DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD;
    return stored;
  }
  return DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD;
}

export async function saveUsageAlertCustomThreshold(value: number | null): Promise<void> {
  if (value == null) {
    await deleteStoreKey(USAGE_ALERT_CUSTOM_THRESHOLD_KEY);
    await store.save();
    return;
  }
  const clamped = Math.max(1, Math.min(99, Math.round(value)));
  await store.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, clamped);
  await store.save();
}

export async function loadUsageAlertSound(): Promise<UsageAlertSound> {
  const stored = await store.get<unknown>(USAGE_ALERT_SOUND_KEY);
  if (isUsageAlertSound(stored)) return stored;
  return DEFAULT_USAGE_ALERT_SOUND;
}

export async function saveUsageAlertSound(value: UsageAlertSound): Promise<void> {
  await store.set(USAGE_ALERT_SOUND_KEY, value);
  await store.save();
}

export async function loadUsagePaceAlertEnabled(): Promise<boolean> {
  const stored = await store.get<unknown>(USAGE_PACE_ALERT_ENABLED_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_USAGE_PACE_ALERT_ENABLED;
}

export async function saveUsagePaceAlertEnabled(value: boolean): Promise<void> {
  await store.set(USAGE_PACE_ALERT_ENABLED_KEY, value);
  await store.save();
}

export function isUsageSpikeAlertThresholdPct(
  value: unknown,
): value is UsageSpikeAlertThresholdPct {
  return value === 25 || value === 50 || value === 100;
}

export async function loadUsageSpikeAlertEnabled(): Promise<boolean> {
  const stored = await store.get<unknown>(USAGE_SPIKE_ALERT_ENABLED_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_USAGE_SPIKE_ALERT_ENABLED;
}

export async function saveUsageSpikeAlertEnabled(value: boolean): Promise<void> {
  await store.set(USAGE_SPIKE_ALERT_ENABLED_KEY, value);
  await store.save();
}

export async function loadUsageSpikeAlertThresholdPct(): Promise<UsageSpikeAlertThresholdPct> {
  const stored = await store.get<unknown>(USAGE_SPIKE_ALERT_THRESHOLD_PCT_KEY);
  if (isUsageSpikeAlertThresholdPct(stored)) return stored;
  return DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT;
}

export async function saveUsageSpikeAlertThresholdPct(
  value: UsageSpikeAlertThresholdPct,
): Promise<void> {
  await store.set(USAGE_SPIKE_ALERT_THRESHOLD_PCT_KEY, value);
  await store.save();
}

export function isUIScale(value: unknown): value is UIScale {
  return typeof value === "string" && UI_SCALE_VALUES.includes(value as UIScale);
}

export async function loadUIScale(): Promise<UIScale> {
  const stored = await store.get<unknown>(UI_SCALE_KEY);
  if (isUIScale(stored)) return stored;
  return DEFAULT_UI_SCALE;
}

export async function saveUIScale(value: UIScale): Promise<void> {
  await store.set(UI_SCALE_KEY, value);
  await store.save();
}

export async function loadReduceAnimations(): Promise<boolean> {
  const stored = await store.get<unknown>(REDUCE_ANIMATIONS_KEY);
  return typeof stored === "boolean" ? stored : DEFAULT_REDUCE_ANIMATIONS;
}

export async function saveReduceAnimations(value: boolean): Promise<void> {
  await store.set(REDUCE_ANIMATIONS_KEY, value);
  await store.save();
}

export async function loadShowTrayIcon(): Promise<boolean> {
  const stored = await store.get<unknown>(SHOW_TRAY_ICON_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_SHOW_TRAY_ICON;
}

export async function saveShowTrayIcon(value: boolean): Promise<void> {
  await store.set(SHOW_TRAY_ICON_KEY, value);
  await store.save();
}

export async function loadShowTrayInsight(): Promise<boolean> {
  const stored = await store.get<unknown>(SHOW_TRAY_INSIGHT_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_SHOW_TRAY_INSIGHT;
}

export async function saveShowTrayInsight(value: boolean): Promise<void> {
  await store.set(SHOW_TRAY_INSIGHT_KEY, value);
  await store.save();
}

export async function loadShowTotalSpend(): Promise<boolean> {
  const stored = await store.get<unknown>(SHOW_TOTAL_SPEND_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_SHOW_TOTAL_SPEND;
}

export async function saveShowTotalSpend(value: boolean): Promise<void> {
  await store.set(SHOW_TOTAL_SPEND_KEY, value);
  await store.save();
}

export async function loadTotalSpendMetric(): Promise<string> {
  const stored = await store.get<unknown>(TOTAL_SPEND_METRIC_KEY);
  if (stored === "apiSpend" || stored === "costPerMtok" || stored === "tokens") {
    return stored;
  }
  return DEFAULT_TOTAL_SPEND_METRIC;
}

export async function saveTotalSpendMetric(value: string): Promise<void> {
  await store.set(TOTAL_SPEND_METRIC_KEY, value);
  await store.save();
}

export async function loadShowAccountIdentity(): Promise<boolean> {
  const stored = await store.get<unknown>(SHOW_ACCOUNT_IDENTITY_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_SHOW_ACCOUNT_IDENTITY;
}

export async function saveShowAccountIdentity(value: boolean): Promise<void> {
  await store.set(SHOW_ACCOUNT_IDENTITY_KEY, value);
  await store.save();
}

/** When true, successful probes write normalized snapshots to local SQLite. */
export async function loadPersistUsageHistory(): Promise<boolean> {
  const stored = await store.get<unknown>(PERSIST_USAGE_HISTORY_KEY);
  return typeof stored === "boolean" ? stored : false;
}

export async function savePersistUsageHistory(value: boolean): Promise<void> {
  await store.set(PERSIST_USAGE_HISTORY_KEY, value);
  await store.save();
}

export async function loadUsageHistoryRetentionDays(): Promise<number> {
  const stored = await store.get<unknown>(USAGE_HISTORY_RETENTION_DAYS_KEY);
  if (typeof stored === "number" && Number.isFinite(stored) && stored >= 0) {
    return stored;
  }
  return DEFAULT_USAGE_HISTORY_RETENTION_DAYS;
}

export async function saveUsageHistoryRetentionDays(value: number): Promise<void> {
  await store.set(USAGE_HISTORY_RETENTION_DAYS_KEY, value);
  await store.save();
}

/**
 * Whether to skip the onboarding wizard.
 * Show wizard when `dualUiOnboardingVersion` !== current app version (first install or after update).
 * Settings.json is preserved — only the version key is written on completion.
 */
export async function resolveOnboardingComplete(
  _storedPluginSettings: PluginSettings,
  appVersion: string,
): Promise<boolean> {
  const seenVersion = await store.get<unknown>(DUAL_UI_ONBOARDING_VERSION_KEY);
  if (typeof seenVersion === "string" && seenVersion === appVersion) {
    return true;
  }
  return false;
}

export async function saveDualUiOnboardingComplete(appVersion: string): Promise<void> {
  await store.set(ONBOARDING_COMPLETE_V1_KEY, true);
  await store.set(DUAL_UI_ONBOARDING_VERSION_KEY, appVersion);
  await store.save();
}

/** @deprecated Use saveDualUiOnboardingComplete — kept for direct v1 writes */
export async function saveOnboardingCompleteV1(done: boolean): Promise<void> {
  await store.set(ONBOARDING_COMPLETE_V1_KEY, done);
  await store.save();
}

const UI_LAYOUTS: UILayout[] = ["classic", "modern"];
const MODERN_DENSITIES: ModernDensity[] = ["regular", "compact"];

function isUILayout(value: unknown): value is UILayout {
  return typeof value === "string" && UI_LAYOUTS.includes(value as UILayout);
}

function isModernDensity(value: unknown): value is ModernDensity {
  return typeof value === "string" && MODERN_DENSITIES.includes(value as ModernDensity);
}

export async function loadUILayout(): Promise<UILayout> {
  const stored = await store.get<unknown>(UI_LAYOUT_KEY);
  if (isUILayout(stored)) return stored;
  return DEFAULT_UI_LAYOUT;
}

export async function saveUILayout(value: UILayout): Promise<void> {
  await store.set(UI_LAYOUT_KEY, value);
  await store.save();
}

export async function loadModernLayout(): Promise<ModernLayoutState> {
  const stored = await store.get<unknown>(MODERN_LAYOUT_KEY);
  return normalizeModernLayout(stored);
}

export async function saveModernLayout(value: ModernLayoutState): Promise<void> {
  await store.set(MODERN_LAYOUT_KEY, value);
  await store.save();
}

export async function loadModernDensity(): Promise<ModernDensity> {
  const stored = await store.get<unknown>(MODERN_DENSITY_KEY);
  if (isModernDensity(stored)) return stored;
  return DEFAULT_MODERN_DENSITY;
}

export async function saveModernDensity(value: ModernDensity): Promise<void> {
  await store.set(MODERN_DENSITY_KEY, value);
  await store.save();
}

// --- Product polls (consent-first; default ON) ---

const PRODUCT_POLLS_ENABLED_KEY = "polls.enabled";
const PRODUCT_POLLS_INSTALL_ID_KEY = "polls.installId";
const PRODUCT_POLLS_ANSWERED_KEY = "polls.answered";
const PRODUCT_POLLS_DISMISSED_KEY = "polls.dismissed";
const PRODUCT_POLLS_LAST_FETCH_AT_KEY = "polls.lastFetchAt";

export const DEFAULT_PRODUCT_POLLS_ENABLED = true;

export async function loadProductPollsEnabled(): Promise<boolean> {
  const stored = await store.get<unknown>(PRODUCT_POLLS_ENABLED_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_PRODUCT_POLLS_ENABLED;
}

export async function saveProductPollsEnabled(value: boolean): Promise<void> {
  await store.set(PRODUCT_POLLS_ENABLED_KEY, value);
  await store.save();
}

export async function loadProductPollsInstallId(): Promise<string | null> {
  const stored = await store.get<unknown>(PRODUCT_POLLS_INSTALL_ID_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : null;
}

export async function saveProductPollsInstallId(value: string): Promise<void> {
  await store.set(PRODUCT_POLLS_INSTALL_ID_KEY, value);
  await store.save();
}

export async function loadProductPollsAnswered(): Promise<Record<string, string>> {
  const stored = await store.get<unknown>(PRODUCT_POLLS_ANSWERED_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function saveProductPollsAnswered(value: Record<string, string>): Promise<void> {
  await store.set(PRODUCT_POLLS_ANSWERED_KEY, value);
  await store.save();
}

export async function loadProductPollsDismissed(): Promise<Record<string, number>> {
  const stored = await store.get<unknown>(PRODUCT_POLLS_DISMISSED_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export async function saveProductPollsDismissed(value: Record<string, number>): Promise<void> {
  await store.set(PRODUCT_POLLS_DISMISSED_KEY, value);
  await store.save();
}

export async function loadProductPollsLastFetchAt(): Promise<number | null> {
  const stored = await store.get<unknown>(PRODUCT_POLLS_LAST_FETCH_AT_KEY);
  return typeof stored === "number" && Number.isFinite(stored) ? stored : null;
}

export async function saveProductPollsLastFetchAt(value: number): Promise<void> {
  await store.set(PRODUCT_POLLS_LAST_FETCH_AT_KEY, value);
  await store.save();
}

/** Plugin ids we already notified about after an update (#838). */
const NOTIFIED_NEW_PROVIDERS_KEY = "notifiedNewProviders";

export async function loadNotifiedNewProviders(): Promise<string[]> {
  const stored = await store.get<unknown>(NOTIFIED_NEW_PROVIDERS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function saveNotifiedNewProviders(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  await store.set(NOTIFIED_NEW_PROVIDERS_KEY, unique);
  await store.save();
}

/** Restore UI preferences to defaults. Does not wipe plugin enablement, credentials, or poll identity. */
export async function resetAllUserPreferences(): Promise<void> {
  await store.set(AUTO_UPDATE_SETTINGS_KEY, DEFAULT_AUTO_UPDATE_INTERVAL);
  await store.set(THEME_MODE_KEY, DEFAULT_THEME_MODE);
  await store.set(DISPLAY_MODE_KEY, DEFAULT_DISPLAY_MODE);
  await store.set(RESET_TIMER_DISPLAY_MODE_KEY, DEFAULT_RESET_TIMER_DISPLAY_MODE);
  await store.set(TIME_FORMAT_MODE_KEY, DEFAULT_TIME_FORMAT_MODE);
  await store.set(APP_LOCALE_KEY, DEFAULT_APP_LOCALE);
  await store.set(DISPLAY_CURRENCY_KEY, DEFAULT_DISPLAY_CURRENCY);
  await store.set(MENUBAR_ICON_STYLE_KEY, DEFAULT_MENUBAR_ICON_STYLE);
  await store.set(PREFER_MENUBAR_WEEKLY_LIMIT_KEY, DEFAULT_PREFER_MENUBAR_WEEKLY_LIMIT);
  await store.set(GLOBAL_SHORTCUT_KEY, DEFAULT_GLOBAL_SHORTCUT);
  await store.set(START_ON_LOGIN_KEY, DEFAULT_START_ON_LOGIN);
  await store.set(USAGE_ALERT_ENABLED_KEY, DEFAULT_USAGE_ALERT_ENABLED);
  await store.set(USAGE_ALERT_THRESHOLD_KEY, DEFAULT_USAGE_ALERT_THRESHOLD);
  await store.set(USAGE_ALERT_CUSTOM_THRESHOLD_KEY, DEFAULT_USAGE_ALERT_CUSTOM_THRESHOLD);
  await store.set(USAGE_ALERT_SOUND_KEY, DEFAULT_USAGE_ALERT_SOUND);
  await store.set(USAGE_PACE_ALERT_ENABLED_KEY, DEFAULT_USAGE_PACE_ALERT_ENABLED);
  await store.set(USAGE_SPIKE_ALERT_ENABLED_KEY, DEFAULT_USAGE_SPIKE_ALERT_ENABLED);
  await store.set(USAGE_SPIKE_ALERT_THRESHOLD_PCT_KEY, DEFAULT_USAGE_SPIKE_ALERT_THRESHOLD_PCT);
  await store.set(UI_SCALE_KEY, DEFAULT_UI_SCALE);
  await store.set(REDUCE_ANIMATIONS_KEY, DEFAULT_REDUCE_ANIMATIONS);
  await store.set(SHOW_TRAY_ICON_KEY, DEFAULT_SHOW_TRAY_ICON);
  await store.set(SHOW_TRAY_INSIGHT_KEY, DEFAULT_SHOW_TRAY_INSIGHT);
  await store.set(SHOW_TOTAL_SPEND_KEY, DEFAULT_SHOW_TOTAL_SPEND);
  await store.set(TOTAL_SPEND_METRIC_KEY, DEFAULT_TOTAL_SPEND_METRIC);
  await store.set(SHOW_ACCOUNT_IDENTITY_KEY, DEFAULT_SHOW_ACCOUNT_IDENTITY);
  await store.set(UI_LAYOUT_KEY, DEFAULT_UI_LAYOUT);
  await store.set(MODERN_DENSITY_KEY, DEFAULT_MODERN_DENSITY);
  await store.set(MODERN_LAYOUT_KEY, EMPTY_MODERN_LAYOUT);
  await store.set(PERSIST_USAGE_HISTORY_KEY, false);
  await store.set(USAGE_HISTORY_RETENTION_DAYS_KEY, DEFAULT_USAGE_HISTORY_RETENTION_DAYS);
  await store.set(PRODUCT_POLLS_ENABLED_KEY, DEFAULT_PRODUCT_POLLS_ENABLED);
  await store.save();
}
