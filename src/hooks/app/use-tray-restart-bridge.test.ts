import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"

const { invokeMock, relaunchMock, unlistenMock, listenMock } = vi.hoisted(
  () => ({
    invokeMock: vi.fn(),
    relaunchMock: vi.fn(),
    unlistenMock: vi.fn(),
    listenMock: vi.fn(),
  }),
)

let trayRestartCallback: (() => void) | undefined

listenMock.mockImplementation((_event: string, cb: () => void) => {
  trayRestartCallback = cb
  return Promise.resolve(unlistenMock)
})

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => globalThis.isTauri === true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}))

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: relaunchMock,
}))

import { useTrayRestartBridge } from "@/hooks/app/use-tray-restart-bridge"

declare global {
  // eslint-disable-next-line no-var
  var isTauri: boolean | undefined
}

describe("useTrayRestartBridge", () => {
  const originalIsTauri = globalThis.isTauri
  const triggerInstall = vi.fn()

  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    relaunchMock.mockReset()
    listenMock.mockClear()
    listenMock.mockImplementation((_event: string, cb: () => void) => {
      trayRestartCallback = cb
      return Promise.resolve(unlistenMock)
    })
    triggerInstall.mockReset()
    unlistenMock.mockReset()
    trayRestartCallback = undefined
    globalThis.isTauri = true
  })

  afterAll(() => {
    if (originalIsTauri === undefined) {
      delete globalThis.isTauri
    } else {
      globalThis.isTauri = originalIsTauri
    }
  })

  it("invokes set_tray_restart_label when update is ready", async () => {
    const { rerender } = renderHook(
      ({ status }) =>
        useTrayRestartBridge(status, triggerInstall),
      {
        initialProps: {
          status: { status: "idle" } as const,
        },
      },
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_tray_restart_label", {
        text: "Restart",
      })
    })

    invokeMock.mockClear()
    rerender({ status: { status: "ready" } as const })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_tray_restart_label", {
        text: "Restart to update",
      })
    })
  })

  it("calls triggerInstall when tray event fires and status is ready", async () => {
    renderHook(() =>
      useTrayRestartBridge({ status: "ready" }, triggerInstall),
    )

    await waitFor(() => expect(trayRestartCallback).toBeDefined())
    await act(async () => {
      trayRestartCallback?.()
    })
    expect(triggerInstall).toHaveBeenCalledTimes(1)
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it("calls relaunch when tray event fires and no update is ready", async () => {
    relaunchMock.mockResolvedValue(undefined)
    renderHook(() =>
      useTrayRestartBridge({ status: "idle" }, triggerInstall),
    )

    await waitFor(() => expect(trayRestartCallback).toBeDefined())
    await act(async () => {
      trayRestartCallback?.()
    })
    expect(relaunchMock).toHaveBeenCalledTimes(1)
    expect(triggerInstall).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() =>
      useTrayRestartBridge({ status: "idle" }, triggerInstall),
    )
    await waitFor(() => expect(trayRestartCallback).toBeDefined())
    unmount()
    expect(unlistenMock).toHaveBeenCalled()
  })
})
