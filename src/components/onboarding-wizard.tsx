import { Button } from "@/components/ui/button"
import { APP_DISPLAY_NAME } from "@/lib/fork-meta"

type OnboardingWizardProps = {
  onGetStarted: () => void
  onSkip: () => void
}

export function OnboardingWizard({ onGetStarted, onSkip }: OnboardingWizardProps) {
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm rounded-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="bg-card rounded-lg border shadow-xl p-5 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 id="onboarding-title" className="text-lg font-semibold mb-2">
          Welcome to {APP_DISPLAY_NAME}
        </h2>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          Open Settings to enable providers and connect accounts. Usage appears in the app window and in the tray
          (when available). You can change the tray icon and display mode anytime in Settings.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onSkip} className="w-full sm:w-auto">
            Skip
          </Button>
          <Button type="button" size="sm" onClick={onGetStarted} className="w-full sm:w-auto">
            Open Settings
          </Button>
        </div>
      </div>
    </div>
  )
}
