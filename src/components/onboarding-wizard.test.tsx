import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { OnboardingWizard } from "@/components/onboarding-wizard"

describe("OnboardingWizard", () => {
  it("invokes callbacks for Skip and Open Settings", async () => {
    const user = userEvent.setup()
    const onGetStarted = vi.fn()
    const onSkip = vi.fn()
    render(<OnboardingWizard onGetStarted={onGetStarted} onSkip={onSkip} />)

    await user.click(screen.getByRole("button", { name: /skip/i }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onGetStarted).not.toHaveBeenCalled()

    onSkip.mockClear()
    await user.click(screen.getByRole("button", { name: /open settings/i }))
    expect(onGetStarted).toHaveBeenCalledTimes(1)
    expect(onSkip).not.toHaveBeenCalled()
  })
})
