#!/usr/bin/env bash
# OPTIONAL HARDENING — NOT THE DEFAULT.
# Installs a systemd.timer + paired service unit for teams that want the
# stronger documented semantics (Persistent=true catch-up after host sleep,
# explicit env/cwd via systemd.exec). The default shipping path is cron via
# scripts/cron.example per human directive mail.20260419T093100Z.001.
# TODO(phase-2-impl): drop unit files into /etc/systemd/system, systemctl enable --now.
set -euo pipefail
echo "install-systemd-timer stub — optional hardening path, not the default." >&2
