# API hosts (`api2.cursor.sh`, `cursor.com/api`, …) vs `wget`

You may want to “deep crawl” **real API URLs** (e.g. `https://api2.cursor.sh/...`, `https://cursor.com/api/...`) — **not** marketing/docs sites.

## Why recursive `wget` is the wrong tool for APIs

| What `wget -r` expects | What JSON / Connect / gRPC-style APIs do |
|------------------------|-------------------------------------------|
| HTML pages with `<a href="...">` links | Mostly **no browsable link graph** of routes |
| Same-origin relative links | Paths are **known to the client**, not discovered by crawling |
| Public GET | Often **401/403** without session cookies or bearer tokens |

So pointing `wget --spider -r` at `https://api2.cursor.sh/` or `https://cursor.com/api/` usually yields **errors or almost nothing useful**, not a list of every RPC path. VPN only changes **where** you exit; it does **not** make APIs behave like HTML sites.

## Where the real Cursor API URLs already are

CrossUsage builds exact URLs in [`plugins/cursor/plugin.js`](../../plugins/cursor/plugin.js). Examples:

- `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
- `https://api2.cursor.sh/oauth/token`
- `https://cursor.com/api/usage` (and query variants in code)

The full table is in [`docs/api-urls.md`](../api-urls.md) (Cursor section). **That list is the “crawl result” that matters** for this project — it comes from reverse‑engineered client behavior, not from `wget`.

Quick printout on your machine:

```bash
./scripts/print-cursor-endpoints.sh
```

## If you need *new* paths the repo doesn’t have yet

Reasonable approaches (no substitute in `wget -r`):

1. **Browser DevTools → Network** while using the official Cursor app (same account) — see real requests (respect ToS).
2. **mitmproxy** / similar on **your** machine with **your** traffic only — advanced; legal/ToS are your responsibility.
3. **Upstream / community** reverse‑engineering notes (issues, other clients).

Do not commit tokens or HAR files to git.

## VPN (Surfshark OpenVPN)

Changing region:

```bash
sudo killall openvpn
sudo openvpn \
  --config /etc/openvpn/th-bkk.prod.surfshark.com_udp.ovpn \
  --auth-user-pass /etc/openvpn/auth.txt \
  --daemon
```

Switch **only** `--config` to another profile under `/etc/openvpn/`. This does **not** replace reading [`plugins/cursor/plugin.js`](../../plugins/cursor/plugin.js) for endpoint paths.

## HTML-only spider (optional, rare)

If you ever need to follow **HTML** links on a site (sitemaps, public help pages), use [`../scripts/wget-html-spider.sh`](../../scripts/wget-html-spider.sh) — **not** for `api2.*` discovery.

## Security

Never commit `auth.txt`, cookies, or API keys.
