#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="${WALMART_REMINDERS_HOME:-$(dirname "$SCRIPT_DIR")}"

cd "$PROJECT_DIR"
mkdir -p var/logs var/walmart-profile
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
fi

NPM_BIN="${NPM_BIN:-/usr/local/bin/npm}"

"$NPM_BIN" run build
(cd apps/reminder-watcher-swift && swift build)
exec "$NPM_BIN" start
