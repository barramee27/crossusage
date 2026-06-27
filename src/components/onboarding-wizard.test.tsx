import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { OnboardingWizard } from "@/components/onboarding-wizard"

describe("OnboardingWizard", () => {
  it("invokes onComplete with classic when Skip on welcome", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const onSkip = vi.fn()
    render(<OnboardingWizard onComplete={onComplete} onSkip={onSkip} />)

    await user.click(screen.getByRole("button", { name: /^skip$/i }))
    expect(onComplete).toHaveBeenCalledWith("classic")
  })

  it("lets user pick layout on continue flow", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<OnboardingWizard onComplete={onComplete} onSkip={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: /continue/i }))
    await user.click(screen.getByRole("radio", { name: /modern/i }))
    await user.click(screen.getByRole("button", { name: /get started/i }))
    expect(onComplete).toHaveBeenCalledWith("modern")
  })
})
