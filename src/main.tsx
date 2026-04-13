import React from "react";
import ReactDOM from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";
import { App } from "./App";
import "./index.css";

// Forward console.error and console.warn to Tauri log file
function stringify(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

const originalError = console.error;
console.error = (...args: unknown[]) => {
  originalError(...args);
  logError(args.map(stringify).join(" ")).catch(() => {});
};

const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  originalWarn(...args);
  logWarn(args.map(stringify).join(" ")).catch(() => {});
};

/**
 * Tray popover: transparent shell + hide when focus leaves (Windows / Linux).
 * GTK tray menus fire `tauri://blur` as the menu closes, before the webview gains focus — debounce
 * and cancel on `tauri://focus` so "Show Stats" does not immediately hide the window.
 */
if (isTauri()) {
  document.documentElement.classList.add("tauri-popover");
  void (async () => {
    const platform = await invoke<string>("get_platform");
    if (platform !== "linux" && platform !== "windows") return;
    const win = getCurrentWebviewWindow();
    let blurHideTimer: ReturnType<typeof setTimeout> | null = null;
    let teardown: (() => void)[] = [];
    const cancelScheduledHide = () => {
      if (blurHideTimer !== null) {
        clearTimeout(blurHideTimer);
        blurHideTimer = null;
      }
    };
    const focusUnlisten = await win.listen("tauri://focus", () => {
      cancelScheduledHide();
    });
    teardown.push(focusUnlisten);
    const blurUnlisten = await win.listen("tauri://blur", () => {
      cancelScheduledHide();
      blurHideTimer = window.setTimeout(() => {
        blurHideTimer = null;
        void win.isFocused().then((focused) => {
          if (!focused) {
            void win.hide();
          }
        });
      }, 260);
    });
    teardown.push(blurUnlisten);

    window.addEventListener("beforeunload", () => {
      cancelScheduledHide();
      teardown.forEach((fn) => fn());
      teardown = [];
    });
  })();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
