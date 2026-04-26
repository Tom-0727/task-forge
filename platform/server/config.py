from __future__ import annotations

import os
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = HARNESS_DIR / "deploy-agent"
ENGINE_START_SCRIPT = HARNESS_DIR / "engine" / "bin" / "start.sh"
ENGINE_STOP_SCRIPT = HARNESS_DIR / "engine" / "bin" / "stop.sh"
PLATFORM_DIR = HARNESS_DIR / "platform"
PLATFORM_ENV_FILE = PLATFORM_DIR / ".env"
STATIC_DIR = PLATFORM_DIR / "static"

AUTH_REALM = "Agent Platform"


def load_local_env(path: Path = PLATFORM_ENV_FILE) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and (
            (value[0] == value[-1] == "'") or (value[0] == value[-1] == '"')
        ):
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_local_env()
PLATFORM_PASSWORD = os.environ.get("PLATFORM_PASSWORD", "")
