#!/usr/bin/env bash
# Run on the VPS as root. Review and edit DEPLOY_PUBKEY before running.
set -euo pipefail

DEPLOY_USER="crossusage-deploy"
DEPLOY_GROUP="crossusage-site"
SITE_ROOT="/var/www/crossusage.dev/html"
FILES_ROOT="/var/www/crossusage.dev/files"
RELOAD_HELPER_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/crossusage-nginx-reload"
RELOAD_HELPER_DST="/usr/local/sbin/crossusage-nginx-reload"

# Replace with your CI or laptop SSH public key (single line).
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-ssh-ed25519 AAAA...you@host}"

if [[ "$DEPLOY_PUBKEY" == *"AAAA...you"* ]]; then
  echo "Edit DEPLOY_PUBKEY in this script or export DEPLOY_PUBKEY before running." >&2
  exit 1
fi

getent group "$DEPLOY_GROUP" >/dev/null || groupadd "$DEPLOY_GROUP"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd -m -g "$DEPLOY_GROUP" -s /bin/bash "$DEPLOY_USER"
fi

install -m 0755 -o root -g root "$RELOAD_HELPER_SRC" "$RELOAD_HELPER_DST"

mkdir -p "$SITE_ROOT" "$FILES_ROOT"
chown -R root:"$DEPLOY_GROUP" "$SITE_ROOT" "$FILES_ROOT"
chmod 2775 "$SITE_ROOT" "$FILES_ROOT"
find "$SITE_ROOT" "$FILES_ROOT" -type d -exec chmod g+s {} \;

usermod -aG "$DEPLOY_GROUP" "$DEPLOY_USER"

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "/home/$DEPLOY_USER/.ssh"
AUTH_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
if ! grep -Fq "$DEPLOY_PUBKEY" "$AUTH_KEYS" 2>/dev/null; then
  echo "$DEPLOY_PUBKEY" >>"$AUTH_KEYS"
  chown "$DEPLOY_USER:$DEPLOY_GROUP" "$AUTH_KEYS"
  chmod 600 "$AUTH_KEYS"
fi

echo "Done. Next:"
echo "  1. sudo cp ../sudoers/crossusage-deploy-nginx /etc/sudoers.d/ && sudo chmod 440 /etc/sudoers.d/crossusage-deploy-nginx"
echo "  2. rsync from build machine: rsync -avz --delete out/ $DEPLOY_USER@$(hostname -f):$SITE_ROOT/"
echo "  3. ssh $DEPLOY_USER@$(hostname -f) sudo $RELOAD_HELPER_DST"
