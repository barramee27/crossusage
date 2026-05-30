# CrossUsage icon

Canonical mark: **`crossusage-icon-color.svg`**

Regenerate app icons:

```bash
rsvg-convert -w 1024 -h 1024 branding/crossusage-icon-color.svg -o /tmp/crossusage-1024.png
bunx tauri icon /tmp/crossusage-1024.png -o src-tauri/icons
rsvg-convert -w 64 -h 64 branding/crossusage-icon-color.svg -o /tmp/crossusage-tray.png
\cp -f /tmp/crossusage-tray.png src-tauri/icons/tray-icon.png
mkdir -p public
\cp -f src-tauri/icons/128x128.png public/icon.png
\cp -f branding/crossusage-icon-color.svg public/favicon.svg
\cp -f branding/crossusage-icon-color.svg sites/crossusage-web/app/icon.svg
```

Use `\cp -f` if `cp` is aliased to interactive `cp -iv`.
