import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

let latestOnDragEnd: ((event: any) => void) | undefined

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: (event: any) => void }) => {
    latestOnDragEnd = onDragEnd
    return <div data-testid="dnd-context">{children}</div>
  },
  closestCenter: vi.fn(),
  PointerSensor: class { },
  KeyboardSensor: class { },
  useSensor: vi.fn((_sensor: any, options?: any) => ({ sensor: _sensor, options })),
  useSensors: vi.fn((...sensors: any[]) => sensors),
}))

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: (items: any[], from: number, to: number) => {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  },
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

import { openUrl } from "@tauri-apps/plugin-opener"
import { SettingsPage } from "@/pages/settings"
import { I18nProvider } from "@/components/i18n-provider"

function renderSettings(props: React.ComponentProps<typeof SettingsPage>) {
  return render(
    <I18nProvider>
      <SettingsPage {...props} />
    </I18nProvider>,
  )
}

const defaultProps = {
  plugins: [{ id: "a", baseProviderId: "a", name: "Alpha", enabled: true, primaryCandidates: [], trayLines: [] }],
  onReorder: vi.fn(),
  onToggle: vi.fn(),
  onTrayLineToggle: vi.fn(),
  onAddProviderAccount: vi.fn(),
  onUpdateProviderAccountCredentials: vi.fn(),
  onRenameProviderAccount: vi.fn(),
  onRemoveProviderAccount: vi.fn(),
  autoUpdateInterval: 15 as const,
  onAutoUpdateIntervalChange: vi.fn(),
  themeMode: "system" as const,
  onThemeModeChange: vi.fn(),
  uiLayout: "classic" as const,
  onUILayoutChange: vi.fn(),
  modernDensity: "regular" as const,
  onModernDensityChange: vi.fn(),
  displayMode: "used" as const,
  onDisplayModeChange: vi.fn(),
  resetTimerDisplayMode: "relative" as const,
  onResetTimerDisplayModeChange: vi.fn(),
  timeFormatMode: "auto" as const,
  onTimeFormatModeChange: vi.fn(),
  appLocale: "auto" as const,
  onAppLocaleChange: vi.fn(),
  displayCurrency: "auto" as const,
  onDisplayCurrencyChange: vi.fn(),
  menubarIconStyle: "provider" as const,
  onMenubarIconStyleChange: vi.fn(),
  preferMenubarWeeklyLimit: false,
  onPreferMenubarWeeklyLimitChange: vi.fn(),
  traySettingsPreview: {
    bars: [{ id: "a", items: [{ label: "Primary", fraction: 0.7 }] }],
    providerBars: [{ id: "a", items: [{ label: "Primary", fraction: 0.7 }] }],
    providerIconUrl: "icon-a",
    providerIconUrls: { a: "icon-a" },
    providerPercentText: "70%",
  },
  globalShortcut: null,
  onGlobalShortcutChange: vi.fn(),
  startOnLogin: false,
  onStartOnLoginChange: vi.fn(),
  usageAlertEnabled: false,
  onUsageAlertEnabledChange: vi.fn(),
  usageAlertThreshold: 20 as const,
  onUsageAlertThresholdChange: vi.fn(),
  customUsageAlertThreshold: null,
  onUsageAlertCustomThresholdChange: vi.fn(),
  usageAlertSound: "Basso" as const,
  onUsageAlertSoundChange: vi.fn(),
  usagePaceAlertEnabled: true,
  onUsagePaceAlertEnabledChange: vi.fn(),
  usageSpikeAlertEnabled: false,
  onUsageSpikeAlertEnabledChange: vi.fn(),
  usageSpikeAlertThresholdPct: 50 as const,
  onUsageSpikeAlertThresholdPctChange: vi.fn(),
  uiScale: "normal" as const,
  onUIScaleChange: vi.fn(),
  showAccountIdentity: true,
  onShowAccountIdentityChange: vi.fn(),
  cursorRequestsLineAvailable: null,
  onSetCursorTrayMetricForAllAccounts: vi.fn(),
}

afterEach(() => {
  cleanup()
})

describe("SettingsPage", () => {
  it("toggles plugins", async () => {
    const onToggle = vi.fn()
    renderSettings({
      ...defaultProps,
      plugins: [
          { id: "b", baseProviderId: "b", name: "Beta", enabled: false, primaryCandidates: [], trayLines: [] },
        ],
      onToggle,
    })
    const checkboxes = screen.getAllByRole("checkbox")
    await userEvent.click(checkboxes[checkboxes.length - 1])
    expect(onToggle).toHaveBeenCalledWith("b")
  })

  it("reorders plugins on drag end", () => {
    const onReorder = vi.fn()
    renderSettings({
      ...defaultProps,
      plugins: [
          { id: "a", baseProviderId: "a", name: "Alpha", enabled: true, primaryCandidates: [], trayLines: [] },
          { id: "b", baseProviderId: "b", name: "Beta", enabled: true, primaryCandidates: [], trayLines: [] },
        ],
      onReorder,
    })
    latestOnDragEnd?.({ active: { id: "a" }, over: { id: "b" } })
    expect(onReorder).toHaveBeenCalledWith(["b", "a"])
  })

  it("ignores invalid drag end", () => {
    const onReorder = vi.fn()
    renderSettings({
      ...defaultProps,
      onReorder,
    })
    latestOnDragEnd?.({ active: { id: "a" }, over: null })
    latestOnDragEnd?.({ active: { id: "a" }, over: { id: "a" } })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it("shows account controls and submits inline account forms", async () => {
    const user = userEvent.setup()
    const onAddProviderAccount = vi.fn()
    const onUpdateProviderAccountCredentials = vi.fn()
    const onRenameProviderAccount = vi.fn()
    const onRemoveProviderAccount = vi.fn()
    renderSettings({
      ...defaultProps,
      plugins: [
          { id: "claude", baseProviderId: "claude", name: "Claude", enabled: true, primaryCandidates: [], trayLines: [] },
          {
            id: "claude:work",
            baseProviderId: "claude",
            instanceLabel: "Work",
            name: "Claude (Work)",
            enabled: true,
            primaryCandidates: [],
            trayLines: [],
          },
        ],
      onAddProviderAccount,
      onUpdateProviderAccountCredentials,
      onRenameProviderAccount,
      onRemoveProviderAccount,
    })

    await user.click(screen.getByRole("button", { name: "Add account" }))
    await user.type(screen.getByLabelText("Access token"), "claude-work-token")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await user.click(screen.getAllByRole("button", { name: "Set credentials" })[1])
    await user.clear(screen.getByLabelText("Account label"))
    await user.type(screen.getByLabelText("Account label"), "Work")
    await user.type(screen.getByLabelText("Access token"), "updated-token")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await user.click(screen.getByRole("button", { name: "Rename" }))
    await user.clear(screen.getByLabelText("Account label"))
    await user.type(screen.getByLabelText("Account label"), "Personal")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await user.click(screen.getByRole("button", { name: "Remove account" }))

    expect(onAddProviderAccount).toHaveBeenCalledWith("claude", {
      label: "Work",
      accessToken: "claude-work-token",
      refreshToken: "",
      sessionKey: "",
    })
    expect(onUpdateProviderAccountCredentials).toHaveBeenCalledWith("claude:work", {
      label: "Work",
      accessToken: "updated-token",
      refreshToken: "",
      sessionKey: "",
    })
    expect(onRenameProviderAccount).toHaveBeenCalledWith("claude:work", "Personal")
    expect(onRemoveProviderAccount).toHaveBeenCalledWith("claude:work")
  })

  it("opens GitHub tutorial when adding a Claude account", async () => {
    const user = userEvent.setup()
    vi.mocked(openUrl).mockClear()
    renderSettings({
      ...defaultProps,
      plugins: [
          { id: "claude", baseProviderId: "claude", name: "Claude", enabled: true, primaryCandidates: [], trayLines: [] },
        ],
    })
    await user.click(screen.getByRole("button", { name: "Add account" }))
    await user.click(screen.getByRole("button", { name: "Step-by-step: where to copy tokens (opens GitHub)" }))
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/barramee27/crossusage/blob/HEAD/docs/providers/multi-account-credentials.md"
    )
  })

  it("updates auto-update interval", async () => {
    const onAutoUpdateIntervalChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onAutoUpdateIntervalChange,
    })
    await userEvent.click(screen.getByText("30 min"))
    expect(onAutoUpdateIntervalChange).toHaveBeenCalledWith(30)
  })

  it("shows auto-update helper text", () => {
    renderSettings({ ...defaultProps })
    expect(screen.getByText("How obsessive are you")).toBeInTheDocument()
  })

  it("renders app theme section with theme options", () => {
    renderSettings({ ...defaultProps })
    expect(screen.getByText("App Theme")).toBeInTheDocument()
    expect(screen.getByText("How it looks around here")).toBeInTheDocument()
    expect(screen.getByText("System")).toBeInTheDocument()
    expect(screen.getByText("Light")).toBeInTheDocument()
    expect(screen.getByText("Dark")).toBeInTheDocument()
    expect(screen.getByText("Glass")).toBeInTheDocument()
  })

  it("updates theme mode", async () => {
    const onThemeModeChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onThemeModeChange,
    })
    await userEvent.click(screen.getByText("Dark"))
    expect(onThemeModeChange).toHaveBeenCalledWith("dark")
  })

  it("updates glass theme mode", async () => {
    const onThemeModeChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onThemeModeChange,
    })
    await userEvent.click(screen.getByText("Glass"))
    expect(onThemeModeChange).toHaveBeenCalledWith("glass")
  })

  it("updates display mode", async () => {
    const onDisplayModeChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onDisplayModeChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: "Left" }))
    expect(onDisplayModeChange).toHaveBeenCalledWith("left")
  })

  it("updates reset timer display mode", async () => {
    const onResetTimerDisplayModeChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onResetTimerDisplayModeChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: /Absolute/ }))
    expect(onResetTimerDisplayModeChange).toHaveBeenCalledWith("absolute")
  })

  it("renders renamed usage section heading", () => {
    renderSettings({ ...defaultProps })
    expect(screen.getByText("Usage Mode")).toBeInTheDocument()
  })

  it("renders reset timers section heading", () => {
    renderSettings({ ...defaultProps })
    expect(screen.getByText("Reset Timers")).toBeInTheDocument()
  })

  it("renders time format section heading", () => {
    renderSettings({ ...defaultProps })
    expect(screen.getByText("Time Format")).toBeInTheDocument()
    expect(screen.getByText("12-hour or 24-hour clock")).toBeInTheDocument()
  })

  it("updates time format mode to 12h", async () => {
    const onTimeFormatModeChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onTimeFormatModeChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: "12-hour" }))
    expect(onTimeFormatModeChange).toHaveBeenCalledWith("12h")
  })

  it("updates time format mode to 24h", async () => {
    const onTimeFormatModeChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onTimeFormatModeChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: "24-hour" }))
    expect(onTimeFormatModeChange).toHaveBeenCalledWith("24h")
  })

  it("renders menubar icon section", () => {
    renderSettings({ ...defaultProps })
    expect(screen.getByText("Tray / menu bar icon")).toBeInTheDocument()
    expect(
      screen.getByText(/What shows next to the clock/i),
    ).toBeInTheDocument()
  })

  it("clicking Battery bars triggers onMenubarIconStyleChange(\"bars\")", async () => {
    const onMenubarIconStyleChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onMenubarIconStyleChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: "Battery bars" }))
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("bars")
  })

  it("clicking Pie chart triggers onMenubarIconStyleChange(\"donut\")", async () => {
    const onMenubarIconStyleChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onMenubarIconStyleChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: "Pie chart" }))
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("donut")
  })

  it("opens Cursor tray metric dialog when choosing Pie with Cursor enabled", async () => {
    const onMenubarIconStyleChange = vi.fn()
    const onSetCursorTrayMetricForAllAccounts = vi.fn()
    const user = userEvent.setup()
    renderSettings({
      ...defaultProps,
      menubarIconStyle: "bars",
      plugins: [
          {
            id: "cursor",
            baseProviderId: "cursor",
            name: "Cursor",
            enabled: true,
            primaryCandidates: ["Total usage"],
            trayLines: ["Total usage"],
          },
        ],
      onMenubarIconStyleChange,
      onSetCursorTrayMetricForAllAccounts,
    })
    await user.click(screen.getByRole("radio", { name: "Pie chart" }))
    expect(screen.getByRole("dialog", { name: "Cursor tray readout" })).toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: "Credits" }))
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(onSetCursorTrayMetricForAllAccounts).toHaveBeenCalledWith("Credits")
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("donut")
  })

  it("clicking Logo fill and All logos triggers tray style changes", async () => {
    const onMenubarIconStyleChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onMenubarIconStyleChange,
    })
    await userEvent.click(screen.getByRole("radio", { name: "Logo fill" }))
    await userEvent.click(screen.getByRole("radio", { name: "All logos" }))
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("logoBar")
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("logoGrid")
  })

  it("does not render removed bar icon controls", () => {
    renderSettings({ ...defaultProps })
    expect(screen.queryByText("Bar Icon")).not.toBeInTheDocument()
    expect(screen.queryByText("Show percentage")).not.toBeInTheDocument()
  })

  it("toggles menubar weekly limit preference", async () => {
    const onPreferMenubarWeeklyLimitChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onPreferMenubarWeeklyLimitChange,
    })

    await userEvent.click(screen.getByText("Prefer weekly limits when available"))
    expect(onPreferMenubarWeeklyLimitChange).toHaveBeenCalledWith(true)
  })

  it("toggles start on login checkbox", async () => {
    const onStartOnLoginChange = vi.fn()
    renderSettings({
      ...defaultProps,
      onStartOnLoginChange,
    })
    await userEvent.click(screen.getByText("Start on login"))
    expect(onStartOnLoginChange).toHaveBeenCalledWith(true)
  })

  it("toggles account identity visibility", async () => {
    const onShowAccountIdentityChange = vi.fn()
    renderSettings({
      ...defaultProps,
      showAccountIdentity: false,
      onShowAccountIdentityChange,
    })
    await userEvent.click(screen.getByText("Show account identity"))
    expect(onShowAccountIdentityChange).toHaveBeenCalledWith(true)
  })
})
