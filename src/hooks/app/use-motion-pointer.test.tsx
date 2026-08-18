import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useMotionPointer } from "@/hooks/app/use-motion-pointer"

function Probe({ enabled }: { enabled: boolean }) {
  const ref = useMotionPointer(enabled)
  return <div data-testid="host" ref={ref} />
}

describe("useMotionPointer", () => {
  it("writes --mx/--my only (no panel tilt/scale) and resets when disabled", () => {
    const { getByTestId, rerender } = render(<Probe enabled />)
    const host = getByTestId("host")
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }) as DOMRect

    fireEvent.pointerMove(host, { clientX: 80, clientY: 20 })
    expect(host.style.getPropertyValue("--mx")).toBe("0.800")
    expect(host.style.getPropertyValue("--my")).toBe("0.200")
    expect(host.style.getPropertyValue("--tilt-y")).toBe("")
    expect(host.style.getPropertyValue("--panel-scale")).toBe("")

    rerender(<Probe enabled={false} />)
    expect(host.style.getPropertyValue("--mx")).toBe("0.5")
    expect(host.style.getPropertyValue("--tilt-x")).toBe("")
  })
})
