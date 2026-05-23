import { invoke, isTauri } from "@tauri-apps/api/core"

export async function ensureNotificationPermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import(
    "@tauri-apps/plugin-notification"
  )
  if (await isPermissionGranted()) return true
  const result = await requestPermission()
  return result === "granted"
}

async function playUsageAlertSound(sound: string | undefined): Promise<void> {
  if (!sound || !isTauri()) return
  const platform = await invoke<string>("get_platform").catch(() => "unknown")
  if (platform !== "linux" && platform !== "macos" && platform !== "windows") return
  await invoke("play_usage_alert_sound", { sound })
}

export async function sendNotificationAsync(
  payload: Parameters<typeof import("@tauri-apps/plugin-notification").sendNotification>[0]
) {
  const granted = await ensureNotificationPermission()
  if (!granted) {
    throw new Error(
      "Notification permission denied. Enable notifications for CrossUsage in system settings."
    )
  }
  const { sendNotification } = await import("@tauri-apps/plugin-notification")
  let sound: string | undefined
  if (typeof payload === "string") {
    await sendNotification(payload)
    return
  }
  const { sound: soundName, ...rest } = payload
  sound = soundName
  const platform = isTauri()
    ? await invoke<string>("get_platform").catch(() => "unknown")
    : "unknown"
  if (sound != null && platform === "macos") {
    await sendNotification({ ...rest, sound })
    try {
      await playUsageAlertSound(sound)
    } catch (error) {
      console.warn("Usage alert sound playback failed:", error)
    }
    return
  }
  await sendNotification(rest)
  try {
    await playUsageAlertSound(sound)
  } catch (error) {
    console.warn("Usage alert sound playback failed:", error)
  }
}
