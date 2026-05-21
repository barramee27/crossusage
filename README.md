# CrossUsage

**CrossUsage** is a **community fork** of **[OpenUsage](https://github.com/robinebers/openusage)**. **All credit for the original app, product direction, and plugin architecture goes to [Robin Ebers](https://github.com/robinebers)** ([@robinebers](https://github.com/robinebers)) — please star and support **[upstream OpenUsage](https://github.com/robinebers/openusage)**.

- **Upstream (authoritative for the core app):** [github.com/robinebers/openusage](https://github.com/robinebers/openusage) · [releases](https://github.com/robinebers/openusage/releases/latest) · site [openusage.ai](https://www.openusage.ai)
- **This fork (Linux & Windows builds, cross-platform polish):** [github.com/barramee27/crossusage](https://github.com/barramee27/crossusage) · [releases](https://github.com/barramee27/crossusage/releases/latest) · marketing site [crossusage.dev](https://crossusage.dev) (source `sites/crossusage-web/`, fork of [openusage-web](https://github.com/robinebers/openusage-web); deploy `deploy/crossusage.dev/`)

If you cite or redistribute builds from this repo, **name OpenUsage and Robin Ebers** as the original authors. This fork exists to ship **native Linux and Windows** installers; for the **macOS-first** experience, use **[upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest)**.

See your usage at a glance from your menu bar. No digging through dashboards.

Optional **local usage history** (Settings → *Usage history*): when enabled, successful provider refreshes append normalized rows to SQLite in app data only (not uploaded). Debounced (~32s per account) to limit disk writes.

![CrossUsage screenshot](screenshot.png)

## Download

[**Latest CrossUsage release**](https://github.com/barramee27/crossusage/releases/latest)

Artifacts use the **`crossusage_1.0.0_…`** style (see [GitHub Releases](https://github.com/barramee27/crossusage/releases)):

- **Windows** — `crossusage_1.0.0_x64-setup.exe` (NSIS installer) and/or `crossusage.exe` (beside the installer output)
- **Linux** — `crossusage_1.0.0_amd64.deb`, RPM `crossusage-1.0.0-…`, `crossusage_1.0.0_amd64.AppImage`
- **macOS GUI** — use [upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest) (this fork targets Linux/Windows first for the desktop app)
- **macOS CLI (Apple Silicon)** — portable `crossusage-cli` via `INSTALL_MODE=cli` (see below); no `.dmg` for this fork

Pre-built binaries — install and run.

### One-line install from GitHub

**Branch:** this fork’s active work lives on **`feat/linux-windows-native-support`**. Raw install URLs and the default **`INSTALL_GIT_REF`** in [`scripts/install.sh`](scripts/install.sh) use that branch so one-liners match what you test locally (not only `main`).

**Linux** (auto-detects package manager: `.deb` on Debian/Ubuntu, `.rpm` on Fedora/RHEL-like, or AppImage fallback). Requires `curl` *or* `wget`, and `jq` *or* `python3`:

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.sh | bash
```

**Windows** (PowerShell; by default downloads the latest NSIS `*x64-setup.exe` and runs it, silent by default). For **CLI-only** (portable zip into `%USERPROFILE%\.local\lib\crossusage`, like Linux `INSTALL_MODE=cli`), set `$env:INSTALL_MODE='cli'` first — see [INSTALL.md](INSTALL.md).

```powershell
irm https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.ps1 | iex
```

**macOS:** no **desktop** `.dmg` in this fork. For the **terminal CLI** on **Apple Silicon**, use `INSTALL_MODE=cli`: `install.sh` prefers `crossusage-cli_*_darwin_arm64.tar.gz` from the **latest GitHub Release**, then falls back to your `INSTALL_GIT_REF` branch under `releases/` on `raw.githubusercontent.com` if the release has no matching asset. The tarball is **`crossusage-cli` + `resources/bundled_plugins/`** together (see [`scripts/build-cli-tarball.sh`](scripts/build-cli-tarball.sh)); extracting only the binary (or `cargo install` without that tree) leaves **no bundled plugins** until you set **`CROSSUSAGE_RESOURCES`** or install via **`INSTALL_MODE=cli`** (binary and `resources/` land under `~/.local/lib/crossusage/`). Publish the tarball by building on a Mac (`bun run release:cli-tarball`), or use **Actions → macOS CLI tarball** (optionally **Upload to latest GitHub Release**). **Developers** can also `cargo build -p crossusage-cli` from a clone; set `CROSSUSAGE_RESOURCES` to a folder that contains `bundled_plugins/` or `resources/bundled_plugins/` (see [`crates/crossusage-core/src/paths.rs`](crates/crossusage-core/src/paths.rs)). For a macOS **GUI** app, see [upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest).

**Security:** Inspect [`scripts/install.sh`](scripts/install.sh) and [`scripts/install.ps1`](scripts/install.ps1) before piping to `bash` or `iex`. They use GitHub’s API, release download URLs, and (for shell `INSTALL_MODE=cli` fallback / PowerShell CLI mode) `raw.githubusercontent.com` CLI bundles on a branch. You can always install manually from [releases](https://github.com/barramee27/crossusage/releases/latest).

**Optional environment:** `GITHUB_REPO` (default `barramee27/crossusage`); Linux `INSTALL_KIND=deb|rpm|appimage`; Windows `INSTALL_SILENT=0` for a non-silent NSIS install; Windows `INSTALL_MODE=cli` for portable CLI zip (no NSIS).

**CLI-only (no desktop app / no WebKit):** on Linux/macOS shell installs, downloads a portable tarball (`crossusage-cli_<version>_linux_<arch>.tar.gz` or `_darwin_arm64.tar.gz`) from the **latest GitHub Release** first, then from the branch `releases/` path if needed. Each archive includes **`resources/bundled_plugins/`** next to the `crossusage-cli` binary — keep that layout after extract (or set `CROSSUSAGE_RESOURCES`). Build with `bun run release:cli-tarball` or the **macOS CLI tarball** workflow, then attach to a GitHub Release and/or commit under `releases/`:

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.sh | INSTALL_MODE=cli bash
```

**ShellCheck** is an optional static analyzer for shell scripts (`shellcheck scripts/install.sh`); it catches quoting bugs and portability issues before you ship.

More detail: [INSTALL.md](INSTALL.md).

**Same install includes a terminal CLI** (`crossusage-cli`): one package installs both the tray app and the CLI (e.g. on Linux `.deb`, both live under `/usr/bin/`).

Build from source:

```bash
cargo build -p crossusage-cli --bin crossusage-cli
cargo run -p crossusage-cli -- --help
```

**Default:** running `crossusage-cli` with **no subcommand** opens the **btop-style dashboard** (same as `dashboard` / `tui`).

**Easiest way to test providers (no TUI, no full-screen):** probes everything and prints JSON — good when an IDE terminal misbehaves with the dashboard.

```bash
./target/debug/crossusage-cli --json
crossusage-cli list               # or: probe + table, still no full-screen TUI
```

```bash
crossusage-cli                    # dashboard (default)
crossusage-cli dashboard          # full-screen TUI
crossusage-cli tui                # alias
crossusage-cli list               # probe + table (A–Z); Cursor **input/output/cost** = MTD from dashboard CSV when signed in; no cache columns in this table
crossusage-cli probe              # JSON to stdout (default)
crossusage-cli probe --human      # legacy human-readable tables
crossusage-cli export             # JSON snapshot (live probe)
crossusage-cli export --format csv
crossusage-cli export --from-file ~/.local/share/crossusage/cli-history.jsonl --format csv
```

**Cursor token / cost table (like [cstats](https://github.com/robinebers/cstats)):** downloads Cursor’s **usage-events CSV** (same export as the dashboard), then prints **Input, Output, Cache Write, Cache Hit, Total Tokens, Cost (USD)** — summarized by model or by a **heuristic** provider bucket. Only **`--provider cursor`** is supported; other IDEs don’t expose this file. Alias: `crossusage-cli cstats …`.

```bash
crossusage-cli usage-stats                          # last 30 days, by model
crossusage-cli usage-stats -s 20260301 -u 20260307   # YYYYMMDD range
crossusage-cli usage-stats --group provider         # rough provider grouping
crossusage-cli usage-stats --json                   # machine-readable
```

**Narrow terminals:** Width is detected automatically (Unix `TIOCGWINSZ`, crossterm, and **`$COLUMNS`** when set — the **smallest** value wins so layout stays readable). **`list`** and **`usage-stats`** use **plain stacked blocks** below **140 columns**; at **140+** they use rounded tables. **`probe --human`** uses stacked lines below **100** columns, **truncated** tables between **100–139**, and full tables at **140+**. You should not need flags or manual **`COLUMNS=`** in normal terminals; if something still looks wide-only, your shell usually sets **`$COLUMNS`** after resize.

**Global flags:** `--config <path>`, `--theme <dark|light|btop-rainbow|auto>`, `--refresh-sec <n>`, `--no-mouse`, **`--verbose`** (show plugin-host `WARN`/`ERROR` logs on stderr — **off by default** for the dashboard and for **`list` / `probe` / live `export` / `daemon`**, same as the TUI), **`--no-probe`** (dashboard only: skip real probes, demo data — test keyboard/layout), **`--no-picker`** (skip the **checkbox** screen and load all providers immediately), `--daemon` (background polling **only** — no TUI; do not combine with a subcommand). Use a **separate terminal** or script for long-running daemons.

**Before the dashboard:** by default you get an **interactive provider list** — `[x]` checkboxes, **↑↓** to move, **Enter** / Space to toggle, move to **Continue** and Enter to start (only checked providers are probed). Naming specific plugins on the CLI (e.g. `crossusage-cli dashboard cursor`) skips this screen.

**TUI debug:** set `CROSSUSAGE_TUI_DEBUG=1` or pass **`--verbose`** to log event polls / draws / probes on stderr.

```bash
crossusage-cli --daemon           # same idea as `daemon` subcommand defaults
crossusage-cli daemon --detach --log-file ~/.local/share/crossusage/daemon.log
crossusage-cli daemon --interval-sec 60 --threshold-percent 90 cursor
```

**Config** (`~/.config/crossusage/config.toml` or `--config`): `refresh_sec`, `low_power_mode`, `theme`, `mouse`, `pane_ratios`, `history_capacity`, `persist_history`.

**TUI keybindings:** `q` / **Ctrl+C** → quit (SIGINT also handled via `signal-hook`); `?` help; `p` low-power (saved); `r` refresh; `←`/`→` chart scroll; **mouse** resize (unless `--no-mouse`). On Unix, the binary **ignores SIGTSTP / SIGTTIN / SIGTTOU** for all commands (dashboard **and** long `list` / `probe` runs) so bash is less likely to print **`[1]+ Stopped`**; **`cargo run` still wraps a parent `cargo` process** — prefer **`./target/debug/crossusage-cli`** directly. Probes run in the **background** in the TUI; the main loop never blocks on `run_probe` so input stays responsive.

**Daemon:** normalized “primary %” threshold alerts via `notify-rust`. Notifications need a desktop session; use `--log-file` when headless.

If the CLI reports **no providers**, it could not find bundled plugins: use **`INSTALL_MODE=cli`**, or set **`CROSSUSAGE_RESOURCES`** to the directory that contains `bundled_plugins/` or `resources/bundled_plugins/`, or run from the **repo root** with `src-tauri/resources/` populated (`bun run bundle:plugins`). The resolver does **not** fall back to the current directory (`.`). Details: [`crates/crossusage-core/src/paths.rs`](crates/crossusage-core/src/paths.rs).

**Troubleshooting (dev / terminal):**

- **Where to run:** open a terminal in the **repository root** — the folder that contains the workspace `Cargo.toml` (the CrossUsage / OpenUsage fork you cloned), then `cargo build -p crossusage-cli` / `cargo run -p crossusage-cli`. There is no magic path name; it’s “where you cloned this repo.”
- **`[1]+ Stopped` / it “closes” with no error:** bash **suspended the job** — usually **Ctrl+Z**, but **integrated terminals** (e.g. Cursor) can also trip **job-control signals** (**SIGTTIN** / **SIGTTOU**) during long runs. The CLI **ignores SIGTSTP + SIGTTIN + SIGTTOU** for every subcommand (not only the dashboard). If it still happens, run **`./target/debug/crossusage-cli`** instead of **`cargo run`** (the shell job is often **`cargo`**, not the CLI). Run **`fg`** to resume a stopped job, or **`kill %1`**. Quit the TUI with **`q`**, not Ctrl+Z.
- **`list` columns `input` / `output` / `cost` are `—`:** plugins must expose those numbers — usually via **`text`** lines, or **`progress`** with **`format: count`** (tokens / requests) or **`dollars`**. **Antigravity** (and similar) still sends **real per-model quota from the API** (model names like Claude Opus/Sonnet 4.6, GPT-OSS 120B, etc. come from **`GetUserStatus` / `clientModelConfigs[].label`** or Cloud Code **`displayName`** — not invented by CrossUsage). Those APIs simply **don’t expose token or dollar totals** for the `list` table, so those three columns stay empty. Use **`probe antigravity`** to see the full JSON.
- **`list` / `probe` looked “broken” vs the dashboard:** they used to print **plugin-host WARN/ERROR** (e.g. “not logged in”) on stderr for every provider you don’t use. That now matches the dashboard — **quiet by default**; use **`--verbose`** to see those logs. Probe fewer providers: **`crossusage-cli list cursor`**, **`crossusage-cli probe cursor`**.
- **`list` / `probe` show no TUI:** there is **no full-screen UI** and **`q` does nothing** — output appears **after** all probes finish (or use **`--json`**). While it runs you should see **`crossusage-cli: probing N provider(s)…`** and **`[i/N] id…`** on **stderr**. Each provider uses the **same wall-clock cap as the dashboard** (default **120s**, override **`CROSSUSAGE_PROBE_TIMEOUT_SEC`**); after a timeout the CLI **continues** (error row for that provider). **`Ctrl+C`** is polled during waits (~200ms), so it can stop mid-probe (exit **130**), not only between providers — or use **`crossusage-cli list cursor`** to probe only Cursor.
- **First launch feels slow:** the CLI **probes each provider** before the TUI draws; stderr may show `probing 1/N…` — wait, or use `crossusage-cli list` / `crossusage-cli probe` for non-interactive output.
- **Stuck on one provider (e.g. “11/16”):** one plugin’s `run_probe` can block on the network. The dashboard uses a **per-provider wall-clock timeout** (default **120s**). Override with **`CROSSUSAGE_PROBE_TIMEOUT_SEC`** (e.g. `30` for faster fail). After a timeout, that provider shows an error row and probing **continues**. Logs showed **`minimax`** and **`zai`** as examples that needed the timeout path.
- **Cleaner TTY:** after `cargo build`, run **`./target/debug/crossusage-cli`** directly instead of `cargo run` so the terminal isn’t wrapping Cargo’s process (same binary).

### CLI screenshots (placeholders)

```
+------------------------------------------------------------------+
|  CrossUsage CLI — dashboard (ratatui)     Screenshot coming soon |
|  [ Providers ] [ Detail pane ] [ Sparkline / metrics ]           |
+------------------------------------------------------------------+
|  Tip: run `cargo run -p crossusage-cli` (default dashboard) from dev. |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|  crossusage-cli export --format csv    Screenshot coming soon    |
+------------------------------------------------------------------+
```

## What it does

CrossUsage lives in your menu bar and shows how much of your AI coding subscriptions you’ve used. Progress bars, badges, and clear labels. No mental math required.

- **One glance.** All your AI tools, one panel.
- **Always up-to-date.** Refreshes automatically on a schedule you pick.
- **Global shortcut.** Toggle the panel from anywhere with a customizable keyboard shortcut.
- **Lightweight.** Opens instantly, stays out of your way.
- **Plugin-based.** New providers get added without updating the whole app.
- **[Local HTTP API](docs/local-http-api.md).** Other apps can read cached usage data from `127.0.0.1:6736` while CrossUsage is running.
- **[HTTP/SOCKS proxy](docs/proxy.md).** Optional proxy in `~/.crossusage/config.json` (auto-created on first launch; legacy `~/.openusage/config.json` still honored for proxy).

## Supported Providers

**Multiple Cursor or Claude accounts:** paste OAuth tokens per row in Settings — see [**multi-account credentials**](docs/providers/multi-account-credentials.md).

- [**Amp**](docs/providers/amp.md) / free tier, bonus, credits
- [**Antigravity**](docs/providers/antigravity.md) / all models
- [**Claude**](docs/providers/claude.md) / session, weekly, extra usage, local token usage (ccusage)
- [**Codex**](docs/providers/codex.md) / session, weekly, reviews, credits
- [**Copilot**](docs/providers/copilot.md) / premium, chat, completions
- [**CrofAI**](docs/providers/crofai.md) / credits, daily requests
- [**Cursor**](docs/providers/cursor.md) / credits, total usage, auto usage, API usage, on-demand, CLI auth (the **Requests** tray line appears only for some Enterprise/Team accounts when the API returns request-based usage; Pro accounts typically use the other metrics)
- [**DeepSeek**](docs/providers/deepseek.md) / balance (USD)
- [**Factory / Droid**](docs/providers/factory.md) / standard, premium tokens
- [**Gemini**](docs/providers/gemini.md) / pro, flash, workspace/free/paid tier
- [**JetBrains AI Assistant**](docs/providers/jetbrains-ai-assistant.md) / quota, remaining
- [**Kiro**](docs/providers/kiro.md) / credits, bonus credits, overages
- [**Kimi Code**](docs/providers/kimi.md) / session, weekly
- [**MiniMax**](docs/providers/minimax.md) / token plan model-calls, CN TTS/image buckets
- [**Neuralwatt**](docs/providers/neuralwatt.md) / subscription energy, balance credits
- [**Ollama**](docs/providers/ollama.md) / cloud session, weekly
- [**OpenCode Go**](docs/providers/opencode-go.md) / 5h, weekly, monthly spend limits
- [**Synthetic**](docs/providers/synthetic.md) / rate limits, weekly mana, search quota
- [**Windsurf**](docs/providers/windsurf.md) / prompt credits, flex credits
- [**Z.ai**](docs/providers/zai.md) / session, weekly, web searches

Community contributions welcome.

Want a provider that's not listed? Open an issue on **[this fork](https://github.com/barramee27/crossusage/issues)** or **[upstream](https://github.com/robinebers/openusage/issues/new)** depending on whether the change is fork-specific or general.

## Open source

Upstream **OpenUsage** is built by its users and contributors. This **CrossUsage** fork tracks that codebase and adds cross-platform improvements; issues and PRs for the fork go to **[barramee27/crossusage](https://github.com/barramee27/crossusage)**. Upstream development lives at **[robinebers/openusage](https://github.com/robinebers/openusage)**.

Plugins are bundled with the app today; the plugin API continues to evolve upstream.

<a href="https://www.star-history.com/?repos=robinebers%2Fopenusage&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=robinebers/openusage&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=robinebers/openusage&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=robinebers/openusage&type=date&legend=top-left" />
 </picture>
</a>

### How to Contribute

- **Add a provider.** Each one is just a plugin. See the [Plugin API](docs/plugins/api.md).
- **Fix a bug.** PRs welcome against **[barramee27/crossusage](https://github.com/barramee27/crossusage)**. Provide before/after screenshots.
- **Request a feature.** Prefer **[fork issues](https://github.com/barramee27/crossusage/issues)** for Linux/Windows packaging; use **[upstream](https://github.com/robinebers/openusage/issues)** for core product/plugin API work.

Keep it simple. No feature creep, no AI-generated commit messages, test your changes.

**Bug reports:** In the desktop app, open **Settings** → **Troubleshooting** → **Copy log tail** for redacted recent log text only; add your description in a [CrossUsage issue](https://github.com/barramee27/crossusage/issues). The **Bug Report** template on GitHub lists the fields we find most useful.

## Testing

- **Frontend:** `bun run test` runs Vitest once and exits. Use `bun run test:watch` for watch mode.
- **CLI dashboard:** **`q`** or **Ctrl+C** opens a **quit confirmation** (`y`/`n`). **`?`** shows help. **Ctrl+Z** (**SIGTSTP**): on Unix the dashboard ignores **SIGTSTP** while the TUI runs; if suspended, run `fg` then quit.
- **Plugin / CLI HTTP endpoints:** curated table in [`docs/api-urls.md`](docs/api-urls.md); refresh a sorted unique list with `./scripts/list-api-urls.sh` (no network). Cursor full paths: `./scripts/print-cursor-endpoints.sh`. See [`docs/research/deep-crawl-and-vpn.md`](docs/research/deep-crawl-and-vpn.md) for why `wget -r` is not used to discover `api2.*` routes.

## Built Entirely with AI

Not a single line of code in this project was read or written by hand. 100% AI-generated, AI-reviewed, AI-shipped — using [Cursor](https://cursor.com), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), and [Codex CLI](https://github.com/openai/codex).

The original OpenUsage project is a real-world example of what Robin teaches in the [AI Builder's Blueprint](https://itsbyrob.in/EBDqgJ6).

## Sponsors (upstream)

OpenUsage is supported by sponsors. [Become a sponsor](https://github.com/sponsors/robinebers) to support upstream development.

<!-- Add sponsor logos here -->

## Credits

Inspired by [CodexBar](https://github.com/steipete/CodexBar) by [@steipete](https://github.com/steipete). Same idea, very different approach.

## License

[MIT](LICENSE)

---

<details>
<summary><strong>Build from source</strong></summary>

> **Warning**: The `main` branch may not be stable. It is merged directly without staging, so users are advised to use tagged versions for stable builds. Tagged versions are fully tested while `main` may contain unreleased features.

### Stack

- **Desktop:** Tauri **v2**, React, Bun — see repo `package.json`.
- **CLI:** Rust `crossusage-cli` — `cargo build -p crossusage-cli`, `cargo test -p crossusage-cli`.
- **Core:** `crates/crossusage-core` (plugin engine shared with the GUI).

**Desktop build / dev (important):** This repo uses **Tauri v2** (`src-tauri/tauri.conf.json` + `$schema` …`/config/2`). Use the **npm-installed CLI** (matches v2):

```bash
bun install   # or npm install
bun run bundle:plugins
bun run tauri:dev    # development
bun run tauri:build  # release bundle
```

Do **not** use `cargo tauri build` unless your **global** `cargo-tauri` is **v2** (`cargo install tauri-cli --version "^2"`). If you see errors like *Additional properties are not allowed ('devUrl', 'frontendDist'…)* or *('app', 'bundle'…)*, your `cargo tauri` is **v1** validating a **v2** config — switch to `bun run tauri:build` above.

Dev CLI from the repo root:

```bash
cargo run -p crossusage-cli -- list
cargo run -p crossusage-cli -- dashboard
```
