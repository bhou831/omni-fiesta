#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -n $(git status --porcelain) ]]; then
  echo 'Checkout has uncommitted or untracked changes; commit or remove them before deploying.' >&2
  exit 1
fi
if [[ ! -d /opt/omni-fiesta || ! -f /etc/omni-fiesta.env ]]; then
  echo 'Expected the existing /opt/omni-fiesta service and /etc/omni-fiesta.env.' >&2
  exit 1
fi
if ! sudo test -f /var/lib/omni-fiesta/party.sqlite; then
  echo 'Expected database /var/lib/omni-fiesta/party.sqlite; check deployment configuration.' >&2
  exit 1
fi
if ! sudo grep -qx 'DATABASE_PATH=/var/lib/omni-fiesta/party.sqlite' /etc/omni-fiesta.env; then
  echo 'Expected DATABASE_PATH=/var/lib/omni-fiesta/party.sqlite in /etc/omni-fiesta.env.' >&2
  exit 1
fi

revision=$(git rev-parse HEAD)
echo "Building release $revision"
npm ci
# Vite embeds this browser key during the client build. systemd's EnvironmentFile
# applies only when the server starts, which is too late for the TV bundle.
maps_key=$(sudo sed -n 's/^VITE_GOOGLE_MAPS_API_KEY=//p' /etc/omni-fiesta.env | tail -n 1)
if [[ -z "$maps_key" ]]; then
  echo 'Set VITE_GOOGLE_MAPS_API_KEY in /etc/omni-fiesta.env before building the TV.' >&2
  exit 1
fi
export VITE_GOOGLE_MAPS_API_KEY="$maps_key"
unset maps_key
npm run build

stage="/opt/omni-fiesta-stage-$$"
previous="/opt/omni-fiesta-previous-$$"
backup="/var/lib/omni-fiesta/backups/party-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite"
sudo mkdir "$stage"
trap 'sudo rm -rf "$stage"' EXIT
sudo cp -a dist node_modules config fixtures package.json package-lock.json "$stage/"
printf '%s\n' "$revision" | sudo tee "$stage/REVISION" >/dev/null
sudo chown -R root:root "$stage"

sudo install -d -m 700 -o omni-fiesta -g omni-fiesta /var/lib/omni-fiesta/backups
sudo systemctl stop omni-fiesta
if ! sudo node scripts/backup.mjs /var/lib/omni-fiesta/party.sqlite "$backup"; then
  sudo systemctl start omni-fiesta
  echo 'Backup failed; previous service restarted.' >&2
  exit 1
fi
sudo chmod 600 "$backup"
echo "Database backup: $backup"

sudo mv /opt/omni-fiesta "$previous"
if ! sudo mv "$stage" /opt/omni-fiesta; then
  sudo mv "$previous" /opt/omni-fiesta
  sudo systemctl start omni-fiesta
  echo 'Release installation failed; previous files restored.' >&2
  exit 1
fi
echo "Previous release retained at $previous"
sudo systemctl start omni-fiesta
for attempt in {1..15}; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health; then
    printf '\nDeployed revision %s\n' "$revision"
    exit 0
  fi
  sleep 1
done
echo "Health check failed. Inspect journalctl -u omni-fiesta; backup is $backup." >&2
echo 'Do not roll back code without checking database migration compatibility.' >&2
exit 1
