import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MotionField, fireMotionShock } from "@/components/motion-field"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"

describe("MotionField", () => {
  afterEach(() => {
    useAppPreferencesStore.getState().resetState()
    vi.useRealTimers()
  })

  it("renders aurora and orbs without grain rings or click ripples", () => {
    render(
      <div className="app-panel-surface">
        <MotionField />
      </div>,
    )
    expect(document.querySelectorAll(".motion-aurora").length).toBe(2)
    expect(document.querySelector(".motion-scan")).toBeTruthy()
    expect(document.querySelector(".motion-grid")).toBeTruthy()
    expect(document.querySelector(".motion-dust")).toBeTruthy()
    expect(document.querySelector(".motion-cursor")).toBeTruthy()
    expect(document.querySelectorAll(".motion-orb").length).toBe(12)
    expect(document.querySelector(".motion-grain")).toBeNull()
    expect(document.querySelector(".motion-ripple")).toBeNull()
  })

  it("hides when reduce animations is on", () => {
    useAppPreferencesStore.getState().setReduceAnimations(true)
    render(<MotionField />)
    expect(document.querySelector(".motion-field")).toBeNull()
  })

  it("spawns a shock ring on refresh burst", () => {
    vi.useFakeTimers()
    render(
      <div className="app-panel-surface">
        <MotionField />
      </div>,
    )
    act(() => {
      fireMotionShock()
    })
    expect(document.querySelector(".motion-shock-ring")).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(document.querySelector(".motion-shock-ring")).toBeNull()
    expect(screen.queryByRole("img")).toBeNull()
  })
})
