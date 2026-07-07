import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useProbe } from "@/hooks/app/use-probe"
import type { PluginSettings } from "@/lib/settings"
import { useAppPluginStore } from "@/stores/app-plugin-store"

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}))

describe("useProbe", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    listenMock.mockReset()
    listenMock.mockResolvedValue(vi.fn())
    useAppPluginStore.setState({ pluginSettings: null, pluginsMeta: [] })
    invokeMock.mockImplementation(async (_cmd: string, args: any) => ({
      batchId: args.batchId,
      pluginIds: args.probeTargets?.map((target: { instanceId: string }) => target.instanceId) ?? args.pluginIds ?? [],
    }))
  })

  it("keeps startBatch stable while resolving latest provider account settings", async () => {
    const initialSettings: PluginSettings = {
      order: ["cursor"],
      disabled: [],
      providerInstances: {},
      trayLines: {},
    }
    const accountSettings: PluginSettings = {
      order: ["cursor:work"],
      disabled: [],
      providerInstances: {
        "cursor:work": { baseProviderId: "cursor", label: "Work" },
      },
      trayLines: {},
    }

    const { result, rerender } = renderHook(
      ({ pluginSettings }) =>
        useProbe({
          pluginSettings,
          autoUpdateInterval: 15,
        }),
      { initialProps: { pluginSettings: initialSettings } }
    )

    const firstStartBatch = result.current.startBatch
    rerender({ pluginSettings: accountSettings })

    expect(result.current.startBatch).toBe(firstStartBatch)

    await act(async () => {
      await result.current.startBatch(["cursor:work"])
    })

    expect(invokeMock).toHaveBeenCalledWith(
      "start_probe_batch",
      expect.objectContaining({
        pluginIds: ["cursor:work"],
        probeTargets: [
          {
            instanceId: "cursor:work",
            baseProviderId: "cursor",
            label: "Work",
          },
        ],
      })
    )
  })

  it("uses zustand store for probe targets before React rerenders", async () => {
    const initialSettings: PluginSettings = {
      order: ["cursor"],
      disabled: [],
      providerInstances: {},
      trayLines: {},
    }
    const accountSettings: PluginSettings = {
      order: ["cursor", "cursor:work"],
      disabled: [],
      providerInstances: {
        "cursor:work": { baseProviderId: "cursor", label: "Work" },
      },
      trayLines: {},
    }

    const { result } = renderHook(() =>
      useProbe({
        pluginSettings: initialSettings,
        autoUpdateInterval: 15,
      })
    )

    useAppPluginStore.getState().setPluginSettings(accountSettings)

    await act(async () => {
      await result.current.startBatch(["cursor:work"])
    })

    expect(invokeMock).toHaveBeenCalledWith(
      "start_probe_batch",
      expect.objectContaining({
        probeTargets: [
          {
            instanceId: "cursor:work",
            baseProviderId: "cursor",
            label: "Work",
          },
        ],
      })
    )
  })
})
