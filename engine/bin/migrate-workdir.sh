#!/bin/bash
# engine/bin/migrate-workdir.sh — convert a legacy agent workdir into a shim over engine/.
# Dry-run by default. Pass --apply to actually mutate the workdir.
set -euo pipefail

AGENT_DIR=""
APPLY="0"
REFRESH_SUBAGENTS_ONLY="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-dir) AGENT_DIR="$2"; shift 2 ;;
    --apply)     APPLY="1"; shift ;;
    --refresh-subagents-only) REFRESH_SUBAGENTS_ONLY="1"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$AGENT_DIR" ] || { echo "missing --agent-dir" >&2; exit 1; }
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENGINE_ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$ENGINE_ROOT/.." && pwd)"

exec python3 "$REPO_ROOT/engine/bin/_migrate_workdir.py" \
  --agent-dir "$AGENT_DIR" \
  --engine-root "$ENGINE_ROOT" \
  --repo-root "$REPO_ROOT" \
  $([ "$APPLY" = "1" ] && echo --apply) \
  $([ "$REFRESH_SUBAGENTS_ONLY" = "1" ] && echo --refresh-subagents-only)
