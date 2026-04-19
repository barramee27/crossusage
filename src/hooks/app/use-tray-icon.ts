import { useCallback, useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"
import { TrayIcon } from "@tauri-apps/api/tray"
import type { PluginMeta } from "@/lib/plugin-types"
import type { DisplayMode, MenubarIconStyle, PluginSettings } from "@/lib/settings"
import { getEnabledPluginIds, getProviderInstanceMeta } from "@/lib/settings"

import { getTrayForegroundHex, renderTrayBarsIcon, type TrayProviderIcon } from "@/lib/tray-bars-icon"
import { getTrayIconSizePx } from "@/lib/tray-icon-size"
import { formatTrayIssuesAppendage } from "@/lib/tray-health"
import { getTrayPrimaryBars, type TrayPrimaryBar } from "@/lib/tray-primary-progress"
import { formatTrayItemCaption, formatTrayTooltip } from "@/lib/tray-tooltip"

import type { PluginState } from "@/hooks/app/types"
import { useSystemDarkMode } from "@/hooks/use-system-dark-mode"

type TrayUpdateReason = "probe" | "settings" | "init"

type UseTrayIconArgs = {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
  displayMode: DisplayMode
  menubarIconStyle: MenubarIconStyle
  preferMenubarWeeklyLimit: boolean
  activeView: string
}

export type TraySettingsPreview = {
  bars: TrayPrimaryBar[]
  providerBars: TrayPrimaryBar[]
  providerIconUrl?: string
  providerIconUrls: Record<string, string | undefined>
  providerPercentText: string
}

const EMPTY_TRAY_SETTINGS_PREVIEW: TraySettingsPreview = {
  bars: [],
  providerBars: [],
  providerIconUrls: {},
  providerPercentText: "--%",
}

/** Linux: tray tooltips are unreliable on AppIndicator; Rust mirrors this text in disabled menu rows. */
function mirrorTrayUsageSummaryToBackend(summary: string) {
  if (!isTauri()) return
  void invoke("update_tray_usage_summary", { summary }).catch(() => {
    /* ignore: command no-ops off Linux or before tray init */
  })
}

function isSameTraySettingsPreview(a: TraySettingsPreview, b: TraySettingsPreview): boolean {
  if (a.providerIconUrl !== b.providerIconUrl) return false
  if (a.providerPercentText !== b.providerPercentText) return false
  const aIconIds = Object.keys(a.providerIconUrls).sort()
  const bIconIds = Object.keys(b.providerIconUrls).sort()
  if (aIconIds.length !== bIconIds.length) return false
  for (let i = 0; i < aIconIds.length; i += 1) {
    const id = aIconIds[i]
    if (id !== bIconIds[i]) return false
    if (a.providerIconUrls[id] !== b.providerIconUrls[id]) return false
  }
  if (a.bars.length !== b.bars.length) return false
  if (a.providerBars.length !== b.providerBars.length) return false
  for (let i = 0; i < a.bars.length; i += 1) {
    if (a.bars[i]?.id !== b.bars[i]?.id) return false
    if (a.bars[i]?.items?.[0]?.fraction !== b.bars[i]?.items?.[0]?.fraction) return false
  }
  for (let i = 0; i < a.providerBars.length; i += 1) {
    if (a.providerBars[i]?.id !== b.providerBars[i]?.id) return false
    if (a.providerBars[i]?.items?.[0]?.fraction !== b.providerBars[i]?.items?.[0]?.fraction) return false
  }
  return true
}

function getProviderPercentText(args: {
  providerBars: TrayPrimaryBar[]
  displayMode: DisplayMode
}): string {
  const first = args.providerBars[0]?.items?.[0]
  if (!first) return "--%"
  return formatTrayItemCaption(first, args.displayMode)
}

export function useTrayIcon({
  pluginsMeta,
  pluginSettings,
  pluginStates,
  displayMode,
  menubarIconStyle,
  preferMenubarWeeklyLimit,
  activeView,
}: UseTrayIconArgs) {
  const trayRef = useRef<TrayIcon | null>(null)
  const trayGaugeIconPathRef = useRef<string | null>(null)
  const trayUpdateTimerRef = useRef<number | null>(null)
  const trayUpdatePendingRef = useRef(false)
  const trayUpdateQueuedRef = useRef(false)
  const [trayReady, setTrayReady] = useState(false)
  const [traySettingsPreview, setTraySettingsPreview] = useState<TraySettingsPreview>(
    EMPTY_TRAY_SETTINGS_PREVIEW
  )

  const pluginsMetaRef = useRef(pluginsMeta)
  const pluginSettingsRef = useRef(pluginSettings)
  const pluginStatesRef = useRef(pluginStates)
  const displayModeRef = useRef(displayMode)
  const menubarIconStyleRef = useRef(menubarIconStyle)
  const preferMenubarWeeklyLimitRef = useRef(preferMenubarWeeklyLimit)
  const activeViewRef = useRef(activeView)
  const lastTrayProviderIdRef = useRef<string | null>(null)

  const systemDark = useSystemDarkMode()
  const systemDarkRef = useRef(systemDark)
  useEffect(() => {
    systemDarkRef.current = systemDark
  }, [systemDark])

  useEffect(() => {
    pluginsMetaRef.current = pluginsMeta
  }, [pluginsMeta])

  useEffect(() => {
    pluginSettingsRef.current = pluginSettings
  }, [pluginSettings])

  useEffect(() => {
    pluginStatesRef.current = pluginStates
  }, [pluginStates])

  useEffect(() => {
    displayModeRef.current = displayMode
  }, [displayMode])

  useEffect(() => {
    menubarIconStyleRef.current = menubarIconStyle
  }, [menubarIconStyle])

  useEffect(() => {
    preferMenubarWeeklyLimitRef.current = preferMenubarWeeklyLimit
  }, [preferMenubarWeeklyLimit])

  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  const scheduleTrayIconUpdate = useCallback((
    _reason: TrayUpdateReason,
    delayMs = 0,
  ) => {
    if (trayUpdateTimerRef.current !== null) {
      window.clearTimeout(trayUpdateTimerRef.current)
      trayUpdateTimerRef.current = null
    }

    trayUpdateTimerRef.current = window.setTimeout(() => {
      trayUpdateTimerRef.current = null
      if (trayUpdatePendingRef.current) {
        trayUpdateQueuedRef.current = true
        return
      }
      trayUpdatePendingRef.current = true

      const finalizeUpdate = () => {
        trayUpdatePendingRef.current = false
        if (!trayUpdateQueuedRef.current) return
        trayUpdateQueuedRef.current = false
        scheduleTrayIconUpdate("probe", 0)
      }

      const tray = trayRef.current
      if (!tray) {
        finalizeUpdate()
        return
      }

      const ink = getTrayForegroundHex(systemDarkRef.current)
      /** Dynamic tray icons now use provider brand colors, so keep raster colors as-is. */
      const rasterUsesTemplate = false

      const maybeSetTitle =
        (tray as TrayIcon & { setTitle?: (value: string | null) => Promise<void> }).setTitle
      const setTitleFn =
        typeof maybeSetTitle === "function"
          ? (value: string | null) => maybeSetTitle.call(tray, value)
          : null
      const setTrayTitle = (title: string | null) => {
        if (setTitleFn) {
          return setTitleFn(title)
        }
        return Promise.resolve()
      }

      const maybeSetTooltip = (
        tray as TrayIcon & { setTooltip?: (value: string | null) => Promise<void> }
      ).setTooltip
      const setTooltipFn =
        typeof maybeSetTooltip === "function"
          ? (value: string | null) => maybeSetTooltip.call(tray, value)
          : null
      const setTrayTooltip = (tooltip: string | null) => {
        if (setTooltipFn) {
          return setTooltipFn(tooltip)
        }
        return Promise.resolve()
      }

      const restoreGaugeIcon = () => {
        mirrorTrayUsageSummaryToBackend("CrossUsage")
        const gaugePath = trayGaugeIconPathRef.current
        if (gaugePath) {
          Promise.all([
            tray.setIcon(gaugePath),
            tray.setIconAsTemplate(true),
            setTrayTitle(""),
            setTrayTooltip("CrossUsage"),
          ])
            .catch((e) => {
              console.error("Failed to restore tray gauge icon:", e)
            })
            .finally(() => {
              finalizeUpdate()
            })
        } else {
          finalizeUpdate()
        }
      }

      const currentSettings = pluginSettingsRef.current
      if (!currentSettings) {
        setTraySettingsPreview(EMPTY_TRAY_SETTINGS_PREVIEW)
        restoreGaugeIcon()
        return
      }

      const enabledPluginIds = getEnabledPluginIds(currentSettings)
      if (enabledPluginIds.length === 0) {
        setTraySettingsPreview(EMPTY_TRAY_SETTINGS_PREVIEW)
        restoreGaugeIcon()
        return
      }

      const style = menubarIconStyleRef.current
      const sizePx = getTrayIconSizePx(window.devicePixelRatio)
      const nextActiveView = activeViewRef.current
      const activeProviderId =
        nextActiveView !== "home" && nextActiveView !== "settings" ? nextActiveView : null

      let trayProviderId: string | null = null
      if (activeProviderId && enabledPluginIds.includes(activeProviderId)) {
        trayProviderId = activeProviderId
      } else if (
        lastTrayProviderIdRef.current &&
        enabledPluginIds.includes(lastTrayProviderIdRef.current)
      ) {
        trayProviderId = lastTrayProviderIdRef.current
      } else {
        trayProviderId = enabledPluginIds[0] ?? null
      }

      const barsForPreview = getTrayPrimaryBars({
        pluginsMeta: pluginsMetaRef.current,
        pluginSettings: currentSettings,
        pluginStates: pluginStatesRef.current,
        maxBars: 4,
        displayMode: displayModeRef.current,
        preferWeeklyLimit: preferMenubarWeeklyLimitRef.current,
      })

      const providerBars = trayProviderId
        ? getTrayPrimaryBars({
            pluginsMeta: pluginsMetaRef.current,
            pluginSettings: currentSettings,
            pluginStates: pluginStatesRef.current,
            maxBars: 1,
            displayMode: displayModeRef.current,
            pluginId: trayProviderId,
            preferWeeklyLimit: preferMenubarWeeklyLimitRef.current,
          })
        : []

      const providerMeta = trayProviderId
        ? getProviderInstanceMeta(trayProviderId, currentSettings, pluginsMetaRef.current)
        : null
      const providerIconUrl = providerMeta?.iconUrl
      const providerColor = providerMeta?.brandColor
      const providerIconUrls = Object.fromEntries(
        barsForPreview.map((bar) => [
          bar.id,
          getProviderInstanceMeta(bar.id, currentSettings, pluginsMetaRef.current)?.iconUrl,
        ])
      )
      const providerIcons: TrayProviderIcon[] = barsForPreview.map((bar) => ({
        id: bar.id,
        iconUrl: providerIconUrls[bar.id],
        color: getProviderInstanceMeta(bar.id, currentSettings, pluginsMetaRef.current)?.brandColor,
      }))
      const providerPercentText = getProviderPercentText({
        providerBars,
        displayMode: displayModeRef.current,
      })

      const nextPreview: TraySettingsPreview = {
        bars: barsForPreview,
        providerBars,
        providerIconUrl,
        providerIconUrls,
        providerPercentText,
      }
      setTraySettingsPreview((prev) =>
        isSameTraySettingsPreview(prev, nextPreview) ? prev : nextPreview
      )

      const tooltipBars = getTrayPrimaryBars({
        pluginsMeta: pluginsMetaRef.current,
        pluginSettings: currentSettings,
        pluginStates: pluginStatesRef.current,
        maxBars: 20,
        displayMode: displayModeRef.current,
        preferWeeklyLimit: preferMenubarWeeklyLimitRef.current,
      })
      const baseTooltip = formatTrayTooltip(
        tooltipBars,
        pluginsMetaRef.current,
        displayModeRef.current
      )
      const issuesLine = formatTrayIssuesAppendage({
        pluginsMeta: pluginsMetaRef.current,
        pluginSettings: currentSettings,
        pluginStates: pluginStatesRef.current,
      })
      const tooltip = issuesLine ? `${baseTooltip}\n${issuesLine}` : baseTooltip
      mirrorTrayUsageSummaryToBackend(tooltip)
      const updateTooltip = () => setTrayTooltip(tooltip)

      if (style === "bars") {
        renderTrayBarsIcon({
          bars: barsForPreview,
          sizePx,
          style: "bars",
          foregroundHex: ink,
        })
          .then(async (img) => {
            await tray.setIcon(img)
            await tray.setIconAsTemplate(rasterUsesTemplate)
            await setTrayTitle("")
            await updateTooltip()
          })
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(() => {
            finalizeUpdate()
          })
        return
      }

      if (style === "logoGrid") {
        renderTrayBarsIcon({
          bars: barsForPreview,
          sizePx,
          style: "logoGrid",
          providerIcons: providerIcons,
          foregroundHex: ink,
        })
          .then(async (img) => {
            await tray.setIcon(img)
            await tray.setIconAsTemplate(rasterUsesTemplate)
            await setTrayTitle("")
            await updateTooltip()
          })
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(() => {
            finalizeUpdate()
          })
        return
      }

      if (!trayProviderId) {
        restoreGaugeIcon()
        return
      }
      lastTrayProviderIdRef.current = trayProviderId


      if (style === "donut") {
        renderTrayBarsIcon({
          bars: providerBars,
          sizePx,
          style: "donut",
          providerIconUrl,
          providerColor,
          foregroundHex: ink,
        })
          .then(async (img) => {
            await tray.setIcon(img)
            await tray.setIconAsTemplate(rasterUsesTemplate)
            await setTrayTitle("")
            await updateTooltip()
          })
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(() => {
            finalizeUpdate()
          })
        return
      }

      if (style === "logoBar") {
        renderTrayBarsIcon({
          bars: providerBars,
          sizePx,
          style: "logoBar",
          providerIconUrl: providerIconUrl,
          providerColor,
          foregroundHex: ink,
        })
          .then(async (img) => {
            await tray.setIcon(img)
            await tray.setIconAsTemplate(rasterUsesTemplate)
            await setTrayTitle("")
            await updateTooltip()
          })
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(() => {
            finalizeUpdate()
          })
        return
      }

      const providerIconUrlToRender = providerIconUrl

      renderTrayBarsIcon({
        bars: providerBars,
        sizePx,

        style: "provider",
        providerIconUrl: providerIconUrlToRender,
        providerColor,
        hideIcon: false,
        foregroundHex: ink,

      })
        .then(async (img) => {
          await tray.setIcon(img)
          await tray.setIconAsTemplate(rasterUsesTemplate)

          // Keep the tray slot for the logo only. Native titles clip badly in
          // Windows/Linux trays, and drawing the percent into the bitmap makes
          // provider icons too small at tray size.
          await setTrayTitle(null)
          await updateTooltip()
        })
        .catch((e) => {
          console.error("Failed to update tray icon:", e)
        })
        .finally(() => {
          finalizeUpdate()
        })
    }, delayMs)
  }, [])

  const trayInitializedRef = useRef(false)
  useEffect(() => {
    if (trayInitializedRef.current) return
    let cancelled = false

      ; (async () => {
        try {
          const tray = await TrayIcon.getById("tray")
          if (cancelled) return
          trayRef.current = tray
          trayInitializedRef.current = true

          try {
            trayGaugeIconPathRef.current = await resolveResource("icons/tray-icon.png")
          } catch (e) {
            console.error("Failed to resolve tray gauge icon resource:", e)
          }

          if (cancelled) return
          setTrayReady(true)
        } catch (e) {
          console.error("Failed to load tray icon handle:", e)
        }
      })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!trayReady) return
    if (!pluginSettings) return
    if (pluginsMeta.length === 0) return
    scheduleTrayIconUpdate("init", 0)
  }, [pluginsMeta.length, pluginSettings, scheduleTrayIconUpdate, trayReady])

  useEffect(() => {
    if (!trayReady) return
    scheduleTrayIconUpdate("settings", 0)
  }, [activeView, displayMode, menubarIconStyle, scheduleTrayIconUpdate, trayReady])

  useEffect(() => {
    if (!trayReady) return
    scheduleTrayIconUpdate("settings", 0)
  }, [scheduleTrayIconUpdate, systemDark, trayReady])

  useEffect(() => {
    return () => {
      if (trayUpdateTimerRef.current !== null) {
        window.clearTimeout(trayUpdateTimerRef.current)
        trayUpdateTimerRef.current = null
      }
      trayUpdatePendingRef.current = false
      trayUpdateQueuedRef.current = false
    }
  }, [])

  return {
    scheduleTrayIconUpdate,
    traySettingsPreview,
  }
}
