import { useState } from "react"
import { Button } from "@/components/ui/button"
import { APP_DISPLAY_NAME } from "@/lib/fork-meta"
import {
  DEFAULT_UI_LAYOUT,
  UI_LAYOUT_OPTIONS,
  type UILayout,
} from "@/lib/settings"
import { LayoutPreviewClassic, LayoutPreviewModern } from "@/components/ui-layout-preview"
import { cn } from "@/lib/utils"

type OnboardingWizardProps = {
  onComplete: (layout: UILayout) => void
  onSkip: () => void
}

type Step = "welcome" | "layout"

export function OnboardingWizard({ onComplete, onSkip: _onSkip }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>("welcome")
  const [layout, setLayout] = useState<UILayout>(DEFAULT_UI_LAYOUT)

  const finish = (chosen: UILayout) => {
    onComplete(chosen)
  }

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm rounded-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="bg-card rounded-lg border shadow-xl p-5 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        {step === "welcome" ? (
          <>
            <h2 id="onboarding-title" className="text-lg font-semibold mb-2">
              Welcome to {APP_DISPLAY_NAME}
            </h2>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              All bundled providers work on Linux and Windows. Pick a layout next — you can switch
              anytime in Settings. Providers and accounts are shared between layouts.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => finish(DEFAULT_UI_LAYOUT)}
                className="w-full sm:w-auto"
              >
                Skip
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setStep("layout")}
                className="w-full sm:w-auto"
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="onboarding-title" className="text-lg font-semibold mb-1">
              Choose your layout
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Classic keeps the side nav and provider cards. Modern groups metrics like OpenUsage 0.7.
            </p>
            <div
              className="grid grid-cols-2 gap-2 mb-4"
              role="radiogroup"
              aria-label="UI layout"
            >
              {UI_LAYOUT_OPTIONS.map((option) => {
                const isActive = layout === option.value
                const Preview =
                  option.value === "modern" ? LayoutPreviewModern : LayoutPreviewClassic
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={cn(
                      "rounded-lg p-2 text-left transition-colors border",
                      isActive ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50",
                    )}
                    onClick={() => setLayout(option.value)}
                  >
                    <span className="text-xs font-medium block mb-1.5">{option.label}</span>
                    <Preview isActive={isActive} />
                  </button>
                )
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => finish(DEFAULT_UI_LAYOUT)}
                className="w-full sm:w-auto"
              >
                Skip
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => finish(layout)}
                className="w-full sm:w-auto"
              >
                Get started
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
