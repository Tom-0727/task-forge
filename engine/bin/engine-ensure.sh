#!/bin/bash
# engine-ensure.sh — idempotent: install deps + build dist if stale.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENGINE_ROOT="$(cd "$HERE/.." && pwd)"
LOCK="/tmp/harness-engine-ensure.lock"

exec 9>"$LOCK"
flock 9

cd "$ENGINE_ROOT"

need_install=0
if [ ! -d node_modules ]; then
  need_install=1
elif [ ! -f node_modules/.package-lock.json ]; then
  need_install=1
elif [ -f package-lock.json ] && [ package-lock.json -nt node_modules/.package-lock.json ]; then
  need_install=1
fi

if [ "$need_install" = "1" ]; then
  if [ -f package-lock.json ]; then
    echo "[engine-ensure] installing dependencies (npm ci)"
    npm ci
  else
    echo "[engine-ensure] installing dependencies (npm install, creating lockfile)"
    npm install
  fi
fi

need_build=0
if [ ! -d dist ]; then
  need_build=1
elif [ ! -f dist/.build-stamp ]; then
  need_build=1
else
  newest_src="$(find src -type f -name '*.ts' -newer dist/.build-stamp 2>/dev/null | head -n 1 || true)"
  if [ -n "$newest_src" ]; then
    need_build=1
  elif [ tsconfig.json -nt dist/.build-stamp ]; then
    need_build=1
  fi
fi

if [ "$need_build" = "1" ]; then
  echo "[engine-ensure] building (tsc -p .)"
  npx tsc -p .
  touch dist/.build-stamp
fi

exit 0
