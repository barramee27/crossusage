# Deploy crossusage.dev (VPS)

Operator runbook for the static marketing site, TLS, optional `/files/` mirrors, and CI/rsync deploy. The site source lives in this repo at **`sites/crossusage-web/`** (fork of upstream `openusage-web`; build output is **`out/`**). See [SITE_SOURCE.md](SITE_SOURCE.md).

## 1. DNS

See [DNS.md](DNS.md). **Canonical host:** `https://crossusage.dev` (apex). `www` redirects to apex.

## 2. Server directories

On the VPS (Debian/Ubuntu example):

```bash
sudo mkdir -p /var/www/crossusage.dev/html
sudo mkdir -p /var/www/crossusage.dev/files
sudo mkdir -p /var/www/certbot
sudo chown -R root:root /var/www/crossusage.dev
sudo find /var/www/crossusage.dev -type d -exec chmod 755 {} \;
sudo find /var/www/crossusage.dev/files -type f -exec chmod 644 {} \; 2>/dev/null || true
```

Deploy user (see below) needs **write** access to `html/` and, if used, `files/`.

## 3. nginx

```bash
sudo cp nginx/crossusage.dev.conf /etc/nginx/sites-available/crossusage.dev
# Before certs exist, you may temporarily use nginx/crossusage.dev.http-only.conf instead.
sudo ln -sf /etc/nginx/sites-available/crossusage.dev /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

If `options-ssl-nginx.conf` or `ssl-dhparams.pem` are missing, run `sudo certbot` once (see below); Certbot usually creates them under `/etc/letsencrypt/`.

## 4. Certbot (Let’s Encrypt)

**Option A — nginx plugin (recommended):**

```bash
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crossusage.dev -d www.crossusage.dev
```

Follow prompts, then merge any plugin changes with the headers/caching in `nginx/crossusage.dev.conf` if needed.

**Option B — webroot (matches `/.well-known/` in the main config):**

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d crossusage.dev -d www.crossusage.dev
```

Then ensure `crossusage.dev.conf` is installed and reload nginx.

### Renewal

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

**HSTS** is already set to one week in `crossusage.dev.conf`. After you are confident redirects and HTTPS are correct everywhere, edit the header to a longer `max-age` (for example `31536000`) and add `preload` only if you intend to submit to the preload list.

## 5. Deploy user and rsync

Script (run on the VPS as root):

```bash
sudo bash scripts/create-deploy-user.sh
```

This creates user `crossusage-deploy` with `authorized_keys`, forces `command=` to **only** allow `rsync` and an optional nginx test/reload wrapper. **Replace** the placeholder public key in the script before running, or edit `/home/crossusage-deploy/.ssh/authorized_keys` afterward.

Passwordless reload (optional, tight sudoers):

```bash
sudo cp sudoers/crossusage-deploy-nginx /etc/sudoers.d/crossusage-deploy-nginx
sudo chmod 440 /etc/sudoers.d/crossusage-deploy-nginx
```

Then from your laptop or CI (after `npm run build` in `sites/crossusage-web`, which writes `out/`):

```bash
rsync -avz --delete -e ssh ./out/ crossusage-deploy@vps:/var/www/crossusage.dev/html/
ssh crossusage-deploy@vps sudo /usr/local/sbin/crossusage-nginx-reload
```

The second command only works if the forced command allows it (see script) and sudoers is installed.

## 6. GitHub Actions (site)

`sites/crossusage-web/.github/workflows/deploy.yml` rsyncs **`out/`** after `next build`. Configure **Secrets** and set variable **`ENABLE_VPS_DEPLOY=true`** as documented in `sites/crossusage-web/README.md`.

## 7. Optional `/files/` hosting

See [files/README.md](files/README.md). Nginx `location /files/` is already in `nginx/crossusage.dev.conf`. Populate `/var/www/crossusage.dev/files/vX.Y.Z/` with artifacts and checksums; **no** `autoindex`.

## 8. Product polls API

See [polls-api/README.md](polls-api/README.md). Install Bun service + systemd unit, then ensure nginx has `location ^~ /api/polls/` (in `nginx/crossusage.dev.conf`) proxying to `127.0.0.1:6740`. Publish polls by dropping JSON into the service `polls/` dir with `"active": true`.

Verify:

```bash
curl -si https://crossusage.dev/api/polls/active
# 204 when none active; 200 + JSON when a poll is published
```

## Verification

- [SSL Labs](https://www.ssllabs.com/ssltest/) for `crossusage.dev`
- `curl -sI https://crossusage.dev` — expect HSTS, CSP, gzip on HTML
- `curl -sI http://www.crossusage.dev` — chain should end at `https://crossusage.dev/`
