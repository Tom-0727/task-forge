#!/usr/bin/env bash
set -euo pipefail

WORKDIR="${1:-/home/ubuntu/agents/long-run-agent-harness}"
SESSION="${2:-codex_status_capture}"
OUTFILE="${3:-${TMPDIR:-/tmp}/codex-status-tmux.txt}"
STARTUP_WAIT="${STARTUP_WAIT:-6}"
STATUS_WAIT="${STATUS_WAIT:-3}"

cleanup() {
  tmux kill-session -t "${SESSION}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

mkdir -p "$(dirname "${OUTFILE}")"
tmux kill-session -t "${SESSION}" >/dev/null 2>&1 || true
tmux new-session -d -s "${SESSION}" "cd '${WORKDIR}' && TERM=xterm-256color codex"

sleep "${STARTUP_WAIT}"

# First Enter sometimes only settles the prompt after slash-command input,
# so probe once and resend Enter if /status is still sitting in the composer.
tmux send-keys -t "${SESSION}" "/status" Enter
sleep "${STATUS_WAIT}"

snapshot="$(tmux capture-pane -pt "${SESSION}")"
if printf '%s\n' "${snapshot}" | grep -q '^› /status$'; then
  tmux send-keys -t "${SESSION}" Enter
  sleep 2
  snapshot="$(tmux capture-pane -pt "${SESSION}")"
fi

printf '%s\n' "${snapshot}" | tee "${OUTFILE}"
