# Optional: crawling URLs with `wget` (research only)

CrossUsage’s **implemented** endpoints are defined in source; see [api-urls.md](../api-urls.md) and `./scripts/list-api-urls.sh`.

Recursive spidering, e.g.:

```bash
wget --spider --no-parent -r -l 2 --wait=1 -e robots=on \
  'https://docs.example.com/' 2>&1 | grep '^--' | awk '{print $3}' | sort -u
```

**May help:** mapping **public HTML** sites (documentation, marketing) via links.

**Does not replace plugin work:** vendor **JSON APIs** and **OAuth** hosts usually do not expose a browsable link graph like a website. You will not discover private routes such as those under `api2.cursor.sh` by crawling `cursor.com`.

**Risks:** rate limits, IP blocks, and **terms of service**. Prefer low depth (`-l`), delays (`--wait`), and `robots=on`. Do not run aggressive crawls against third-party APIs from CI.

**No elevated privileges:** `sudo` does not reveal additional API paths; authentication still requires valid tokens.

**VPN (e.g. Surfshark OpenVPN):** only changes egress IP/region. For **API** URLs CrossUsage already calls, see [deep-crawl-and-vpn.md](deep-crawl-and-vpn.md) and [../../scripts/print-cursor-endpoints.sh](../../scripts/print-cursor-endpoints.sh). Optional HTML-only spider: [../../scripts/wget-html-spider.sh](../../scripts/wget-html-spider.sh).
