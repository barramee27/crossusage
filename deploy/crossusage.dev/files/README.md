# Optional release files on the VPS

Use this when you want **versioned** download URLs on your own domain (for example `https://crossusage.dev/files/v1.0.4/...`) in addition to GitHub Releases.

## Layout

```text
/var/www/crossusage.dev/files/
  v1.0.4/
    crossusage_1.0.4_amd64.deb
    crossusage_1.0.4_amd64.deb.sha256
    ...
```

- **No** directory indexes (`autoindex off` in nginx).
- Files should be **read-only** for the web server (`644` for files, `755` for directories).
- Do **not** allow execution in this tree (no PHP/CGI; static downloads only).
- Publish **checksums** next to binaries; link to these URLs from GitHub Release notes and from the marketing **Download** page if you enable the mirror.

## Permissions

```bash
sudo chown -R root:root /var/www/crossusage.dev/files
sudo find /var/www/crossusage.dev/files -type d -exec chmod 755 {} \;
sudo find /var/www/crossusage.dev/files -type f -exec chmod 644 {} \;
```

If the deploy user uploads here:

```bash
sudo chown -R crossusage-deploy:crossusage-deploy /var/www/crossusage.dev/files
```

## nginx

`nginx/crossusage.dev.conf` already includes:

```nginx
location ^~ /files/ {
    alias /var/www/crossusage.dev/files/;
    autoindex off;
    ...
}
```

## Relationship to the desktop app

The Tauri updater can keep using **GitHub** `latest.json` and artifacts unless you deliberately self-host `latest.json` and signed bundles (separate hardening and signing-key story).
