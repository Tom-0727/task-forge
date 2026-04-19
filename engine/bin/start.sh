#!/bin/bash
# engine/bin/start.sh — launch supervisor (+ optional bridge/web-ui) for one agent.
set -euo pipefail

AGENT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-dir) AGENT_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$AGENT_DIR" ] || { echo "missing --agent-dir" >&2; exit 1; }
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENGINE_ROOT="$(cd "$HERE/.." && pwd)"

"$HERE/engine-ensure.sh" || { echo "[start.sh] engine-ensure failed" >&2; exit 1; }

mkdir -p "$AGENT_DIR/Runtime/pids" "$AGENT_DIR/Runtime/logs"

read_identity() {
  node -e "
    const fs = require('fs');
    const id = JSON.parse(fs.readFileSync('$AGENT_DIR/Runtime/agent.json', 'utf8'));
    process.stdout.write(id.interaction.mode + '\t' + (id.interaction.web_ui_port || '') + '\t' + id.provider + '\n');
  "
}

IFS=$'\t' read -r INTERACTION WEB_UI_PORT PROVIDER < <(read_identity)

start_child() {
  local name="$1"; shift
  local logfile="$AGENT_DIR/Runtime/logs/$name.log"
  local pidfile="$AGENT_DIR/Runtime/pids/$name"
  nohup "$@" >> "$logfile" 2>&1 &
  echo $! > "$pidfile"
  echo "[start.sh] started $name pid=$(cat "$pidfile")"
}

CHILD_PIDS=()

if [ "$INTERACTION" = "feishu" ] && [ -f "$AGENT_DIR/mailbox_bridge.env" ]; then
  start_child bridge node "$ENGINE_ROOT/dist/bridge/feishu.js" --agent-dir "$AGENT_DIR"
  CHILD_PIDS+=("$(cat "$AGENT_DIR/Runtime/pids/bridge")")
fi

if [ "$INTERACTION" = "web-ui" ]; then
  start_child web-ui node "$ENGINE_ROOT/dist/web-ui/server.js" --agent-dir "$AGENT_DIR" --port "$WEB_UI_PORT"
  CHILD_PIDS+=("$(cat "$AGENT_DIR/Runtime/pids/web-ui")")
fi

cleanup() {
  echo "[start.sh] shutting down children"
  for pid in "${CHILD_PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

exec node "$ENGINE_ROOT/dist/supervisor/supervisor.js" --agent-dir "$AGENT_DIR"
