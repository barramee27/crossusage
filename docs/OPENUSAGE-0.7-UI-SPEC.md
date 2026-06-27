# OpenUsage 0.7 UI spec (Modern layout port)

Source of truth: upstream [`swift`](https://github.com/robinebers/openusage/tree/swift) branch (not `main`). CrossUsage implements **Modern** as a `uiLayout` inside the existing Tauri window — not a fixed 320px macOS popover.

## Screens (Modern shell)

| Screen | Swift reference | CrossUsage |
|--------|-----------------|------------|
| Dashboard | `DashboardView` | `ModernShell` → grouped provider cards (`WidgetGroupedList`) |
| Customize | `CustomizeView` | Metric enable/disable + tray pins (max 2/provider) |
| Settings | In-popover sections on macOS | Full `SettingsPage` tab (fork sections: history, insights, local API) |

Classic (`uiLayout === "classic"`) keeps `AppShell` + `SideNav` unchanged.

## Metric identity

- Canonical id: **`${pluginId}:${lineLabel}`** (matches `plugin.json` `lines[].label`).
- Descriptor catalog built at runtime from manifest + probe output.
- `bounded` = progress lines with percent format; `unbounded` = text/spend lines.

## Layout state (`modernLayout` store key)

| Field | Purpose |
|-------|---------|
| `placedMetricIds` | Dashboard-visible metrics |
| `providerOrder` | Card order |
| `metricOrderByProvider` | Row order within card |
| `pinnedMetricIds` | Tray strip (Modern only); max **2 per provider** |
| `initialized` | First-launch defaults applied |

Defaults ported from upstream `DefaultLayout.swift`. Migration: legacy `trayLines` → seed `pinnedMetricIds` on first Modern init.

## Widget rows

Port of `WidgetRowView.swift`:

- Label + pace dot / run-out warning
- Capsule meter (pace colors; shared with Classic `PaceIndicator` logic)
- Primary: **X% left** ⟷ **Resets in …** (`displayMode`, `resetTimerDisplayMode`)
- Unbounded spend rows clustered (Today / Yesterday / …)

## Tray (Modern)

- `buildMenuBarContent(pinnedMetricIds, …)` → `TrayPrimaryBar[]`
- `use-tray-icon`: when `uiLayout === "modern"`, render pins as bars strip; Classic keeps `trayLines` / `getTrayPrimaryBars`.
- Tests: `modern-layout.test.ts`, `menu-bar-content.test.ts` (pin cap, order, disabled provider).

## Appearance (Modern-only settings)

- **Density** (`regular` | `compact`) — row padding/fonts via `data-density` on shell
- **Reduce transparency** — use existing `themeMode` solid/glass paths

## Fork differentiators in Modern

- `UsageInsightsBanner` above dashboard (not in upstream 0.7 popover)
- All bundled plugins remain available in both layouts ([#565](https://github.com/robinebers/openusage/issues/565))

## Release (1.1.1 at upstream GA)

When upstream tags **`v0.7.0`** (non-prerelease):

1. `git fetch upstream --tags`
2. `git diff feat/port-openusage-0.7-prep...v0.7.0 -- plugins/` — gap-fill
3. Diff `upstream/swift` UI commits since last port; adjust Modern components
4. `bun run test`, `cargo test`, manual Classic + Modern smoke
5. Bump **1.1.1**, release; ~7d later merge **1.2.0** polish branch

See [FORK-UPSTREAM.md](./FORK-UPSTREAM.md).
