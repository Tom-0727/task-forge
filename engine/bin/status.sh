#!/bin/bash
# engine/bin/status.sh — report runtime status for one agent.
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

RUNTIME="$AGENT_DIR/Runtime"

read_file() { [ -f "$1" ] && cat "$1" || echo "(none)"; }

echo "agent_dir:      $AGENT_DIR"
if [ -f "$RUNTIME/agent.json" ]; then
  node -e "
    const id = JSON.parse(require('fs').readFileSync('$RUNTIME/agent.json', 'utf8'));
    console.log('agent_name:     ' + id.agent_name);
    console.log('provider:       ' + id.provider);
    console.log('interaction:    ' + id.interaction.mode);
  "
fi
echo "state:          $(read_file "$RUNTIME/state")"
echo "last_heartbeat: $(read_file "$RUNTIME/last_heartbeat")"
echo "interval:       $(read_file "$RUNTIME/interval")"

for name in supervisor runtime bridge web-ui; do
  pidfile="$RUNTIME/pids/$name"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name: pid=$pid alive"
    else
      echo "$name: pid=$pid STALE"
    fi
  else
    echo "$name: not running"
  fi
done
