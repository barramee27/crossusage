# DNS for crossusage.dev

Complete these steps at your DNS provider **before** requesting TLS certificates.

## Records

| Name | Type | Value |
|------|------|--------|
| `crossusage.dev` | **A** | Your VPS IPv4 address |
| `crossusage.dev` | **AAAA** (optional) | Your VPS IPv6 address |
| `www.crossusage.dev` | **A** / **AAAA** | Same as apex (if you want `www`) |

Wait until lookups from your machine match the VPS (propagation can take minutes to hours).

## Canonical hostname

This deployment treats **`https://crossusage.dev`** (apex) as canonical.

- Requests to `http://crossusage.dev`, `http://www.crossusage.dev`, and `https://www.crossusage.dev` are redirected to **`https://crossusage.dev`** with HTTP 301.

If you prefer `www` as canonical instead, swap `server_name` directives and redirect targets in `nginx/crossusage.dev.conf`.

## Verification

```bash
dig +short crossusage.dev A
dig +short www.crossusage.dev A
```

Both should return your VPS public IP when you are ready for Certbot.
