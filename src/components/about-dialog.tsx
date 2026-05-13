import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getIdentifier, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ChangelogDialog } from "./changelog-dialog";
import { Button } from "@/components/ui/button";
import {
  APP_DISPLAY_NAME,
  FORK_MAINTAINER_HANDLE,
  FORK_MAINTAINER_URL,
  FORK_REPO_URL,
  UPSTREAM_REPO_URL,
} from "@/lib/fork-meta";
import { formatOsDiagnosticsLine, type OsDiagnosticsPayload } from "@/lib/os-diagnostics-format";
import { useAppPreferencesStore } from "@/stores/app-preferences-store";

interface AboutDialogProps {
  version: string;
  onClose: () => void;
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const handleClick = () => {
    openUrl(href).catch(console.error);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
    >
      {children}
    </button>
  );
}

export function AboutDialog({ version, onClose }: AboutDialogProps) {
  const [view, setView] = useState<"about" | "changelog">("about");
  const { themeMode, displayMode } = useAppPreferencesStore(
    useShallow((s) => ({
      themeMode: s.themeMode,
      displayMode: s.displayMode,
    }))
  );
  const [diagnosticsText, setDiagnosticsText] = useState<string | null>(null);
  const [copyDiagStatus, setCopyDiagStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [v, tv, id, osRaw] = await Promise.all([
          getVersion(),
          getTauriVersion(),
          getIdentifier(),
          invoke<OsDiagnosticsPayload>("get_os_diagnostics"),
        ]);
        if (cancelled) return;
        const osLine = formatOsDiagnosticsLine(osRaw);
        const lines = [
          `${APP_DISPLAY_NAME}: ${v}`,
          `Tauri: ${tv}`,
          `App identifier: ${id}`,
          `Theme: ${themeMode}`,
          `Display: ${displayMode}`,
          osLine,
        ];
        setDiagnosticsText(lines.join("\n"));
      } catch (e) {
        console.error("Failed to load diagnostics for About:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [themeMode, displayMode]);

  const handleCopyDiagnostics = useCallback(async () => {
    if (!diagnosticsText) return;
    setCopyDiagStatus(null);
    try {
      if (isTauri()) {
        await writeText(diagnosticsText);
      } else {
        await navigator.clipboard.writeText(diagnosticsText);
      }
      setCopyDiagStatus("Copied.");
    } catch (e) {
      console.error("Copy diagnostics failed:", e);
      try {
        await navigator.clipboard.writeText(diagnosticsText);
        setCopyDiagStatus("Copied (browser API).");
      } catch (e2) {
        console.error("Clipboard fallback failed:", e2);
        setCopyDiagStatus("Copy failed — see console.");
      }
    }
  }, [diagnosticsText]);

  // Close on ESC key
  useEffect(() => {
    if (view !== "about") {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, view]);

  // Close when panel hides (loses visibility)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        onClose();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (view === "changelog") {
    return (
      <ChangelogDialog
        currentVersion={version}
        onBack={() => setView("about")}
        // In changelog view, Escape should go back to About instead of
        // closing the entire dialog, so hand off to setView.
        onClose={() => setView("about")}
      />
    );
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-xl"
      onClick={handleBackdropClick}
    >
      <div className="bg-card rounded-lg border shadow-xl p-6 max-w-md w-full mx-4 text-center animate-in fade-in zoom-in-95 duration-200 max-h-[min(90vh,520px)] flex flex-col min-h-0">
        <img
          src="/icon.png"
          alt={APP_DISPLAY_NAME}
          className="w-16 h-16 mx-auto mb-3 rounded-xl shrink-0"
        />

        <h2 className="text-xl font-semibold mb-1 shrink-0">{APP_DISPLAY_NAME}</h2>

        <div className="flex flex-col items-center gap-2 mb-3 shrink-0">
          <span className="inline-block text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            v{version}
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setView("changelog")}
            className="text-[10px] h-5 px-1.5"
          >
            View Changelog
          </Button>
        </div>

        {diagnosticsText ? (
          <div className="mb-3 text-left rounded-md border bg-muted/40 px-2 py-2 min-h-0 flex flex-col gap-1 shrink">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Diagnostics
              </span>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                className="h-6 text-[10px]"
                onClick={handleCopyDiagnostics}
              >
                Copy
              </Button>
            </div>
            <pre className="text-[10px] leading-snug whitespace-pre-wrap break-all overflow-y-auto max-h-32 font-mono text-muted-foreground">
              {diagnosticsText}
            </pre>
            {copyDiagStatus ? (
              <span className="text-[10px] text-muted-foreground">{copyDiagStatus}</span>
            ) : null}
          </div>
        ) : null}

        <div className="text-sm text-muted-foreground space-y-1 overflow-y-auto min-h-0">
          <p>
            Fork of{" "}
            <ExternalLink href={UPSTREAM_REPO_URL}>OpenUsage</ExternalLink> — original by{" "}
            <ExternalLink href="https://itsbyrob.in/x">Robin Ebers</ExternalLink>.
            Cross-platform focus (Linux &amp; Windows) in this repo.
          </p>
          <p>
            Source:{" "}
            <ExternalLink href={FORK_REPO_URL}>
              GitHub ({APP_DISPLAY_NAME})
            </ExternalLink>
          </p>
          <p className="text-xs pt-1">
            Fork maintainer:{" "}
            <ExternalLink href={FORK_MAINTAINER_URL}>{FORK_MAINTAINER_HANDLE}</ExternalLink>
          </p>
        </div>
      </div>
    </div>
  );
}

