import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProbeState } from "@/hooks/app/use-probe-state"
import type { PluginOutput } from "@/lib/plugin-types"

function output(providerId: string, value: string): PluginOutput {
  return {
    providerId,
    displayName: providerId,
    iconUrl: "",
    lines: [{ type: "text", label: "Usage", value }],
  }
}

describe("useProbeState", () => {
  it("stores provider account probe results in separate slots", () => {
    const onProbeResult = vi.fn()
    const { result } = renderHook(() => useProbeState({ onProbeResult }))

    act(() => {
      result.current.setLoadingForPlugins(["claude:work", "claude:personal"])
    })
    act(() => {
      result.current.handleProbeResult(output("claude:work", "10%"))
      result.current.handleProbeResult(output("claude:personal", "20%"))
    })

    expect(result.current.pluginStates["claude:work"]?.data?.lines[0]).toMatchObject({
      label: "Usage",
      value: "10%",
    })
    expect(result.current.pluginStates["claude:personal"]?.data?.lines[0]).toMatchObject({
      label: "Usage",
      value: "20%",
    })
    expect(result.current.pluginStates["claude:work"]?.loading).toBe(false)
    expect(result.current.pluginStates["claude:personal"]?.loading).toBe(false)
    expect(onProbeResult).toHaveBeenCalledTimes(2)
  })

  it("finalizeStaleProbeLoading clears stuck loading without clobbering prior data", () => {
    const { result } = renderHook(() => useProbeState({}))

    act(() => {
      result.current.setLoadingForPlugins(["a", "b"])
    })
    act(() => {
      result.current.handleProbeResult(output("a", "10%"))
    })
    expect(result.current.pluginStates["a"]?.loading).toBe(false)
    expect(result.current.pluginStates["b"]?.loading).toBe(true)

    act(() => {
      result.current.finalizeStaleProbeLoading(["a", "b"])
    })

    expect(result.current.pluginStates["a"]?.loading).toBe(false)
    expect(result.current.pluginStates["a"]?.error).toBeNull()
    expect(result.current.pluginStates["a"]?.data?.lines[0]).toMatchObject({ value: "10%" })
    expect(result.current.pluginStates["b"]?.loading).toBe(false)
    expect(result.current.pluginStates["b"]?.error).toBe("Probe did not return data")
    expect(result.current.pluginStates["b"]?.data).toBeNull()
  })
})
