# CrossUsage

**CrossUsage** is a **community fork** of **[OpenUsage](https://github.com/robinebers/openusage)**. **All credit for the original app, product direction, and plugin architecture goes to [Robin Ebers](https://github.com/robinebers)** ([@robinebers](https://github.com/robinebers)) — please star and support **[upstream OpenUsage](https://github.com/robinebers/openusage)**.

- **Upstream (authoritative for the core app):** [github.com/robinebers/openusage](https://github.com/robinebers/openusage) · [releases](https://github.com/robinebers/openusage/releases/latest) · site [openusage.ai](https://www.openusage.ai)
- **This fork (Linux & Windows builds, cross-platform polish):** [github.com/barramee27/crossusage](https://github.com/barramee27/crossusage) · [releases](https://github.com/barramee27/crossusage/releases/latest)

If you cite or redistribute builds from this repo, **name OpenUsage and Robin Ebers** as the original authors. This fork exists to ship **native Linux and Windows** installers; for the **macOS-first** experience, use **[upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest)**.

See your usage at a glance from your menu bar. No digging through dashboards.

![CrossUsage screenshot](screenshot.png)

## Download

[**Latest CrossUsage release**](https://github.com/barramee27/crossusage/releases/latest)

Artifacts use the **`crossusage_1.0.0_…`** style (see [GitHub Releases](https://github.com/barramee27/crossusage/releases)):

- **Windows** — `crossusage_1.0.0_x64-setup.exe` (NSIS installer) and/or `crossusage.exe` (beside the installer output)
- **Linux** — `crossusage_1.0.0_amd64.deb`, RPM `crossusage-1.0.0-…`, `crossusage_1.0.0_amd64.AppImage`
- **macOS** — use [upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest) (this fork targets Linux/Windows first)

Pre-built binaries — install and run.

### One-line install from GitHub

**Linux** (auto-detects package manager: `.deb` on Debian/Ubuntu, `.rpm` on Fedora/RHEL-like, or AppImage fallback). Requires `curl` *or* `wget`, and `jq` *or* `python3`:

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.sh | bash
```

**Windows** (PowerShell; downloads the latest NSIS `*x64-setup.exe` and runs it, silent by default):

```powershell
irm https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.ps1 | iex
```

**macOS:** CrossUsage does not publish macOS installers; use [upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest). If you run the Linux script on macOS, it exits with that link.

**Security:** Inspect [`scripts/install.sh`](scripts/install.sh) and [`scripts/install.ps1`](scripts/install.ps1) before piping to `bash` or `iex`. They only talk to GitHub’s API and release asset URLs over HTTPS. You can always install manually from [releases](https://github.com/barramee27/crossusage/releases/latest).

**Optional environment:** `GITHUB_REPO` (default `barramee27/crossusage`); Linux `INSTALL_KIND=deb|rpm|appimage`; Windows `INSTALL_SILENT=0` for a non-silent NSIS install.

**CLI-only (no desktop app / no WebKit):** downloads a portable tarball (`crossusage-cli_*_linux_amd64.tar.gz` from the release — build it with `bun run release:cli-tarball` and upload the asset):

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.sh | INSTALL_MODE=cli bash
```

**ShellCheck** is an optional static analyzer for shell scripts (`shellcheck scripts/install.sh`); it catches quoting bugs and portability issues before you ship.

More detail: [INSTALL.md](INSTALL.md).

**Same install includes a terminal CLI** (`crossusage-cli`): one package installs both the tray app and the CLI (e.g. on Linux `.deb`, both live under `/usr/bin/`). From the repo dev tree: `cargo run -p crossusage-cli -- list`.

```bash
crossusage-cli list              # providers
crossusage-cli probe             # all providers
crossusage-cli probe cursor      # one provider
crossusage-cli probe --json      # machine-readable
crossusage-cli dashboard       # full-screen TUI (htop-style panels; q to quit)
```

Set `CROSSUSAGE_RESOURCES` if bundled plugins are not found (see `crates/crossusage-core/src/paths.rs`).

## What it does

CrossUsage lives in your menu bar and shows how much of your AI coding subscriptions you’ve used. Progress bars, badges, and clear labels. No mental math required.

- **One glance.** All your AI tools, one panel.
- **Always up-to-date.** Refreshes automatically on a schedule you pick.
- **Global shortcut.** Toggle the panel from anywhere with a customizable keyboard shortcut.
- **Lightweight.** Opens instantly, stays out of your way.
- **Plugin-based.** New providers get added without updating the whole app.

## Supported Providers

- [**Amp**](docs/providers/amp.md) / free tier, bonus, credits
- [**Antigravity**](docs/providers/antigravity.md) / all models
- [**Claude**](docs/providers/claude.md) / session, weekly, extra usage, local token usage (ccusage)
- [**Codex**](docs/providers/codex.md) / session, weekly, reviews, credits
- [**Copilot**](docs/providers/copilot.md) / premium, chat, completions
- [**Cursor**](docs/providers/cursor.md) / credits, total usage, auto usage, API usage, on-demand, CLI auth (the **Requests** tray line appears only for some Enterprise/Team accounts when the API returns request-based usage; Pro accounts typically use the other metrics)
- [**Factory / Droid**](docs/providers/factory.md) / standard, premium tokens
- [**Gemini**](docs/providers/gemini.md) / pro, flash, workspace/free/paid tier
- [**JetBrains AI Assistant**](docs/providers/jetbrains-ai-assistant.md) / quota, remaining
- [**Kimi Code**](docs/providers/kimi.md) / session, weekly
- [**MiniMax**](docs/providers/minimax.md) / coding plan session
- [**OpenCode Go**](docs/providers/opencode-go.md) / 5h, weekly, monthly spend limits
- [**Windsurf**](docs/providers/windsurf.md) / prompt credits, flex credits
- [**Z.ai**](docs/providers/zai.md) / session, weekly, web searches

### Maybe Soon

- [Vercel AI Gateway](https://github.com/robinebers/openusage/issues/18)

Community contributions welcome.
Want a provider that's not listed? Open an issue on **[this fork](https://github.com/barramee27/crossusage/issues)** or **[upstream](https://github.com/robinebers/openusage/issues/new)** depending on whether the change is fork-specific or general.

## Open source

Upstream **OpenUsage** is built by its users and contributors. This **CrossUsage** fork tracks that codebase and adds cross-platform improvements; issues and PRs for the fork go to **[barramee27/crossusage](https://github.com/barramee27/crossusage)**. Upstream development lives at **[robinebers/openusage](https://github.com/robinebers/openusage)**.

Plugins are bundled with the app today; the plugin API continues to evolve upstream.

### How to Contribute

- **Add a provider.** Each one is just a plugin. See the [Plugin API](docs/plugins/api.md).
- **Fix a bug.** PRs welcome against **[barramee27/crossusage](https://github.com/barramee27/crossusage)**. Provide before/after screenshots.
- **Request a feature.** Prefer **[fork issues](https://github.com/barramee27/crossusage/issues)** for Linux/Windows packaging; use **[upstream](https://github.com/robinebers/openusage/issues)** for core product/plugin API work.

Keep it simple. No feature creep, no AI-generated commit messages, test your changes.

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

...
