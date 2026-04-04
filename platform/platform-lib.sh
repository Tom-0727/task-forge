#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/Runtime"
PID_FILE="${RUNTIME_DIR}/platform.pid"
LOG_FILE="${RUNTIME_DIR}/platform.log"
ENV_FILE="${SCRIPT_DIR}/.env"
PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"
SERVER_SCRIPT="${SCRIPT_DIR}/platform_server.py"

PLATFORM_HOST="${PLATFORM_HOST:-127.0.0.1}"
PLATFORM_PORT="${PLATFORM_PORT:-9000}"

ensure_runtime_dir() {
  mkdir -p "${RUNTIME_DIR}"
}

load_platform_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Error: missing env file: ${ENV_FILE}" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  if [[ -z "${PLATFORM_PASSWORD:-}" ]]; then
    echo "Error: PLATFORM_PASSWORD is not set in ${ENV_FILE}" >&2
    exit 1
  fi
}

require_runtime_files() {
  if [[ ! -x "${PYTHON_BIN}" ]]; then
    echo "Error: missing python runtime: ${PYTHON_BIN}" >&2
    exit 1
  fi

  if [[ ! -f "${SERVER_SCRIPT}" ]]; then
    echo "Error: missing server script: ${SERVER_SCRIPT}" >&2
    exit 1
  fi
}

read_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    tr -d '[:space:]' < "${PID_FILE}"
  fi
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

is_platform_pid() {
  local pid="$1"
  local args

  if ! is_pid_running "${pid}"; then
    return 1
  fi

  args="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
  [[ "${args}" == *"${SERVER_SCRIPT}"* ]]
}

is_listening() {
  ss -ltn | awk '{print $4}' | grep -Fx "${PLATFORM_HOST}:${PLATFORM_PORT}" >/dev/null 2>&1
}

wait_for_listen() {
  local attempts=50
  local i

  for ((i = 1; i <= attempts; i++)); do
    if is_listening; then
      return 0
    fi
    sleep 0.2
  done

  return 1
}

wait_for_exit() {
  local pid="$1"
  local attempts=50
  local i

  for ((i = 1; i <= attempts; i++)); do
    if ! is_pid_running "${pid}"; then
      return 0
    fi
    sleep 0.2
  done

  return 1
}
