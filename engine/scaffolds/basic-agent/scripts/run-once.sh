#!/usr/bin/env bash
# Manual one-shot invocation wrapper.
# Usage: ./run-once.sh "<wake-up prompt>"
# Compiles TS if needed, then runs the compiled entry.
set -euo pipefail
cd "$(dirname "$0")/.."
npx --no-install tsc
node dist/entry/one-shot.js "$@"
