#!/usr/bin/env python3
"""Resolve the agent workdir for skill scripts.

Priority: --agent-workdir CLI arg > AGENT_DIR env var > Path.cwd().
All scripts are invoked from the agent workdir (SDK sets cwd), so the
cwd fallback is the normal path — env/arg exist for explicit overrides.
"""

from __future__ import annotations

import os
from pathlib import Path


def resolve_agent_dir(arg_value: str | None = None) -> Path:
    if arg_value:
        return Path(arg_value).resolve()
    env = os.environ.get("AGENT_DIR")
    if env:
        return Path(env).resolve()
    return Path.cwd().resolve()


def read_agent_name(agent_dir: Path) -> str:
    """Read agent name from Runtime/agent.json (schema_version: 1)."""
    import json

    agent_json = agent_dir / "Runtime" / "agent.json"
    if agent_json.exists():
        try:
            data = json.loads(agent_json.read_text(encoding="utf-8"))
            name = data.get("agent_name")
            if isinstance(name, str) and name:
                return name
        except (json.JSONDecodeError, OSError):
            pass
    return agent_dir.name
