import { useShallow } from "zustand/react/shallow"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { X } from "lucide-react"
import { AppContent, type AppContentActionProps } from "@/components/app/app-content"
import { OnboardingWizard } from "@/components/onboarding-wizard"
import type { UILayout } from "@/lib/settings"
import { LiquidGlassFilter } from "@/components/liquid-glass-filter"
import { PanelFooter } from "@/components/panel-footer"
import { SideNav, type NavPlugin, type PluginContextAction } from "@/components/side-nav"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list"
import { useAppVersion } from "@/hooks/app/use-app-version"
import { usePanel } from "@/hooks/app/use-panel"
import { usePlatform } from "@/hooks/app/use-platform"
import { useTrayRestartBridge } from "@/hooks/app/use-tray-restart-bridge"
import type { UpdateStatus } from "@/hooks/use-app-update"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppUiStore } from "@/stores/app-ui-store"

type AppShellProps = {
  onRefreshAll: () => void
  navPlugins: NavPlugin[]
  displayPlugins: DisplayPluginState[]
  settingsPlugins: SettingsPluginState[]
  autoUpdateNextAt: number | null
  selectedPlugin: DisplayPluginState | null
  onPluginContextAction: (pluginId: string, action: PluginContextAction) => void
  isPluginRefreshAvailable: (pluginId: string) => boolean
  onNavReorder: (orderedIds: string[]) => void
  updateStatus: UpdateStatus
  onUpdateInstall: () => void
  onUpdateCheck: () => void
  appContentProps: AppContentActionProps

  showOnboardingWizard: boolean
  onOnboardingComplete: (layout: UILayout) => void
  onOnboardingSkip: () => void
}

export function AppShell({
  onRefreshAll,
  navPlugins,
  displayPlugins,
  settingsPlugins,
  autoUpdateNextAt,
  selectedPlugin,
  onPluginContextAction,
  isPluginRefreshAvailable,
  onNavReorder,
  updateStatus,
  onUpdateInstall,
  onUpdateCheck,
  appContentProps,
  showOnboardingWizard,
  onOnboardingComplete,
  onOnboardingSkip,
}: AppShellProps) {
  const { themeMode } = useAppPreferencesStore(
    useShallow((state) => ({ themeMode: state.themeMode }))
  )

  const {
    activeView,
    setActiveView,
    showAbout,
    setShowAbout,
  } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setActiveView: state.setActiveView,
      showAbout: state.showAbout,
      setShowAbout: state.setShowAbout,
    }))
  )

  const {
    containerRef,
    scrollRef,
    canScrollDown,
    maxPanelHeightPx,
  } = usePanel({
    activeView,
    setActiveView,
    showAbout,
    setShowAbout,
    displayPlugins,
  })

  const appVersion = useAppVersion()
  useTrayRestartBridge(updateStatus, onUpdateInstall)
  const platform = usePlatform()
  const macPopoverChrome = isTauri() && platform === "macos"

  return (
    <div ref={containerRef} className="app-popover-shell w-full bg-transparent">
      {/* SVG filter definitions for the liquid-distort effect; rendered off-screen */}
      <LiquidGlassFilter active={themeMode === "glass"} />
      {macPopoverChrome ? <div className="tray-arrow" aria-hidden="true" /> : null}
      <div
        className="app-panel-surface relative w-full overflow-hidden rounded-[18px] select-none flex flex-col"
        style={
          macPopoverChrome && maxPanelHeightPx
            ? { maxHeight: `${maxPanelHeightPx}px` }
            : undefined
        }
      >
        <div className="flex flex-1 min-h-0 flex-row">
          <SideNav
            activeView={activeView}
            onViewChange={setActiveView}
            plugins={navPlugins}
            onPluginContextAction={onPluginContextAction}
            isPluginRefreshAvailable={isPluginRefreshAvailable}
            onReorder={onNavReorder}
          />
          <div className="app-main-pane relative flex-1 flex flex-col px-3 pt-2 pb-1.5 min-w-0">
            {macPopoverChrome ? (
              <button
                type="button"
                className="absolute right-2 top-1 z-30 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Hide window"
                onClick={() => {
                  void invoke("hide_panel")
                }}
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            ) : null}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {showOnboardingWizard ? (
                <OnboardingWizard onComplete={onOnboardingComplete} onSkip={onOnboardingSkip} />
              ) : null}
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto scrollbar-none"
              >
                <div className="min-h-full min-w-0">
                  <AppContent
                    {...appContentProps}
                    displayPlugins={displayPlugins}
                    settingsPlugins={settingsPlugins}
                    selectedPlugin={selectedPlugin}
                  />
                </div>
              </div>
              <div
                className={`app-scroll-fade pointer-events-none absolute inset-x-0 bottom-0 h-14 transition-opacity duration-200 ${canScrollDown ? "opacity-100" : "opacity-0"}`}
              />
            </div>
            <PanelFooter
              version={appVersion}
              autoUpdateNextAt={autoUpdateNextAt}
              updateStatus={updateStatus}
              onUpdateInstall={onUpdateInstall}
              onUpdateCheck={onUpdateCheck}
              onRefreshAll={onRefreshAll}
              showAbout={showAbout}
              onShowAbout={() => setShowAbout(true)}
              onCloseAbout={() => setShowAbout(false)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
