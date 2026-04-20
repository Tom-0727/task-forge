#!/bin/bash
# copy.sh — copy the basic-agent scaffold into <dest> and (by default) install+build.
# The scaffold source lives at engine/scaffolds/basic-agent/ and is shared read-only;
# this script always produces an independent, writable copy.
set -euo pipefail

DEST=""
NAME=""
DO_INSTALL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$DEST" ] || { echo "missing --dest" >&2; exit 1; }

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# scripts/ -> skill dir -> engine/skills -> engine
ENGINE_ROOT="$(cd "$HERE/../../.." && pwd)"
SCAFFOLD="$ENGINE_ROOT/scaffolds/basic-agent"
[ -d "$SCAFFOLD" ] || { echo "scaffold not found at $SCAFFOLD" >&2; exit 1; }

if [ -e "$DEST" ]; then
  echo "dest already exists: $DEST" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp -r "$SCAFFOLD" "$DEST"
echo "[build-an-agent] copied scaffold -> $DEST"

if [ -z "$NAME" ]; then
  NAME="$(basename "$DEST")"
fi
python3 - "$DEST/package.json" "$NAME" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    pkg = json.load(f)
pkg["name"] = name
with open(path, "w", encoding="utf-8") as f:
    json.dump(pkg, f, indent=2)
    f.write("\n")
PY
echo "[build-an-agent] set package.json name -> $NAME"

if [ "$DO_INSTALL" = "1" ]; then
  (cd "$DEST" && npm install && npm run build)
  echo "[build-an-agent] installed + built"
else
  echo "[build-an-agent] skipped install (--no-install)"
fi
