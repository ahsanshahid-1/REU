#!/usr/bin/env bash
#
# One-command deploy for the CRC JupyterHub container.
#
# On this host the site is served in two places:
#   1. Node (server.js) on :3000 serves the /api/* endpoints (chatbot, health).
#   2. Apache serves the STATIC pages from a separate DocumentRoot
#      (default /var/www/reu), NOT from public/. So updating the repo alone
#      does not change what the browser sees — the static files must also be
#      copied into the Apache DocumentRoot.
#
# This script does both: pulls the latest code, then publishes public/ to the
# Apache DocumentRoot. Pass --restart to also restart the Node app (only needed
# when server.js or lib/ changed, e.g. the chatbot).
#
# Usage:
#   bash deploy.sh                 # pull + publish static
#   bash deploy.sh --restart       # pull + publish static + restart Node
#   DOCROOT=/var/www/reu bash deploy.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCROOT="${DOCROOT:-/var/www/reu}"

cd "$REPO_DIR"

echo "==> Pulling latest code in $REPO_DIR"
git pull --ff-only

echo "==> Publishing public/ to Apache DocumentRoot: $DOCROOT"
if [ ! -d "$DOCROOT" ]; then
  echo "ERROR: DocumentRoot '$DOCROOT' does not exist. Set DOCROOT=... and retry." >&2
  exit 1
fi
if [ ! -w "$DOCROOT" ]; then
  echo "ERROR: DocumentRoot '$DOCROOT' is not writable by $(whoami)." >&2
  echo "       Ask CRC to make it writable or to symlink it to $REPO_DIR/public." >&2
  exit 1
fi
cp -a "$REPO_DIR/public/." "$DOCROOT/"

if [ "${1:-}" = "--restart" ]; then
  echo "==> Restarting Node app (server.js)"
  pkill -f "node server.js" || true
  sleep 1
  # Preserve an existing ADMIN_TOKEN if one is exported; otherwise server.js
  # generates one at startup (printed to the log).
  setsid nohup npm start > "$REPO_DIR/server.log" 2>&1 &
  sleep 2
  if curl -sf localhost:3000/api/health >/dev/null; then
    echo "    Node app is up (/api/health OK)."
  else
    echo "    WARNING: /api/health did not respond; check $REPO_DIR/server.log" >&2
  fi
fi

echo "==> Done. Hard-refresh the browser (Cmd/Ctrl+Shift+R) to clear cache."
