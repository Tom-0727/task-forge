#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/platform-lib.sh"

start_platform() {
  ensure_runtime_dir
  load_platform_env
  require_runtime_files

  local existing_pid
  existing_pid="$(read_pid)"
  if [[ -n "${existing_pid}" ]]; then
    if is_platform_pid "${existing_pid}"; then
      echo "Platform already running (PID ${existing_pid})"
      return 0
    fi
    rm -f "${PID_FILE}"
  fi

  if is_listening; then
    echo "Error: ${PLATFORM_HOST}:${PLATFORM_PORT} is already in use" >&2
    return 1
  fi

  local start_cwd
  start_cwd="$(pwd)"
  cd "${SCRIPT_DIR}"
  nohup setsid "${PYTHON_BIN}" -m "${SERVER_MODULE}" --host "${PLATFORM_HOST}" --port "${PLATFORM_PORT}" </dev/null >>"${LOG_FILE}" 2>&1 &
  local pid="$!"
  cd "${start_cwd}"
  printf '%s\n' "${pid}" > "${PID_FILE}"
  disown "${pid}" 2>/dev/null || true

  if ! wait_for_listen || ! is_platform_pid "${pid}"; then
    echo "Error: platform failed to start. Check ${LOG_FILE}" >&2
    tail -n 20 "${LOG_FILE}" >&2 || true
    rm -f "${PID_FILE}"
    return 1
  fi

  echo "Platform started"
  echo "PID: ${pid}"
  echo "URL: http://${PLATFORM_HOST}:${PLATFORM_PORT}"
  echo "Log: ${LOG_FILE}"
}

stop_platform() {
  local pid
  pid="$(read_pid)"
  if [[ -z "${pid}" ]]; then
    echo "Platform already stopped"
    return 0
  fi

  if ! is_platform_pid "${pid}"; then
    echo "Error: PID file points to a non-platform process or stale PID: ${pid}" >&2
    return 1
  fi

  kill "${pid}"

  if ! wait_for_exit "${pid}"; then
    echo "Error: platform did not stop cleanly (PID ${pid})" >&2
    return 1
  fi

  rm -f "${PID_FILE}"

  echo "Platform stopped"
  echo "PID: ${pid}"
}

status_platform() {
  local pid
  pid="$(read_pid)"

  echo "Host: ${PLATFORM_HOST}"
  echo "Port: ${PLATFORM_PORT}"
  echo "PID file: ${PID_FILE}"
  echo "Log file: ${LOG_FILE}"

  if [[ -z "${pid}" ]]; then
    echo "Status: stopped"
    return 0
  fi

  if is_platform_pid "${pid}"; then
    echo "Status: running"
    echo "PID: ${pid}"
    return 0
  fi

  echo "Status: stale PID file"
  echo "PID: ${pid}"
  return 1
}

usage() {
  cat <<'EOF'
Usage:
  bash platform/platformctl.sh start
  bash platform/platformctl.sh stop
  bash platform/platformctl.sh restart
  bash platform/platformctl.sh status
EOF
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

case "$1" in
  start)
    start_platform
    ;;
  stop)
    stop_platform
    ;;
  restart)
    stop_platform
    start_platform
    ;;
  status)
    status_platform
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
