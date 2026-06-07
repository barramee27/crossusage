import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OverviewPage } from "@/pages/overview"

vi.mock("@/hooks/use-weekly-rollup", () => ({
  useWeeklyRollup: () => ({
    dailyRows: [],
    rollup: null,
    rollup30: null,
    scheduleReload: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-spend-spike-alert", () => ({
  useSpendSpikeAlert: () => ({ checkSpendSpike: vi.fn() }),
}))

vi.mock("@/stores/app-ui-store", () => ({
  useAppUiStore: (selector: (s: { setActiveView: () => void }) => unknown) =>
    selector({ setActiveView: vi.fn() }),
}))

vi.mock("@/hooks/use-persist-usage-history", () => ({
  usePersistUsageHistory: () => false,
}))

describe("OverviewPage", () => {
  it("renders empty state", () => {
    render(
      <OverviewPage
        plugins={[]}
        pluginSettings={null}
        displayMode="used"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.getByText("No providers enabled")).toBeInTheDocument()
  })

  it("renders provider cards", () => {
    const plugins = [
      {
        meta: { id: "a", name: "Alpha", iconUrl: "icon", lines: [] },
        data: { providerId: "a", displayName: "Alpha", lines: [], iconUrl: "icon" },
        loading: false,
        error: null,
        lastManualRefreshAt: null,
        lastUpdatedAt: null,
      },
    ]
    render(
      <OverviewPage
        plugins={plugins}
        pluginSettings={null}
        displayMode="used"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.getByText("Alpha")).toBeInTheDocument()
  })

  it("only shows overview-scoped lines", () => {
    const plugins = [
      {
        meta: {
          id: "test",
          name: "Test",
          iconUrl: "icon",
          lines: [
            { type: "text" as const, label: "Primary", scope: "overview" as const },
            { type: "text" as const, label: "Secondary", scope: "detail" as const },
          ],
        },
        data: {
          providerId: "test",
          displayName: "Test",
          lines: [
            { type: "text" as const, label: "Primary", value: "Shown" },
            { type: "text" as const, label: "Secondary", value: "Hidden" },
          ],
          iconUrl: "icon",
        },
        loading: false,
        error: null,
        lastManualRefreshAt: null,
        lastUpdatedAt: null,
      },
    ]
    render(
      <OverviewPage
        plugins={plugins}
        pluginSettings={null}
        displayMode="used"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.getByText("Primary")).toBeInTheDocument()
    expect(screen.getByText("Shown")).toBeInTheDocument()
    expect(screen.queryByText("Secondary")).not.toBeInTheDocument()
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument()
  })

  it("does not show provider quick links in combined view", () => {
    const plugins = [
      {
        meta: {
          id: "alpha",
          name: "Alpha",
          iconUrl: "icon",
          lines: [],
          links: [{ label: "Status", url: "https://status.example.com" }],
        },
        data: { providerId: "alpha", displayName: "Alpha", lines: [], iconUrl: "icon" },
        loading: false,
        error: null,
        lastManualRefreshAt: null,
        lastUpdatedAt: null,
      },
    ]

    render(
      <OverviewPage
        plugins={plugins}
        pluginSettings={null}
        displayMode="used"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.queryByRole("button", { name: /status/i })).toBeNull()
  })
})
