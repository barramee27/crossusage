# Marketing site source

The static site for **crossusage.dev** is a fork of [robinebers/openusage-web](https://github.com/robinebers/openusage-web), adapted for CrossUsage and **static export** (plain files for nginx).

- Path in this monorepo: `sites/crossusage-web/`
- Stack: Next.js (App Router) + Tailwind, **`next build`** output directory **`out/`** (not `dist/`).

Build and sync:

```bash
cd sites/crossusage-web
npm ci
npm run build
rsync -avz --delete out/ user@vps:/var/www/crossusage.dev/html/
```

To publish as its **own** Git remote, `cd sites/crossusage-web`, `git remote set-url origin …` (it still points at upstream until you change it), then push your fork. See `sites/crossusage-web/README.md`.
