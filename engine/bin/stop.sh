#!/bin/bash
# engine/bin/stop.sh — stop supervisor + bridge + web-ui for one agent.
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

PIDS_DIR="$AGENT_DIR/Runtime/pids"

stop_one() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 0
  local pid; pid="$(cat "$pidfile")"
  [ -n "$pid" ] || { rm -f "$pidfile"; return 0; }
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

if [ -d "$PIDS_DIR" ]; then
  for name in supervisor runtime bridge web-ui; do
    stop_one "$PIDS_DIR/$name"
  done
fi

rm -f "$AGENT_DIR/Runtime/pid"
echo "stopped" > "$AGENT_DIR/Runtime/state"
echo "[stop.sh] stopped $AGENT_DIR"
