# Proxy Configuration

CrossUsage can route provider and plugin HTTP requests through an optional proxy.

- Supported proxy types: `socks5://`, `http://`, `https://`
- **Primary config:** `~/.crossusage/config.json` (created automatically on first launch if missing)
- **Legacy:** `~/.openusage/config.json` is still read if the CrossUsage file does not define an **enabled** proxy
- Default: off
- UI: none

## Config File

The app creates `~/.crossusage/config.json` with a `proxy` section on first start. Enable it like this:

```json
{
  "proxy": {
    "enabled": true,
    "url": "socks5://127.0.0.1:10808"
  },
  "synthetic": {
    "apiKey": ""
  }
}
```

You can also use an authenticated proxy URL:

```json
{
  "proxy": {
    "enabled": true,
    "url": "http://user:pass@proxy.example.com:8080"
  },
  "synthetic": {
    "apiKey": ""
  }
}
```

## Behavior

- Config is loaded once when the app starts (first HTTP request from a plugin).
- Restart CrossUsage after changing the file.
- `localhost`, `127.0.0.1`, and `::1` always bypass the proxy.
- Missing, disabled, invalid, or unreadable proxy settings leave proxying off.
- Proxy credentials are redacted in logs.
- If `~/.crossusage/config.json` has `proxy.enabled: false` or omits proxy, CrossUsage will try **`~/.openusage/config.json`** for an enabled proxy (migration from OpenUsage).

## Scope

This applies to provider and plugin HTTP requests that go through CrossUsage’s built-in HTTP client.

It is not a general system proxy and does not automatically proxy unrelated subprocess network traffic.
