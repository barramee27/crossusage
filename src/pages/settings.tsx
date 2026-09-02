import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/provider-icon";
import { GlobalShortcutSection } from "@/components/global-shortcut-section";
import { LanguageRegionSection } from "@/components/settings/language-region-section";
import { getBarFillLayout } from "@/lib/tray-bars-icon";
import { getTrayIconSizePx } from "@/lib/tray-icon-size";
import {
  USAGE_ALERT_SOUND_OPTIONS,
  USAGE_ALERT_THRESHOLD_OPTIONS,
  USAGE_HISTORY_RETENTION_OPTIONS,
  DEFAULT_USAGE_HISTORY_RETENTION_DAYS,
  loadPersistUsageHistory,
  loadUsageHistoryRetentionDays,
  savePersistUsageHistory,
  saveUsageHistoryRetentionDays,
  saveShowTrayInsight,
  saveShowTotalSpend,
  saveReduceAnimations,
  resetAllUserPreferences,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_START_ON_LOGIN,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type UILayout,
  type ModernDensity,
  type TimeFormatMode,
  type AppLocale,
  type DisplayCurrency,
  type UIScale,
  type UsageAlertSound,
  type UsageAlertThreshold,
} from "@/lib/settings";
import { hydrateModernLayoutStore } from "@/stores/modern-layout-store";
import { setProductPollsEnabled } from "@/hooks/app/use-product-polls";
import { useProductPollsStore } from "@/stores/product-polls-store";
import { DEFAULT_LOG_LEVEL, isLogLevel, LOG_LEVEL_OPTIONS, type LogLevel } from "@/lib/log-level";
import { formatLogTailClipboard } from "@/lib/support-issue-paste";
import type { UsageHistoryRow } from "@/lib/usage-history";
import { exportUsageHistoryToFolder } from "@/lib/history-export";
import type { UsageDailyRow } from "@/lib/usage-daily";
import { UsageHistoryChart, usageHistoryInstanceOptions } from "@/components/usage-history-chart";
import { UsageDailyChart, usageDailyInstanceOptions } from "@/components/usage-daily-chart";
import { getTimeFormatter } from "@/lib/reset-tooltip";
import type { TraySettingsPreview } from "@/hooks/app/use-tray-icon";
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list";
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress";
import {
  buildDevMockProviderCredentials,
  shouldApplyProviderAccountDevMock,
} from "@/lib/provider-account-dev-mock";
import { formatOsDiagnosticsLine, type OsDiagnosticsPayload } from "@/lib/os-diagnostics-format";
import { cn } from "@/lib/utils";
import { LayoutPreviewClassic, LayoutPreviewModern } from "@/components/ui-layout-preview";
import { TrayReadoutDialog, type TrayReadoutDialogState } from "@/components/tray-readout-dialog";
import { useAppPreferencesStore } from "@/stores/app-preferences-store";
import { fireMotionShock } from "@/components/motion-field";
import { openUrl } from "@tauri-apps/plugin-opener";
import { multiAccountCredentialsGuideUrl } from "@/lib/docs-links";
import { FORK_REPO_URL } from "@/lib/fork-meta";
import { sendNotificationAsync } from "@/lib/notification";
import { useTranslation } from "react-i18next";
import { useTranslatedSettingsOptions } from "@/hooks/use-translated-settings-options";
import { useModernLayoutStore } from "@/stores/modern-layout-store";
import {
  defaultTrayReadoutLine,
  defaultTrayReadoutPluginId,
  shouldOpenTrayReadoutDialog,
} from "@/lib/tray-readout-pick";

function trayBarPrimaryFraction(bar: TrayPrimaryBar | undefined): number {
  return bar?.items[0]?.fraction ?? 0;
}

const TRAY_PREVIEW_SIZE_PX = getTrayIconSizePx(1);
/** Style picker uses a mid fill so pie / logo-fill / full logo don't all look identical at 90%+ remaining. */
const TRAY_STYLE_DEMO_FRACTION = 0.62;

const PREVIEW_BAR_TRACK_PX = 20;

export type ProviderAccountCredentialInput = {
  label?: string;
  accessToken: string;
  refreshToken: string;
  sessionKey: string;
};

type AccountFormState =
  | {
    mode: "add";
    /** Row `plugin.id` where "Add account" was clicked (inline form anchor). */
    openedFromPluginId: string;
    id: string;
    baseProviderId: string;
    providerName: string;
    label: string;
    accessToken: string;
    refreshToken: string;
    sessionKey: string;
  }
  | {
    mode: "credentials";
    id: string;
    baseProviderId: string;
    providerName: string;
    label: string;
    accessToken: string;
    refreshToken: string;
    sessionKey: string;
  }
  | {
    mode: "rename";
    id: string;
    providerName: string;
    label: string;
  };

/** Plugin list row to render the account form under (add = row that opened the form; others = that account's row). */
function accountFormAnchorPluginId(form: AccountFormState): string {
  return form.mode === "add" ? form.openedFromPluginId : form.id;
}

function getPreviewBarLayout(fraction: number): { fillPercent: number; remainderPercent: number } {
  const { fillW, remainderDrawW } = getBarFillLayout(PREVIEW_BAR_TRACK_PX, fraction);
  return {
    fillPercent: (fillW / PREVIEW_BAR_TRACK_PX) * 100,
    remainderPercent: (remainderDrawW / PREVIEW_BAR_TRACK_PX) * 100,
  };
}

function ProviderIconMask({
  iconUrl,
  isActive,
  sizePx,
  className,
}: {
  iconUrl?: string;
  isActive: boolean;
  sizePx: number;
  className?: string;
}) {
  return (
    <ProviderIcon
      iconUrl={iconUrl}
      isActive={isActive}
      sizePx={sizePx}
      className={className}
    />
  );
}

function ProviderLogoFillPreview({
  iconUrl,
  fraction,
  isActive,
  sizePx,
}: {
  iconUrl?: string;
  fraction: number;
  isActive: boolean;
  sizePx: number;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0"
      style={{ width: `${sizePx}px`, height: `${sizePx}px` }}
    >
      <ProviderIconMask
        iconUrl={iconUrl}
        isActive={isActive}
        sizePx={sizePx}
        className="opacity-20"
      />
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden"
        style={{
          top: "auto",
          height: `${clamped * 100}%`,
        }}
      >
        <ProviderIconMask
          iconUrl={iconUrl}
          isActive={isActive}
          sizePx={sizePx}
          className="absolute bottom-0 left-0"
        />
      </span>
    </span>
  );
}

function makePiePolygonClipPath(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  if (clamped <= 0) return "polygon(50% 50%, 50% 50%, 50% 50%)";
  if (clamped >= 1) return "inset(0)";

  const points = ["50% 50%", "50% -22%"];
  const steps = Math.max(2, Math.ceil(clamped * 16));
  for (let i = 1; i <= steps; i += 1) {
    const angle = -90 + (360 * clamped * i) / steps;
    const radians = (angle * Math.PI) / 180;
    const x = 50 + Math.cos(radians) * 72;
    const y = 50 + Math.sin(radians) * 72;
    points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${points.join(", ")})`;
}

function ProviderLogoPiePreview({
  iconUrl,
  fraction,
  isActive,
  sizePx,
}: {
  iconUrl?: string;
  fraction: number;
  isActive: boolean;
  sizePx: number;
}) {
  const clipPath = makePiePolygonClipPath(fraction);
  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0"
      style={{ width: `${sizePx}px`, height: `${sizePx}px` }}
    >
      <ProviderIconMask
        iconUrl={iconUrl}
        isActive={isActive}
        sizePx={sizePx}
        className="opacity-20"
      />
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath }}
      >
        <ProviderIconMask iconUrl={iconUrl} isActive={isActive} sizePx={sizePx} />
      </span>
    </span>
  );
}

function MenubarIconStylePreview({
  style,
  isActive,
  traySettingsPreview,
}: {
  style: MenubarIconStyle;
  isActive: boolean;
  traySettingsPreview: TraySettingsPreview;
}) {
  const textClass = isActive ? "text-primary-foreground" : "text-foreground";

  if (style === "provider") {
    return (
      <div className="inline-flex items-center gap-0.5">
        <ProviderIconMask
          iconUrl={traySettingsPreview.providerIconUrl}
          isActive={isActive}
          sizePx={TRAY_PREVIEW_SIZE_PX}
        />
        <span className={cn("text-[12px] font-semibold tabular-nums leading-none", textClass)}>
          {traySettingsPreview.providerPercentText}
        </span>
      </div>
    );
  }

  if (style === "bars") {
    const trackClass = isActive ? "bg-primary-foreground/15" : "bg-foreground/15";
    const remainderClass = isActive ? "bg-primary-foreground/20" : "bg-foreground/15";
    const fillClass = isActive ? "bg-primary-foreground" : "bg-foreground";
    const fractions = traySettingsPreview.bars.length > 0
      ? traySettingsPreview.bars.map((b) => trayBarPrimaryFraction(b))
      : [0.83, 0.7, 0.56];

    return (
      <div className="flex items-center">
        <div className="flex flex-col gap-0.5 w-5">
          {fractions.map((fraction, i) => {
            const { fillPercent, remainderPercent } = getPreviewBarLayout(fraction);
            return (
              <div key={i} className={cn("relative h-1 rounded-sm", trackClass)}>
                {remainderPercent > 0 && (
                  <span
                    aria-hidden
                    className={remainderClass}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${remainderPercent}%`,
                      borderRadius: "1px 2px 2px 1px",
                    }}
                  />
                )}
                <div
                  className={cn("h-1", fillClass)}
                  style={{ width: `${fillPercent}%`, borderRadius: "2px 1px 1px 2px" }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (style === "logoBar") {
    return (
      <ProviderLogoFillPreview
        iconUrl={traySettingsPreview.providerIconUrl}
        fraction={TRAY_STYLE_DEMO_FRACTION}
        isActive={isActive}
        sizePx={TRAY_PREVIEW_SIZE_PX}
      />
    );
  }

  if (style === "logoGrid") {
    const bars = traySettingsPreview.bars.length > 0 ? traySettingsPreview.bars.slice(0, 4) : traySettingsPreview.providerBars.slice(0, 4);
    const items = bars.length > 0 ? bars : [{ id: "placeholder", items: [{ label: "Usage", fraction: 0.72 }] }];
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {items.map((bar) => (
          <ProviderLogoFillPreview
            key={bar.id}
            iconUrl={traySettingsPreview.providerIconUrls[bar.id] ?? traySettingsPreview.providerIconUrl}
            fraction={TRAY_STYLE_DEMO_FRACTION}
            isActive={isActive}
            sizePx={Math.max(9, Math.round(TRAY_PREVIEW_SIZE_PX * 0.48))}
          />
        ))}
      </div>
    );
  }

  if (style === "donut") {
    return (
      <ProviderLogoPiePreview
        iconUrl={traySettingsPreview.providerIconUrl}
        fraction={TRAY_STYLE_DEMO_FRACTION}
        isActive={isActive}
        sizePx={TRAY_PREVIEW_SIZE_PX}
      />
    );
  }

  return null;
}

function SortablePluginItem({
  plugin,
  onToggle,
  onTrayLineToggle,
  onAddAccount,
  onUpdateCredentials,
  onRenameAccount,
  onRemoveAccount,
  cursorRequestsLineAvailable,
  accountFormSlot,
  hideTrayLines = false,
}: {
  plugin: SettingsPluginState;
  onToggle: (id: string) => void;
  onTrayLineToggle: (id: string, lineLabel: string, checked: boolean) => void;
  onAddAccount: (baseProviderId: string, openedFromPluginId: string) => void;
  onUpdateCredentials: (id: string) => void;
  onRenameAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  /** When `plugin.id === "cursor"`, gates the Requests tray line (API may not expose it). */
  cursorRequestsLineAvailable: boolean | null;
  accountFormSlot: ReactNode;
  hideTrayLines?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plugin.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex gap-3 px-3 py-2 rounded-md bg-card",
        "border border-transparent",
        isDragging && "opacity-50 border-border"
      )}
    >
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0 space-y-2">
        {!hideTrayLines && plugin.primaryCandidates.length > 0 && (
          <div
            className="space-y-1.5 pl-0.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {plugin.primaryCandidates.map((label) => {
              const checked = plugin.trayLines.includes(label);
              const isCursorRequests =
                plugin.id === "cursor" && label === "Requests";
              const disabled =
                isCursorRequests && cursorRequestsLineAvailable === false;
              const title =
                isCursorRequests && cursorRequestsLineAvailable === false
                  ? "Requests usage is not available for this Cursor account (e.g. some Pro plans)."
                  : isCursorRequests && cursorRequestsLineAvailable === null
                    ? "Still loading Cursor usage…"
                    : undefined;
              return (
                <label
                  key={`${plugin.id}-${label}`}
                  className={cn(
                    "flex items-center gap-2 text-xs text-muted-foreground select-none",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                  title={title}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(v) =>
                      onTrayLineToggle(plugin.id, label, v === true)
                    }
                  />
                  <span className="text-foreground">{label}</span>
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2 justify-between">
          <div className="min-w-0">
            <span
              className={cn(
                "text-sm truncate block",
                !plugin.enabled && "text-muted-foreground"
              )}
            >
              {plugin.name}
            </span>
            {plugin.instanceLabel && (
              <span className="text-[11px] text-muted-foreground">
                {plugin.baseProviderId}
              </span>
            )}
          </div>
          {/* Wrap to stop Base UI's internal input.click() from bubbling to the row div */}
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              key={`${plugin.id}-${plugin.enabled}`}
              checked={plugin.enabled}
              onCheckedChange={() => onToggle(plugin.id)}
            />
          </span>
        </div>
        {plugin.baseProviderId !== "mock" && (
          <div className="flex flex-wrap gap-1.5 pl-0.5" onClick={(e) => e.stopPropagation()}>
            <Button type="button" variant="outline" size="xs" onClick={() => onUpdateCredentials(plugin.id)}>
              Set credentials
            </Button>
            {!plugin.instanceLabel && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onAddAccount(plugin.baseProviderId, plugin.id)}
              >
                Add account
              </Button>
            )}
            {plugin.instanceLabel && (
              <Button type="button" variant="outline" size="xs" onClick={() => onRenameAccount(plugin.id)}>
                Rename
              </Button>
            )}
            {plugin.instanceLabel && (
              <Button type="button" variant="outline" size="xs" onClick={() => onRemoveAccount(plugin.id)}>
                Remove account
              </Button>
            )}
          </div>
        )}
        {accountFormSlot}
      </div>
    </div>
  );
}

function ProviderAccountForm({
  form,
  onChange,
  onCancel,
  onSubmit,
  devMockCredentialHint = false,
}: {
  form: AccountFormState;
  onChange: (form: AccountFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
  devMockCredentialHint?: boolean;
}) {
  const isRename = form.mode === "rename";
  const title =
    form.mode === "add"
      ? `Add ${form.providerName} account`
      : form.mode === "credentials"
        ? `Set ${form.providerName} credentials`
        : `Rename ${form.providerName} account`;

  return (
    <form
      className="space-y-2 rounded-md border border-border bg-card px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">
          Tokens are encrypted at rest (AES-256-GCM). The encryption key is stored in your OS keychain or credential
          manager; account data on disk is not readable plaintext.
        </p>
        {devMockCredentialHint ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Dev server: Mock mode is on — Save stores placeholder credentials, not what you typed. Remove{" "}
            <code className="font-mono">VITE_PROVIDER_ACCOUNT_DEV_MOCK</code> from your dev command or{" "}
            <code className="font-mono">.env</code> and restart to save real tokens.
          </p>
        ) : null}
        {!isRename && form.mode === "credentials" ? (
          <p className="text-xs text-muted-foreground">
            Saved tokens are never shown here for security. Empty fields when you reopen this dialog are
            normal — paste only when you want to replace stored credentials.
          </p>
        ) : null}
        {form.mode !== "rename" ? (
          form.baseProviderId === "cursor" || form.baseProviderId === "claude" ? (
            <p className="text-xs text-muted-foreground">
              <button
                type="button"
                className="text-primary underline underline-offset-2 hover:no-underline"
                onClick={() => openUrl(multiAccountCredentialsGuideUrl()).catch(console.error)}
              >
                Step-by-step: where to copy tokens (opens GitHub)
              </button>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Paste an API key or OAuth access token for this account. Use refresh token when the provider supports
              token rotation.
            </p>
          )
        ) : null}
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>Account label</span>
        <input
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
          value={form.label}
          placeholder="Work"
          onChange={(event) => onChange({ ...form, label: event.target.value } as AccountFormState)}
        />
      </label>
      {!isRename && (
        <>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Access token</span>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
              value={form.accessToken}
              placeholder="Bearer token"
              autoComplete="off"
              onChange={(event) => onChange({ ...form, accessToken: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Refresh token (optional)</span>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
              value={form.refreshToken}
              autoComplete="off"
              onChange={(event) => onChange({ ...form, refreshToken: event.target.value })}
            />
          </label>
        {(form.baseProviderId === "cursor" || form.baseProviderId === "cursor-nightly") ? (
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Session key (optional)</span>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
              value={form.sessionKey}
              autoComplete="off"
              onChange={(event) => onChange({ ...form, sessionKey: event.target.value })}
            />
          </label>
        ) : null}
      </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}

function InsightsSection() {
  const showTrayInsight = useAppPreferencesStore((state) => state.showTrayInsight);
  const setShowTrayInsight = useAppPreferencesStore((state) => state.setShowTrayInsight);
  const showTotalSpend = useAppPreferencesStore((state) => state.showTotalSpend);
  const setShowTotalSpend = useAppPreferencesStore((state) => state.setShowTotalSpend);

  const onTrayInsightChange = async (checked: boolean) => {
    const prev = showTrayInsight;
    setShowTrayInsight(checked);
    try {
      await saveShowTrayInsight(checked);
    } catch (e) {
      console.error(e);
      setShowTrayInsight(prev);
    }
  };

  const onTotalSpendChange = async (checked: boolean) => {
    const prev = showTotalSpend;
    setShowTotalSpend(checked);
    try {
      await saveShowTotalSpend(checked);
    } catch (e) {
      console.error(e);
      setShowTotalSpend(prev);
    }
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Insights</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Live insights on Dashboard; optional tray line and history-backed tightest quotas when snapshots are saved.
      </p>
      <label className="flex items-center gap-2 text-sm select-none text-foreground">
        <Checkbox
          checked={showTrayInsight}
          onCheckedChange={(checked) => void onTrayInsightChange(checked === true)}
        />
        Show top insight in menu bar / tray tooltip
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm select-none text-foreground">
        <Checkbox
          checked={showTotalSpend}
          onCheckedChange={(checked) => void onTotalSpendChange(checked === true)}
        />
        Show Total Spend card on Modern dashboard
      </label>
    </section>
  );
}

function ProductPollsSection() {
  const enabled = useProductPollsStore((s) => s.enabled);
  const hydrated = useProductPollsStore((s) => s.hydrated);

  const onChange = async (checked: boolean) => {
    try {
      await setProductPollsEnabled(checked);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Product polls</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Occasional in-app questions from the CrossUsage team. Votes are anonymous (opaque install id + your choice).
        Off = never fetch or send votes. See the Polls page.
      </p>
      <label className="flex items-center gap-2 text-sm select-none text-foreground">
        <Checkbox
          checked={enabled}
          disabled={!hydrated}
          onCheckedChange={(checked) => void onChange(checked === true)}
        />
        Allow product polls
      </label>
    </section>
  );
}

function ReduceAnimationsSection() {
  const { t } = useTranslation();
  const reduceAnimations = useAppPreferencesStore((s) => s.reduceAnimations);
  const setReduceAnimations = useAppPreferencesStore((s) => s.setReduceAnimations);

  const onChange = async (checked: boolean) => {
    const prev = reduceAnimations;
    setReduceAnimations(checked);
    if (!checked) fireMotionShock();
    try {
      await saveReduceAnimations(checked);
    } catch (e) {
      console.error(e);
      setReduceAnimations(prev);
    }
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">{t("settings.reduceAnimations.title")}</h3>
      <p className="text-sm text-muted-foreground mb-2">
        {t("settings.reduceAnimations.description")}
      </p>
      <label className="flex items-center gap-2 text-sm select-none text-foreground">
        <Checkbox
          checked={reduceAnimations}
          onCheckedChange={(checked) => void onChange(checked === true)}
        />
        {t("settings.reduceAnimations.checkbox")}
      </label>
    </section>
  );
}

function ResetAllSettingsSection({ onResetComplete }: { onResetComplete: () => void }) {
  const { t } = useTranslation();
  const resetState = useAppPreferencesStore((s) => s.resetState);
  const [busy, setBusy] = useState(false);

  const onReset = async () => {
    if (!window.confirm(t("settings.resetAll.confirm"))) return;
    setBusy(true);
    try {
      await resetAllUserPreferences();
      resetState();
      onResetComplete();
      if (isTauri()) {
        try {
          await invoke("update_global_shortcut", { shortcut: DEFAULT_GLOBAL_SHORTCUT });
        } catch (e) {
          console.error("update global shortcut after reset:", e);
        }
      }
      await hydrateModernLayoutStore();
      await setProductPollsEnabled(true);
      if (isTauri() && !DEFAULT_START_ON_LOGIN) {
        try {
          await disableAutostart();
        } catch (e) {
          console.error("disable autostart after reset:", e);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">{t("settings.resetAll.title")}</h3>
      <p className="text-sm text-muted-foreground mb-2">
        {t("settings.resetAll.description")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/50 hover:bg-destructive/10"
        disabled={busy}
        onClick={() => void onReset()}
      >
        {t("settings.resetAll.button")}
      </Button>
    </section>
  );
}

const LOCAL_API_BASE = "http://127.0.0.1:6736";

function LocalApiSection() {
  const [message, setMessage] = useState<string | null>(null);
  const endpoints = ["/v1/usage", "/v1/limits", "/v1/insights", "/v1/history/quota", "/v1/history/daily"] as const;

  const copy = async (path: string) => {
    setMessage(null);
    const cmd = `curl -sS ${LOCAL_API_BASE}${path}`;
    try {
      await writeText(cmd);
      setMessage(`Copied: ${path}`);
    } catch (e) {
      console.error(e);
      setMessage("Clipboard failed");
    }
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Local API (troubleshooting)</h3>
      <p className="text-sm text-muted-foreground mb-2">
        While the app runs, HTTP endpoints are available at{" "}
        <code className="text-xs">{LOCAL_API_BASE}</code>. The root URL returns{" "}
        <code className="text-xs">not_found</code> by design. Copy a curl command below to test in a terminal.
      </p>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {endpoints.map((path) => (
            <Button key={path} type="button" variant="outline" size="sm" onClick={() => void copy(path)}>
              Copy {path}
            </Button>
          ))}
        </div>
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      </div>
    </section>
  );
}

function UsageHistorySection() {
  const [persist, setPersist] = useState(false);
  const [retentionDays, setRetentionDays] = useState(DEFAULT_USAGE_HISTORY_RETENTION_DAYS);
  const [hydrated, setHydrated] = useState(false);
  const [rows, setRows] = useState<UsageHistoryRow[]>([]);
  const [dailyRows, setDailyRows] = useState<UsageDailyRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [chartInstanceFilter, setChartInstanceFilter] = useState<string>("all");

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    setMsg(null);
    try {
      const [data, daily] = await Promise.all([
        invoke<UsageHistoryRow[]>("list_usage_history", { limit: 500 }),
        invoke<UsageDailyRow[]>("list_usage_daily", { limit: 120 }),
      ]);
      setRows(data);
      setDailyRows(daily);
    } catch (e) {
      console.error("list_usage_history:", e);
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadPersistUsageHistory(), loadUsageHistoryRetentionDays()])
      .then(([p, retention]) => {
        setPersist(p);
        setRetentionDays(retention);
        setHydrated(true);
      })
      .catch((e) => {
        console.error("loadPersistUsageHistory:", e);
        setHydrated(true);
      });
  }, []);

  const instanceIdsForChart = useMemo(() => {
    const ids = new Set([
      ...usageHistoryInstanceOptions(rows),
      ...usageDailyInstanceOptions(dailyRows),
    ]);
    return Array.from(ids).sort();
  }, [rows, dailyRows]);

  useEffect(() => {
    if (chartInstanceFilter === "all") return;
    if (!instanceIdsForChart.includes(chartInstanceFilter)) {
      setChartInstanceFilter("all");
    }
  }, [chartInstanceFilter, instanceIdsForChart]);

  useEffect(() => {
    if (!hydrated || !persist) return;
    void reload();
  }, [hydrated, persist, reload]);

  const onPersistChange = async (checked: boolean) => {
    const prev = persist;
    setPersist(checked);
    try {
      await savePersistUsageHistory(checked);
      if (checked) await reload();
      else {
        setRows([]);
        setDailyRows([]);
      }
    } catch (e) {
      console.error(e);
      setPersist(prev);
    }
  };

  const onRetentionChange = async (days: number) => {
    const prev = retentionDays;
    setRetentionDays(days);
    try {
      await saveUsageHistoryRetentionDays(days);
    } catch (e) {
      console.error(e);
      setRetentionDays(prev);
    }
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Usage history</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Optional local SQLite history on this device — never uploaded. With saving enabled:{" "}
        <strong>quota snapshots</strong> after each successful refresh (~one per account per 32s), plus{" "}
        <strong>daily token totals</strong> from Claude/Codex local logs (ccusage) and Cursor local transcripts (token counts only — no dollar cost in export).
        For Cursor billing dollars, use the Cursor detail page → Billing usage table.
      </p>
      <label className="flex items-center gap-2 text-sm select-none text-foreground mb-3">
        <Checkbox
          checked={persist}
          disabled={!isTauri()}
          onCheckedChange={(checked) => void onPersistChange(checked === true)}
        />
        Save usage snapshots after successful refreshes
      </label>
      {persist && hydrated ? (
        <div className="mb-3">
          <p className="text-sm text-muted-foreground mb-2">
            Keep snapshots for — older rows are pruned after each save.
          </p>
          <div className="bg-muted/50 rounded-lg p-1">
            <div
              className="flex flex-wrap gap-1"
              role="radiogroup"
              aria-label="Usage history retention"
            >
              {USAGE_HISTORY_RETENTION_OPTIONS.map((option) => {
                const isActive = option.value === retentionDays;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className="flex-1 min-w-[4.5rem]"
                    onClick={() => void onRetentionChange(option.value)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {!isTauri() ? (
        <p className="text-xs text-muted-foreground">History is only available in the desktop app.</p>
      ) : null}
      {msg ? <p className="text-xs text-destructive mb-2">{msg}</p> : null}
      {exportMsg ? <p className="text-xs text-foreground/80 mb-2">{exportMsg}</p> : null}
      {persist && isTauri() ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
              Refresh list
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting || (rows.length === 0 && dailyRows.length === 0)}
              onClick={async () => {
                setExportMsg(null);
                setMsg(null);
                setExporting(true);
                try {
                  const result = await exportUsageHistoryToFolder(
                    rows.map((r) => ({
                      capturedAtMs: r.capturedAtMs,
                      instanceId: r.instanceId,
                      displayName: r.displayName,
                      primaryPercent: r.primaryPercent,
                      plan: r.plan,
                    })),
                    dailyRows,
                  );
                  if (result) {
                    setExportMsg(
                      `Exported ${result.files.length} files to ${result.directory} (see crossusage-export-summary-*.txt)`,
                    );
                  }
                } catch (e) {
                  console.error(e);
                  setMsg(e instanceof Error ? e.message : String(e));
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? "Exporting…" : "Export to folder…"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/50 hover:bg-destructive/10"
              onClick={async () => {
                if (!window.confirm("Delete all saved usage history on this device?")) return;
                try {
                  await invoke("clear_usage_history");
                  setRows([]);
                  setDailyRows([]);
                } catch (e) {
                  console.error(e);
                  setMsg(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Clear history
            </Button>
          </div>
          {rows.length > 0 || dailyRows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2 text-foreground/90">
                <span className="text-muted-foreground">Chart account</span>
                <select
                  className={cn(
                    "min-w-[10rem] rounded-md border border-border px-2 py-1.5 text-xs font-medium outline-none focus:border-ring",
                    "bg-secondary text-secondary-foreground",
                  )}
                  value={chartInstanceFilter}
                  onChange={(e) => setChartInstanceFilter(e.target.value)}
                >
                  <option value="all">All accounts</option>
                  {instanceIdsForChart.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">Quota over time</h4>
              <UsageHistoryChart rows={rows} instanceFilter={chartInstanceFilter} />
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">Daily tokens (local logs)</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Each bar = one calendar day of tokens (local logs). 1d shows today only (not hourly). 7d+ compares days. Cursor totals are estimated from transcripts, not billing. API-only providers use the quota chart above.
              </p>
              <UsageDailyChart rows={dailyRows} instanceFilter={chartInstanceFilter} />
            </div>
          </div>
          <div className="max-h-64 overflow-auto rounded-md border border-border text-xs">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr className="text-left text-muted-foreground">
                  <th className="p-2 font-medium">Time</th>
                  <th className="p-2 font-medium">Account</th>
                  <th
                    className="p-2 font-medium max-w-[14rem]"
                    title="Highest percent-style progress row from that snapshot (same heuristic as charts). Not a bill or invoice total."
                  >
                    Usage
                  </th>
                  <th className="p-2 font-medium">Plan</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-3 text-muted-foreground">
                      No rows yet — enable above and wait for a successful provider refresh.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="p-2 whitespace-nowrap font-mono">
                        {new Date(r.capturedAtMs).toLocaleString()}
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{r.displayName}</div>
                        <div className="text-muted-foreground">{r.instanceId}</div>
                      </td>
                      <td className="p-2 align-top">
                        <div className="tabular-nums font-medium text-foreground">
                          {r.primaryPercent.toFixed(1)}%
                        </div>
                        <div className="mt-1 space-y-0.5 text-muted-foreground font-normal normal-case">
                          {r.inputTokens != null || r.outputTokens != null ? (
                            <div>
                              In {r.inputTokens != null ? r.inputTokens.toLocaleString() : "—"} · Out{" "}
                              {r.outputTokens != null ? r.outputTokens.toLocaleString() : "—"}
                            </div>
                          ) : null}
                          {r.cost != null ? (
                            <div
                              className="text-foreground/90"
                              title="Dollar snapshot from a dollars-type progress row. For Cursor’s Credits row, this is dollars remaining on that bar (limit − used there), not the same as the % columns."
                            >
                              ≈ ${r.cost.toFixed(2)}
                            </div>
                          ) : null}
                          {r.quotaSummary ? (
                            <div className="line-clamp-2 break-words" title={r.quotaSummary}>
                              {r.quotaSummary}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-2 text-muted-foreground">{r.plan ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface SettingsPageProps {
  plugins: SettingsPluginState[];
  onReorder: (orderedIds: string[]) => void;
  onToggle: (id: string) => void;
  onTrayLineToggle: (id: string, lineLabel: string, checked: boolean) => void;
  onAddProviderAccount: (baseProviderId: string, input: ProviderAccountCredentialInput) => void;
  onUpdateProviderAccountCredentials: (id: string, input: ProviderAccountCredentialInput) => void;
  onRenameProviderAccount: (id: string, label: string) => void;
  onRemoveProviderAccount: (id: string) => void;
  autoUpdateInterval: AutoUpdateIntervalMinutes;
  onAutoUpdateIntervalChange: (value: AutoUpdateIntervalMinutes) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (value: ThemeMode) => void;
  uiLayout: UILayout;
  onUILayoutChange: (value: UILayout) => void;
  modernDensity: ModernDensity;
  onModernDensityChange: (value: ModernDensity) => void;
  displayMode: DisplayMode;
  onDisplayModeChange: (value: DisplayMode) => void;
  resetTimerDisplayMode: ResetTimerDisplayMode;
  onResetTimerDisplayModeChange: (value: ResetTimerDisplayMode) => void;
  timeFormatMode: TimeFormatMode;
  onTimeFormatModeChange: (value: TimeFormatMode) => void;
  appLocale: AppLocale;
  onAppLocaleChange: (value: AppLocale) => void;
  displayCurrency: DisplayCurrency;
  onDisplayCurrencyChange: (value: DisplayCurrency) => void;
  menubarIconStyle: MenubarIconStyle;
  onMenubarIconStyleChange: (value: MenubarIconStyle) => void;
  preferMenubarWeeklyLimit: boolean;
  onPreferMenubarWeeklyLimitChange: (value: boolean) => void;
  traySettingsPreview: TraySettingsPreview;
  globalShortcut: GlobalShortcut;
  onGlobalShortcutChange: (value: GlobalShortcut) => void;
  startOnLogin: boolean;
  onStartOnLoginChange: (value: boolean) => void;
  startOnLoginError?: string | null;
  usageAlertEnabled: boolean;
  onUsageAlertEnabledChange: (value: boolean) => void;
  usageAlertThreshold: UsageAlertThreshold;
  onUsageAlertThresholdChange: (value: UsageAlertThreshold) => void;
  customUsageAlertThreshold: number | null;
  onUsageAlertCustomThresholdChange: (value: number | null) => void;
  usageAlertSound: UsageAlertSound;
  onUsageAlertSoundChange: (value: UsageAlertSound) => void;
  usagePaceAlertEnabled: boolean;
  onUsagePaceAlertEnabledChange: (value: boolean) => void;
  usageSpikeAlertEnabled: boolean;
  onUsageSpikeAlertEnabledChange: (value: boolean) => void;
  usageSpikeAlertThresholdPct: import("@/lib/settings").UsageSpikeAlertThresholdPct;
  onUsageSpikeAlertThresholdPctChange: (value: import("@/lib/settings").UsageSpikeAlertThresholdPct) => void;
  uiScale: UIScale;
  onUIScaleChange: (value: UIScale) => void;
  showAccountIdentity: boolean;
  onShowAccountIdentityChange: (value: boolean) => void;
  cursorRequestsLineAvailable: boolean | null;
  onSetTrayReadout: (pluginId: string, lineLabel: string) => void;
  presentation?: "classic" | "modern";
}

export function SettingsPage({
  plugins,
  onReorder,
  onToggle,
  onTrayLineToggle,
  onAddProviderAccount,
  onUpdateProviderAccountCredentials,
  onRenameProviderAccount,
  onRemoveProviderAccount,
  autoUpdateInterval,
  onAutoUpdateIntervalChange,
  themeMode,
  onThemeModeChange,
  uiLayout,
  onUILayoutChange,
  modernDensity,
  onModernDensityChange,
  displayMode,
  onDisplayModeChange,
  resetTimerDisplayMode,
  onResetTimerDisplayModeChange,
  timeFormatMode,
  onTimeFormatModeChange,
  appLocale,
  onAppLocaleChange,
  displayCurrency,
  onDisplayCurrencyChange,
  menubarIconStyle,
  onMenubarIconStyleChange,
  preferMenubarWeeklyLimit,
  onPreferMenubarWeeklyLimitChange,
  traySettingsPreview,
  globalShortcut,
  onGlobalShortcutChange,
  startOnLogin,
  onStartOnLoginChange,
  startOnLoginError,
  usageAlertEnabled,
  onUsageAlertEnabledChange,
  usageAlertThreshold,
  onUsageAlertThresholdChange,
  customUsageAlertThreshold,
  onUsageAlertCustomThresholdChange,
  usageAlertSound,
  onUsageAlertSoundChange,
  usagePaceAlertEnabled,
  onUsagePaceAlertEnabledChange,
  usageSpikeAlertEnabled,
  onUsageSpikeAlertEnabledChange,
  usageSpikeAlertThresholdPct,
  onUsageSpikeAlertThresholdPctChange,
  uiScale,
  onUIScaleChange,
  showAccountIdentity,
  onShowAccountIdentityChange,
  cursorRequestsLineAvailable,
  onSetTrayReadout,
  presentation = "classic",
}: SettingsPageProps) {
  const { t } = useTranslation();
  const {
    autoUpdateOptions,
    displayModeOptions,
    resetTimerOptions,
    timeFormatOptions,
    uiLayoutOptions,
    modernDensityOptions,
    themeOptions,
    uiScaleOptions,
    menubarIconOptions,
    modernTabs,
  } = useTranslatedSettingsOptions();
  const isModern = presentation === "modern";
  type ModernSettingsTab = "general" | "tray" | "appearance" | "providers" | "advanced";
  const [modernTab, setModernTab] = useState<ModernSettingsTab>("general");
  const showModernSection = (tab: ModernSettingsTab | ModernSettingsTab[]) => {
    if (!isModern) return true;
    const tabs = Array.isArray(tab) ? tab : [tab];
    return tabs.includes(modernTab);
  };
  const [accountForm, setAccountForm] = useState<AccountFormState | null>(null);
  const [devMockSaveNotice, setDevMockSaveNotice] = useState<string | null>(null);
  const [supportBundleMessage, setSupportBundleMessage] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<LogLevel>(DEFAULT_LOG_LEVEL);
  const [logPathMessage, setLogPathMessage] = useState<string | null>(null);
  const [usageAlertTestMessage, setUsageAlertTestMessage] = useState<string | null>(null);
  const [troubleshootingOsLine, setTroubleshootingOsLine] = useState<string | null>(null);
  const [trayReadoutDialog, setTrayReadoutDialog] = useState<TrayReadoutDialogState | null>(null);
  const [usageHistorySectionKey, setUsageHistorySectionKey] = useState(0);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<OsDiagnosticsPayload>("get_os_diagnostics");
        if (cancelled) return;
        setTroubleshootingOsLine(formatOsDiagnosticsLine(raw));
      } catch (e) {
        console.error("get_os_diagnostics:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void invoke<string>("get_log_level")
      .then((level) => {
        if (!cancelled && isLogLevel(level)) setLogLevel(level);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogLevelChange = async (level: LogLevel) => {
    setLogPathMessage(null);
    if (!isTauri()) return;
    try {
      await invoke("set_log_level", { level });
      setLogLevel(level);
    } catch (e) {
      console.error("set_log_level:", e);
      setLogPathMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleMenubarIconStyleOptionClick = (style: MenubarIconStyle) => {
    if (style === menubarIconStyle) return;
    if (shouldOpenTrayReadoutDialog(style, plugins)) {
      const preferredId =
        useModernLayoutStore.getState().trayFocusProviderId ??
        traySettingsPreview.providerBars[0]?.id ??
        null;
      const pluginId = defaultTrayReadoutPluginId(plugins, preferredId);
      const plugin = plugins.find((p) => p.id === pluginId);
      if (pluginId && plugin) {
        setTrayReadoutDialog({
          nextStyle: style,
          pluginId,
          lineLabel: defaultTrayReadoutLine(plugin),
        });
        return;
      }
    }
    onMenubarIconStyleChange(style);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = plugins.findIndex((item) => item.id === active.id);
      const newIndex = plugins.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(plugins, oldIndex, newIndex);
      onReorder(next.map((item) => item.id));
    }
  };

  const openAddAccountForm = (baseProviderId: string, openedFromPluginId: string) => {
    setDevMockSaveNotice(null);
    const basePlugin = plugins.find((plugin) => plugin.id === baseProviderId);
    const providerName = basePlugin?.name ?? baseProviderId;
    setAccountForm({
      mode: "add",
      openedFromPluginId,
      id: baseProviderId,
      baseProviderId,
      providerName,
      label: "Work",
      accessToken: "",
      refreshToken: "",
      sessionKey: "",
    });
  };

  const openCredentialForm = (id: string) => {
    setDevMockSaveNotice(null);
    const plugin = plugins.find((item) => item.id === id);
    if (!plugin) return;
    setAccountForm({
      mode: "credentials",
      id,
      baseProviderId: plugin.baseProviderId,
      providerName: plugin.name,
      label: plugin.instanceLabel ?? plugin.name,
      accessToken: "",
      refreshToken: "",
      sessionKey: "",
    });
  };

  const openRenameForm = (id: string) => {
    const plugin = plugins.find((item) => item.id === id);
    if (!plugin) return;
    setAccountForm({
      mode: "rename",
      id,
      providerName: plugin.name,
      label: plugin.instanceLabel ?? plugin.name,
    });
  };

  const submitAccountForm = () => {
    if (!accountForm) return;
    const label = accountForm.label.trim();
    if (!label) return;
    if (accountForm.mode === "rename") {
      onRenameProviderAccount(accountForm.id, label);
      setAccountForm(null);
      return;
    }
    const devMock = shouldApplyProviderAccountDevMock();
    const rawAccess = accountForm.accessToken.trim();
    const rawRefresh = accountForm.refreshToken.trim();
    const rawSession = accountForm.sessionKey.trim();
    if (!devMock && !rawAccess && !rawRefresh && !rawSession) return;

    const input = devMock
      ? buildDevMockProviderCredentials(label)
      : {
          label,
          accessToken: accountForm.accessToken,
          refreshToken: accountForm.refreshToken,
          sessionKey: accountForm.sessionKey,
        };
    if (devMock) {
      setDevMockSaveNotice("Saved mock credential placeholders (dev server only).");
    }
    if (accountForm.mode === "add") {
      onAddProviderAccount(accountForm.baseProviderId, input);
    } else {
      onUpdateProviderAccountCredentials(accountForm.id, input);
    }
    setAccountForm(null);
  };

  return (
    <div
      className={cn(
        isModern
          ? "space-y-2 pb-2 [&_section]:rounded-xl [&_section]:border [&_section]:border-border/50 [&_section]:bg-card/30 [&_section]:px-3 [&_section]:py-2.5 [&_h3]:text-sm [&_h3]:font-semibold [&_section>p.text-sm]:text-xs [&_section>p.text-sm]:text-muted-foreground [&_section>p.text-sm]:mb-2"
          : "py-3 space-y-4",
      )}
    >
      {devMockSaveNotice ? (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
          role="status"
        >
          {devMockSaveNotice}
        </div>
      ) : null}
      {isModern ? (
        <nav
          className="flex gap-1 overflow-x-auto scrollbar-none sticky top-0 z-10 -mx-1 px-1 py-1 bg-background/90 backdrop-blur border-b border-border/40"
          aria-label="Settings sections"
        >
          {modernTabs.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              size="sm"
              variant={modernTab === tab.id ? "default" : "ghost"}
              className="shrink-0"
              onClick={() => setModernTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </nav>
      ) : null}
      {showModernSection("general") ? (
      <>
      <LanguageRegionSection
        appLocale={appLocale}
        displayCurrency={displayCurrency}
        onAppLocaleChange={onAppLocaleChange}
        onDisplayCurrencyChange={onDisplayCurrencyChange}
      />
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.autoRefresh.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.autoRefresh.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.autoRefresh.aria")}>
            {autoUpdateOptions.map((option) => {
              const isActive = option.value === autoUpdateInterval;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => onAutoUpdateIntervalChange(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      </section>
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.usageMode.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.usageMode.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.usageMode.aria")}>
            {displayModeOptions.map((option) => {
              const isActive = option.value === displayMode;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => onDisplayModeChange(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      </section>
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.resetTimers.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.resetTimers.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.resetTimers.aria")}>
            {resetTimerOptions.map((option) => {
              const isActive = option.value === resetTimerDisplayMode;
              const absoluteTimeExample = getTimeFormatter(timeFormatMode).format(new Date(2026, 1, 2, 11, 4));
              const example = option.value === "relative"
                ? t("reset.exampleRelative")
                : t("reset.exampleAbsolute", { time: absoluteTimeExample });
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="flex-1 flex flex-col items-center gap-0 py-2 h-auto"
                  onClick={() => onResetTimerDisplayModeChange(option.value)}
                >
                  <span>{option.label}</span>
                  <span
                    className={cn(
                      "text-xs font-normal",
                      isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {example}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </section>
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.timeFormat.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.timeFormat.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.timeFormat.aria")}>
            {timeFormatOptions.map((option) => {
              const isActive = option.value === timeFormatMode;
              const example = getTimeFormatter(option.value).format(new Date(2026, 1, 2, 11, 4));
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={option.label}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="flex-1 flex flex-col items-center gap-0 py-2 h-auto"
                  onClick={() => onTimeFormatModeChange(option.value)}
                >
                  <span>{option.label}</span>
                  <span
                    className={cn(
                      "text-xs font-normal",
                      isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {example}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </section>
      </>
      ) : null}
      {showModernSection("tray") ? (
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.trayIcon.title")}</h3>
        {isModern ? (
          <p className="text-sm text-muted-foreground mb-2">
            {t("settings.trayIcon.descriptionModern")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-2">
            {t("settings.trayIcon.descriptionClassic")}
          </p>
        )}
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.trayIcon.aria")}>
            {menubarIconOptions.map((option) => {
              const isActive = option.value === menubarIconStyle;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-label={option.label}
                  aria-checked={isActive}
                  variant={isActive ? "default" : "outline"}
          size="sm"
          className="flex-1 h-auto min-h-14 flex flex-col items-center justify-center gap-1 px-1 py-2"
                  onClick={() => handleMenubarIconStyleOptionClick(option.value)}
                >
                  <MenubarIconStylePreview
                    style={option.value}
                    isActive={isActive}
                    traySettingsPreview={traySettingsPreview}
                  />
          <span
            className={cn(
              "text-[10px] font-medium leading-none",
              isActive ? "text-primary-foreground/85" : "text-muted-foreground"
            )}
          >
            {option.label}
          </span>
                </Button>
              );
            })}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Tray icon % uses each provider&apos;s primary usage line. When a provider exposes a
          weekly overview limit (e.g. session weekly), enabling the option below prefers that line
          over daily or monthly lines for the tray readout.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm select-none text-foreground">
          <Checkbox
            key={`prefer-menubar-weekly-limit-${preferMenubarWeeklyLimit}`}
            checked={preferMenubarWeeklyLimit}
            onCheckedChange={(checked) => onPreferMenubarWeeklyLimitChange(checked === true)}
          />
          Prefer weekly limits when available
        </label>
      </section>
      ) : null}
      {showModernSection("appearance") ? (
      <>
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.uiLayout.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.uiLayout.description")}
        </p>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          role="radiogroup"
          aria-label={t("settings.uiLayout.title")}
        >
          {uiLayoutOptions.map((option) => {
            const isActive = option.value === uiLayout;
            const Preview =
              option.value === "modern" ? LayoutPreviewModern : LayoutPreviewClassic;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={cn(
                  "rounded-lg border p-2 text-left transition-colors",
                  isActive ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:bg-muted/40",
                )}
                onClick={() => onUILayoutChange(option.value)}
              >
                <span className="text-sm font-medium block mb-2">{option.label}</span>
                <Preview isActive={isActive} />
              </button>
            );
          })}
        </div>
      </section>
      {uiLayout === "modern" ? (
        <section>
          <h3 className="text-lg font-semibold mb-0">{t("settings.modernDensity.title")}</h3>
          <p className="text-sm text-muted-foreground mb-2">
            {t("settings.modernDensity.description")}
          </p>
          <div className="bg-muted/50 rounded-lg p-1">
            <div className="flex gap-1" role="radiogroup" aria-label={t("settings.modernDensity.title")}>
              {modernDensityOptions.map((option) => {
                const isActive = option.value === modernDensity;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => onModernDensityChange(option.value)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.theme.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.theme.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.theme.title")}>
            {themeOptions.map((option) => {
              const isActive = option.value === themeMode;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => onThemeModeChange(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      </section>
      <section>
        <h3 className="text-lg font-semibold mb-0">{t("settings.uiScale.title")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {t("settings.uiScale.description")}
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("settings.uiScale.title")}>
            {uiScaleOptions.map((option) => {
              const isActive = option.value === uiScale;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => onUIScaleChange(option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      </section>
      <ReduceAnimationsSection />
      </>
      ) : null}
      {showModernSection("advanced") ? (
      <>
      <GlobalShortcutSection
        globalShortcut={globalShortcut}
        onGlobalShortcutChange={onGlobalShortcutChange}
      />
      <section>
        <h3 className="text-lg font-semibold mb-0">Start on Login</h3>
        <p className="text-sm text-muted-foreground mb-2">
          CrossUsage starts when you sign in
        </p>
        <label className="flex items-center gap-2 text-sm select-none text-foreground">
          <Checkbox
            key={`start-on-login-${startOnLogin}`}
            checked={startOnLogin}
            onCheckedChange={(checked) => onStartOnLoginChange(checked === true)}
          />
          Start on login
        </label>
        {startOnLoginError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Couldn&apos;t update start on login: {startOnLoginError}
          </p>
        ) : null}
      </section>
      <InsightsSection />
      <ProductPollsSection />
      <LocalApiSection />
      <UsageHistorySection key={usageHistorySectionKey} />
      <section>
        <h3 className="text-lg font-semibold mb-0">Troubleshooting</h3>
        <p className="text-sm text-muted-foreground mb-2">
          <strong>Copy log tail</strong> copies plain text: a short header (version, OS, enabled accounts) plus
          the redacted recent log (no JSON, no issue template). Lines tagged for provider accounts you have
          disabled are omitted from the tail when your enabled list is non-empty. Add your own description when
          opening an issue on{" "}
          <button
            type="button"
            className="inline cursor-pointer border-0 bg-transparent p-0 font-inherit text-sm text-primary underline-offset-2 hover:underline align-baseline"
            onClick={() => openUrl(`${FORK_REPO_URL}/issues`).catch(console.error)}
          >
            GitHub
          </button>
          . Redaction is best-effort. A suffix like <span className="tabular-nums">(×12)</span> means the same
          log line repeated 12 times in a row.
        </p>
        {troubleshootingOsLine ? (
          <p className="text-xs font-mono text-muted-foreground mb-2">{troubleshootingOsLine}</p>
        ) : null}
        <div className="mb-3">
          <p className="text-sm font-medium mb-1">Log level</p>
          <p className="text-xs text-muted-foreground mb-2">
            Controls how much detail is written to the log file. Default is Info.
          </p>
          <div className="flex flex-wrap gap-2">
            {LOG_LEVEL_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={logLevel === opt.value ? "default" : "outline"}
                title={opt.hint}
                onClick={() => void handleLogLevelChange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {LOG_LEVEL_OPTIONS.find((opt) => opt.value === logLevel)?.hint ?? ""}
          </p>
        </div>
        <div className="bg-muted/50 rounded-lg p-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={async () => {
              setSupportBundleMessage(null);
              if (!isTauri()) {
                setSupportBundleMessage("Support bundle is only available in the desktop app.");
                return;
              }
              let bundle: Record<string, unknown>;
              try {
                bundle = await invoke<Record<string, unknown>>("get_support_bundle_json");
              } catch (e) {
                console.error("get_support_bundle_json:", e);
                const msg = e instanceof Error ? e.message : String(e);
                setSupportBundleMessage(`Could not build bundle: ${msg}`);
                return;
              }
              const text = formatLogTailClipboard(bundle);
              try {
                await writeText(text);
                setSupportBundleMessage("Copied redacted log tail.");
              } catch (e) {
                console.error("clipboard writeText (Tauri):", e);
                try {
                  await navigator.clipboard.writeText(text);
                  setSupportBundleMessage("Copied to clipboard (browser API fallback).");
                } catch (e2) {
                  console.error("navigator.clipboard.writeText:", e2);
                  const msg = e instanceof Error ? e.message : String(e);
                  setSupportBundleMessage(`Bundle built but clipboard failed: ${msg}`);
                }
              }
            }}
          >
            Copy log tail
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={async () => {
              setLogPathMessage(null);
              if (!isTauri()) {
                setLogPathMessage("Log path is only available in the desktop app.");
                return;
              }
              try {
                const path = await invoke<string>("get_log_path");
                await writeText(path);
                setLogPathMessage("Copied log file path.");
              } catch (e) {
                console.error("get_log_path:", e);
                setLogPathMessage(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Copy log path
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={async () => {
              setLogPathMessage(null);
              if (!isTauri()) {
                setLogPathMessage("Reveal log is only available in the desktop app.");
                return;
              }
              try {
                await invoke("reveal_log_in_folder");
                setLogPathMessage("Opened log folder.");
              } catch (e) {
                console.error("reveal_log_in_folder:", e);
                setLogPathMessage(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Reveal log file
          </Button>
          {supportBundleMessage ? (
            <span className="text-xs text-muted-foreground">{supportBundleMessage}</span>
          ) : null}
          {logPathMessage ? (
            <span className="text-xs text-muted-foreground">{logPathMessage}</span>
          ) : null}
        </div>
      </section>
      <ResetAllSettingsSection onResetComplete={() => setUsageHistorySectionKey((k) => k + 1)} />
      <section>
        <h3 className="text-lg font-semibold mb-0">Account Identity</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Show account email beside plan badges
        </p>
        <label className="flex items-center gap-2 text-sm select-none text-foreground">
          <Checkbox
            key={`show-account-identity-${showAccountIdentity}`}
            checked={showAccountIdentity}
            onCheckedChange={(checked) => onShowAccountIdentityChange(checked === true)}
          />
          Show account identity
        </label>
      </section>
      <section>
        <h3 className="text-lg font-semibold mb-0">Usage Alerts</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Get notified when your primary quota is low or on pace to run out before reset
        </p>
        <label className="flex items-center gap-2 text-sm select-none text-foreground">
          <Checkbox
            key={`usage-alert-enabled-${usageAlertEnabled}`}
            checked={usageAlertEnabled}
            onCheckedChange={(checked) => onUsageAlertEnabledChange(checked === true)}
          />
          Enable usage alerts
        </label>

        {usageAlertEnabled && (
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 text-sm select-none text-foreground">
              <Checkbox
                key={`usage-pace-alert-enabled-${usagePaceAlertEnabled}`}
                checked={usagePaceAlertEnabled}
                onCheckedChange={(checked) => onUsagePaceAlertEnabledChange(checked === true)}
              />
              Warn when on pace to run out before reset
            </label>
            <label className="flex items-center gap-2 text-sm select-none text-foreground">
              <Checkbox
                key={`usage-spike-alert-enabled-${usageSpikeAlertEnabled}`}
                checked={usageSpikeAlertEnabled}
                onCheckedChange={(checked) => onUsageSpikeAlertEnabledChange(checked === true)}
              />
              Notify when 7-day estimated spend jumps vs prior 7 days
            </label>
            {usageSpikeAlertEnabled ? (
              <div className="flex gap-1" role="radiogroup" aria-label="Spend spike threshold">
                {([25, 50, 100] as const).map((pct) => (
                  <Button
                    key={pct}
                    type="button"
                    role="radio"
                    aria-checked={usageSpikeAlertThresholdPct === pct}
                    variant={usageSpikeAlertThresholdPct === pct ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => onUsageSpikeAlertThresholdPctChange(pct)}
                  >
                    {pct}%
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="bg-muted/50 rounded-lg p-1">
              <div className="flex gap-1" role="radiogroup" aria-label="Usage alert threshold">
                {USAGE_ALERT_THRESHOLD_OPTIONS.map((option) => {
                  const isActive = option.value === usageAlertThreshold
                  return (
                    <Button
                      key={String(option.value)}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => onUsageAlertThresholdChange(option.value)}
                    >
                      {option.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            {usageAlertThreshold === "custom" && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Custom threshold (%)</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={customUsageAlertThreshold ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value
                    const next = raw === "" ? null : Number.parseInt(raw, 10)
                    if (next == null) {
                      onUsageAlertCustomThresholdChange(null)
                      return
                    }
                    if (!Number.isFinite(next)) {
                      onUsageAlertCustomThresholdChange(null)
                      return
                    }
                    onUsageAlertCustomThresholdChange(Math.max(1, Math.min(99, next)))
                  }}
                  className="flex h-9 w-20 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Sound</span>
              <select
                value={usageAlertSound}
                onChange={(e) => onUsageAlertSoundChange(e.target.value as UsageAlertSound)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {USAGE_ALERT_SOUND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Notifications use the OS tray/center (Linux: top bar; Windows: Action Center).
              Pop-up banners and volume depend on system notification settings. CrossUsage also
              plays the selected alert sound when supported (paplay on Linux, SystemSounds on
              Windows, afplay on macOS).
            </p>

            <Button
              type="button"
              className="w-full"
              onClick={() => {
                void sendNotificationAsync({
                  title: "Usage Alert Test",
                  body: "If you see this in the notification menu, alerts work. You should hear the selected sound.",
                  sound: usageAlertSound,
                  attachments: [{ id: "icon", url: "asset:///icon.png" }],
                })
                  .then(() =>
                    setUsageAlertTestMessage(
                      "Test sent — check the notification menu (top bar) and listen for the alert sound."
                    )
                  )
                  .catch((error) => {
                    console.error("Failed to send test notification:", error)
                    const msg =
                      error instanceof Error ? error.message : "Failed to send notification"
                    setUsageAlertTestMessage(msg)
                  })
              }}
            >
              Send Test Notification
            </Button>
            {usageAlertTestMessage ? (
              <span className="text-xs text-muted-foreground">{usageAlertTestMessage}</span>
            ) : null}
          </div>
        )}
      </section>
      </>
      ) : null}
      {showModernSection("providers") ? (
      <section>
        <h3 className="text-lg font-semibold mb-0">Plugins</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Your AI coding lineup
        </p>
        <div className="bg-muted/50 rounded-lg p-1 space-y-1">
          {shouldApplyProviderAccountDevMock() ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 m-1">
              <span className="font-medium">Dev server</span>: <code className="font-mono">VITE_PROVIDER_ACCOUNT_DEV_MOCK</code>{" "}
              is set in the environment (shell command or <code className="font-mono">.env</code>). Add account / Set
              credentials saves mock tokens only. Remove it and restart dev to store pasted credentials.
            </div>
          ) : null}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={plugins.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {plugins.map((plugin) => (
                <SortablePluginItem
                  key={plugin.id}
                  plugin={plugin}
                  onToggle={onToggle}
                  onTrayLineToggle={onTrayLineToggle}
                  onAddAccount={openAddAccountForm}
                  onUpdateCredentials={openCredentialForm}
                  onRenameAccount={openRenameForm}
                  onRemoveAccount={onRemoveProviderAccount}
                  cursorRequestsLineAvailable={cursorRequestsLineAvailable}
                  hideTrayLines={isModern}
                  accountFormSlot={
                    accountForm && accountFormAnchorPluginId(accountForm) === plugin.id ? (
                      <div className="pt-2 mt-2 border-t border-border">
                        <ProviderAccountForm
                          form={accountForm}
                          onChange={setAccountForm}
                          onCancel={() => {
                            setDevMockSaveNotice(null);
                            setAccountForm(null);
                          }}
                          onSubmit={submitAccountForm}
                          devMockCredentialHint={
                            shouldApplyProviderAccountDevMock() &&
                            (accountForm.mode === "add" || accountForm.mode === "credentials")
                          }
                        />
                      </div>
                    ) : null
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </section>
      ) : null}
      <TrayReadoutDialog
        dialog={trayReadoutDialog}
        plugins={plugins}
        onClose={() => setTrayReadoutDialog(null)}
        onApply={(pluginId, lineLabel, nextStyle) => {
          onSetTrayReadout(pluginId, lineLabel);
          onMenubarIconStyleChange(nextStyle);
          setTrayReadoutDialog(null);
        }}
      />
    </div>
  );
}
