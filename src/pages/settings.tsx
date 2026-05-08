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
import { useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { GlobalShortcutSection } from "@/components/global-shortcut-section";
import { getBarFillLayout } from "@/lib/tray-bars-icon";
import { getTrayIconSizePx } from "@/lib/tray-icon-size";
import {
  AUTO_UPDATE_OPTIONS,
  DISPLAY_MODE_OPTIONS,
  MENUBAR_ICON_STYLE_OPTIONS,
  RESET_TIMER_DISPLAY_OPTIONS,
  THEME_OPTIONS,
  UI_SCALE_OPTIONS,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type UIScale,
} from "@/lib/settings";
import type { TraySettingsPreview } from "@/hooks/app/use-tray-icon";
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list";
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress";
import {
  buildDevMockProviderCredentials,
  shouldApplyProviderAccountDevMock,
} from "@/lib/provider-account-dev-mock";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { multiAccountCredentialsGuideUrl } from "@/lib/docs-links";

const MENUBAR_STYLES_NEED_CURSOR_TRAY_PICK = new Set<MenubarIconStyle>([
  "provider",
  "donut",
  "logoBar",
  "logoGrid",
]);

const CURSOR_TRAY_METRIC_CHOICES = [
  "Credits",
  "Total usage",
  "Auto usage",
  "API usage",
  "Requests",
] as const;

function pickDefaultCursorTrayLine(plugins: SettingsPluginState[]): string {
  const row = plugins.find((p) => p.enabled && p.baseProviderId === "cursor");
  const first = row?.trayLines?.[0];
  if (first && (CURSOR_TRAY_METRIC_CHOICES as readonly string[]).includes(first)) {
    return first;
  }
  return "Total usage";
}

/** Primary progress fraction for tray preview (bars store values under `items[].fraction`). */
function trayBarPrimaryFraction(bar: TrayPrimaryBar | undefined): number {
  return bar?.items[0]?.fraction ?? 0;
}

const TRAY_PREVIEW_SIZE_PX = getTrayIconSizePx(1);

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
  const colorClass = isActive ? "bg-primary-foreground" : "bg-foreground";
  if (iconUrl) {
    return (
      <div
        aria-hidden
        className={cn("shrink-0", colorClass, className)}
        style={{
          width: `${sizePx}px`,
          height: `${sizePx}px`,
          WebkitMaskImage: `url(${iconUrl})`,
          WebkitMaskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskImage: `url(${iconUrl})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
        }}
      />
    );
  }
  const textClass = isActive ? "text-primary-foreground" : "text-foreground";
  return (
    <svg aria-hidden viewBox="0 0 26 26" className={cn("shrink-0", textClass, className)} style={{ width: `${sizePx}px`, height: `${sizePx}px` }}>
      <circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" strokeWidth="3.5" opacity={0.3} />
    </svg>
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
    const fraction = trayBarPrimaryFraction(traySettingsPreview.providerBars[0]);
    return (
      <ProviderLogoFillPreview
        iconUrl={traySettingsPreview.providerIconUrl}
        fraction={fraction}
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
            fraction={trayBarPrimaryFraction(bar)}
            isActive={isActive}
            sizePx={Math.max(9, Math.round(TRAY_PREVIEW_SIZE_PX * 0.48))}
          />
        ))}
      </div>
    );
  }

  if (style === "donut") {
    const fraction = trayBarPrimaryFraction(traySettingsPreview.providerBars[0]);
    return (
      <ProviderLogoPiePreview
        iconUrl={traySettingsPreview.providerIconUrl}
        fraction={fraction}
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
        {plugin.primaryCandidates.length > 0 && (
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
        {(plugin.baseProviderId === "claude" || plugin.baseProviderId === "cursor") && (
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
          Tokens are saved locally in CrossUsage app data.
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
        {form.mode !== "rename" &&
        (form.baseProviderId === "cursor" || form.baseProviderId === "claude") ? (
          <p className="text-xs text-muted-foreground">
            <button
              type="button"
              className="text-primary underline underline-offset-2 hover:no-underline"
              onClick={() => openUrl(multiAccountCredentialsGuideUrl()).catch(console.error)}
            >
              Step-by-step: where to copy tokens (opens GitHub)
            </button>
          </p>
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
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Session key (optional)</span>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
              value={form.sessionKey}
              autoComplete="off"
              onChange={(event) => onChange({ ...form, sessionKey: event.target.value })}
            />
          </label>
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
  displayMode: DisplayMode;
  onDisplayModeChange: (value: DisplayMode) => void;
  resetTimerDisplayMode: ResetTimerDisplayMode;
  onResetTimerDisplayModeChange: (value: ResetTimerDisplayMode) => void;
  menubarIconStyle: MenubarIconStyle;
  onMenubarIconStyleChange: (value: MenubarIconStyle) => void;
  traySettingsPreview: TraySettingsPreview;
  globalShortcut: GlobalShortcut;
  onGlobalShortcutChange: (value: GlobalShortcut) => void;
  startOnLogin: boolean;
  onStartOnLoginChange: (value: boolean) => void;
  uiScale: UIScale;
  onUIScaleChange: (value: UIScale) => void;
  /** Sets the same single tray line for every enabled Cursor account (used when picking single-provider icon styles). */
  onSetCursorTrayMetricForAllAccounts: (lineLabel: string) => void;
  /** Cursor-only: whether the Requests line exists in probe data (null = loading). */
  cursorRequestsLineAvailable: boolean | null;
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
  displayMode,
  onDisplayModeChange,
  resetTimerDisplayMode,
  onResetTimerDisplayModeChange,
  menubarIconStyle,
  onMenubarIconStyleChange,
  traySettingsPreview,
  globalShortcut,
  onGlobalShortcutChange,
  startOnLogin,
  onStartOnLoginChange,
  uiScale,
  onUIScaleChange,
  onSetCursorTrayMetricForAllAccounts,
  cursorRequestsLineAvailable,
}: SettingsPageProps) {
  const [accountForm, setAccountForm] = useState<AccountFormState | null>(null);
  const [devMockSaveNotice, setDevMockSaveNotice] = useState<string | null>(null);
  const [cursorTrayIconDialog, setCursorTrayIconDialog] = useState<{
    nextStyle: MenubarIconStyle;
    selectedLine: string;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleMenubarIconStyleOptionClick = (style: MenubarIconStyle) => {
    if (style === menubarIconStyle) return;
    const needsPick =
      MENUBAR_STYLES_NEED_CURSOR_TRAY_PICK.has(style) &&
      plugins.some((p) => p.enabled && p.baseProviderId === "cursor");
    if (needsPick) {
      setCursorTrayIconDialog({
        nextStyle: style,
        selectedLine: pickDefaultCursorTrayLine(plugins),
      });
      return;
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
    <div className="py-3 space-y-4">
      {devMockSaveNotice ? (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
          role="status"
        >
          {devMockSaveNotice}
        </div>
      ) : null}
      <section>
        <h3 className="text-lg font-semibold mb-0">Auto Refresh</h3>
        <p className="text-sm text-muted-foreground mb-2">
          How obsessive are you
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label="Auto-update interval">
            {AUTO_UPDATE_OPTIONS.map((option) => {
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
        <h3 className="text-lg font-semibold mb-0">Usage Mode</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Glass half full or half empty
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label="Usage display mode">
            {DISPLAY_MODE_OPTIONS.map((option) => {
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
        <h3 className="text-lg font-semibold mb-0">Reset Timers</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Countdown or clock time
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label="Reset timer display mode">
            {RESET_TIMER_DISPLAY_OPTIONS.map((option) => {
              const isActive = option.value === resetTimerDisplayMode;
              const absoluteTimeExample = new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(2026, 1, 2, 11, 4));
              const example = option.value === "relative" ? "5h 12m" : `today at ${absoluteTimeExample}`;
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
        <h3 className="text-lg font-semibold mb-0">Tray / menu bar icon</h3>
        <p className="text-sm text-muted-foreground mb-2">
          What shows next to the clock (Linux/Windows) or in the menu bar (macOS). New installs default to Plugin
          (provider logo + usage). When Cursor is enabled and you pick Plugin, Logo fill, Logo grid, or Pie, you can
          choose which Cursor metric drives the readout (Credits show as dollars in the tray).
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label="Menubar icon style">
            {MENUBAR_ICON_STYLE_OPTIONS.map((option) => {
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
      </section>
      <section>
        <h3 className="text-lg font-semibold mb-0">App Theme</h3>
        <p className="text-sm text-muted-foreground mb-2">
          How it looks around here
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label="Theme mode">
            {THEME_OPTIONS.map((option) => {
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
        <h3 className="text-lg font-semibold mb-0">Interface scale</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Text and spacing density in the main window
        </p>
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="flex gap-1" role="radiogroup" aria-label="Interface scale">
            {UI_SCALE_OPTIONS.map((option) => {
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
      </section>
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
      {cursorTrayIconDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => setCursorTrayIconDialog(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cursor-tray-dialog-title"
            className="max-w-md w-full rounded-lg border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="cursor-tray-dialog-title" className="text-base font-semibold text-foreground">
              Cursor tray readout
            </h3>
            <p className="text-sm text-muted-foreground mt-1 mb-3">
              Pick the Cursor metric for this icon style. Credits use dollar amounts in the tray; other lines use your
              usage mode (Used vs Left) like the rest of the app. You can still adjust line checkboxes per account under
              Plugins.
            </p>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Cursor tray metric">
              {CURSOR_TRAY_METRIC_CHOICES.map((line) => (
                <label key={line} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="radio"
                    name="cursor-tray-metric"
                    className="accent-primary"
                    checked={cursorTrayIconDialog.selectedLine === line}
                    onChange={() =>
                      setCursorTrayIconDialog((d) => (d ? { ...d, selectedLine: line } : d))
                    }
                  />
                  <span>{line}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setCursorTrayIconDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onSetCursorTrayMetricForAllAccounts(cursorTrayIconDialog.selectedLine);
                  onMenubarIconStyleChange(cursorTrayIconDialog.nextStyle);
                  setCursorTrayIconDialog(null);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
