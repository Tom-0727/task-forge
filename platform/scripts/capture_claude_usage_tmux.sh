#!/usr/bin/env bash
set -euo pipefail

WORKDIR="${1:-/home/ubuntu/agents/long-run-agent-harness}"
SESSION="${2:-claude_usage_capture}"
OUTFILE="${3:-${TMPDIR:-/tmp}/claude-usage-tmux.txt}"
STARTUP_WAIT="${STARTUP_WAIT:-6}"
STATUS_WAIT="${STATUS_WAIT:-2}"

cleanup() {
  tmux kill-session -t "${SESSION}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

mkdir -p "$(dirname "${OUTFILE}")"
tmux kill-session -t "${SESSION}" >/dev/null 2>&1 || true
tmux new-session -d -s "${SESSION}" "cd '${WORKDIR}' && TERM=xterm-256color claude"

sleep "${STARTUP_WAIT}"
tmux send-keys -t "${SESSION}" "/status" Enter
sleep "${STATUS_WAIT}"

for _ in 1 2 3 4; do
  snapshot="$(tmux capture-pane -pt "${SESSION}")"
  if printf '%s\n' "${snapshot}" | grep -q "Current session"; then
    break
  fi
  tmux send-keys -t "${SESSION}" Right
  sleep 1
done

tmux capture-pane -pt "${SESSION}" | tee "${OUTFILE}"
