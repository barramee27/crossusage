# Tray usage summary (Linux vs Windows / macOS)

## Why

On **Linux**, the system tray often uses **AppIndicator**, which does **not** reliably show native **hover tooltips** or dynamic `setTooltip()` updates—even when the app calls the API.

CrossUsage still sets the native tooltip where supported, and on **Linux** it also mirrors the same multi-line summary as **one disabled item at the top of the tray menu** (embedded newlines so GTK does not reserve extra empty rows).

## How to see it

1. Run CrossUsage on **Linux**.
2. **Left-click** the tray icon to open the menu (typical AppIndicator behavior).
3. The first item should show **CrossUsage** and each enabled provider with a **percentage** on separate lines (same text as the intended hover tooltip).
4. After a refresh or probe, open the menu again to see updated values.

## Other platforms

On **Windows** and **macOS**, hover the tray icon to see the native tooltip; the menu mirror is updated from the frontend but the Rust handler is a no-op aside from accepting the command.

## Manual checks

| Platform | Action | Expected |
|----------|--------|----------|
| Linux | Tray menu → top disabled summary item | Usage lines match in-app / probe data |
| Windows | Hover tray icon | Tooltip with `CrossUsage` + provider `%` |
| macOS | Hover tray icon (if tooltip supported) | Same as Windows |
