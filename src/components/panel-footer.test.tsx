import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { PanelFooter } from "@/components/panel-footer"
import { I18nProvider } from "@/components/i18n-provider"
import type { UpdateStatus } from "@/hooks/use-app-update"

function renderFooter(props: React.ComponentProps<typeof PanelFooter>) {
  return render(
    <I18nProvider>
      <PanelFooter {...props} />
    </I18nProvider>,
  )
}

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

const idle: UpdateStatus = { status: "idle" }
const noop = () => {}
const footerProps = { showAbout: false, onShowAbout: noop, onCloseAbout: noop, onUpdateCheck: noop }

describe("PanelFooter", () => {
  it("shows countdown in minutes when >= 60 seconds", () => {
    const futureTime = Date.now() + 5 * 60 * 1000
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: futureTime,
      updateStatus: idle,
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(screen.getByText("Next update in 5m")).toBeTruthy()
  })

  it("shows countdown in seconds when < 60 seconds", () => {
    const futureTime = Date.now() + 30 * 1000
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: futureTime,
      updateStatus: idle,
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(screen.getByText("Next update in 30s")).toBeTruthy()
  })

  it("triggers refresh when clicking countdown label", async () => {
    const futureTime = Date.now() + 5 * 60 * 1000
    const onRefreshAll = vi.fn()
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: futureTime,
      updateStatus: idle,
      onUpdateInstall: noop,
      onRefreshAll,
      ...footerProps,
    })
    const button = screen.getByRole("button", { name: /Next update in/i })
    await userEvent.click(button)
    expect(onRefreshAll).toHaveBeenCalledTimes(1)
  })

  it("shows Paused when autoUpdateNextAt is null", () => {
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: idle,
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(screen.getByText("Paused")).toBeTruthy()
  })

  it("shows downloading state", () => {
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: { status: "downloading", progress: 42 },
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(screen.getByText("Downloading update 42%")).toBeTruthy()
  })

  it("shows downloading state without percentage when progress is unknown", () => {
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: { status: "downloading", progress: -1 },
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(screen.getByText("Downloading update…")).toBeTruthy()
  })

  it("shows restart button when ready", async () => {
    const onInstall = vi.fn()
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: { status: "ready", version: "2.0.0" },
      onUpdateInstall: onInstall,
      ...footerProps,
    })
    const button = screen.getByRole("button", { name: /Ready to update/i })
    expect(button).toBeTruthy()
    await userEvent.click(button)
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("shows retryable updates soon state for update check failures", async () => {
    const onUpdateCheck = vi.fn()
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: { status: "error", message: "Update check failed" },
      onUpdateInstall: noop,
      showAbout: false,
      onShowAbout: noop,
      onCloseAbout: noop,
      onUpdateCheck,
    })

    const retryButton = screen.getByRole("button", { name: "Updates soon" })
    expect(retryButton).toBeTruthy()
    await userEvent.click(retryButton)
    expect(onUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it("shows error state for non-check failures", () => {
    const { container } = renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: { status: "error", message: "Download failed" },
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(container.textContent).toContain("Update failed")
    expect(screen.queryByRole("button", { name: "Updates soon" })).toBeNull()
  })

  it("shows installing state", () => {
    renderFooter({
      version: "0.0.0",
      autoUpdateNextAt: null,
      updateStatus: { status: "installing" },
      onUpdateInstall: noop,
      ...footerProps,
    })
    expect(screen.getByText("Installing…")).toBeTruthy()
  })

  it("opens About dialog when clicking version in idle state", async () => {
    function Harness() {
      const [showAbout, setShowAbout] = useState(false)
      return (
        <I18nProvider>
          <PanelFooter
            version="0.0.0"
            autoUpdateNextAt={null}
            updateStatus={idle}
            onUpdateInstall={noop}
            showAbout={showAbout}
            onShowAbout={() => setShowAbout(true)}
            onCloseAbout={() => setShowAbout(false)}
            onUpdateCheck={noop}
          />
        </I18nProvider>
      )
    }

    render(<Harness />)
    await userEvent.click(screen.getByRole("button", { name: /^CrossUsage / }))
    await screen.findByRole("heading", { name: "CrossUsage" })

    await userEvent.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "CrossUsage" })).not.toBeInTheDocument()
    })
  })
})
