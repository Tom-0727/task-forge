"""Agent Registry — JSON file backed agent metadata store.

Storage: ~/.agent-platform/registry.json
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REGISTRY_DIR = Path.home() / ".agent-platform"
REGISTRY_FILE = REGISTRY_DIR / "registry.json"


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load() -> dict[str, Any]:
    if not REGISTRY_FILE.exists():
        return {"agents": {}}
    try:
        data = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"agents": {}}
    if not isinstance(data, dict) or "agents" not in data:
        return {"agents": {}}
    return data


def _save(data: dict[str, Any]) -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def list_agents() -> dict[str, dict]:
    return _load()["agents"]


def get_agent(name: str) -> dict | None:
    return _load()["agents"].get(name)


def register_agent(
    name: str,
    workdir: str,
    provider: str,
    goal: str = "",
    interval: int = 20,
    tags: list[str] | None = None,
    interaction: str = "platform",
    work_schedule: dict | None = None,
) -> dict:
    data = _load()
    entry = {
        "name": name,
        "workdir": workdir,
        "provider": provider,
        "interaction": interaction,
        "created_at": _utcnow(),
        "goal": goal,
        "interval": interval,
        "tags": tags or [],
        "work_schedule": work_schedule,
    }
    data["agents"][name] = entry
    _save(data)
    return entry


def update_agent(name: str, updates: dict) -> dict | None:
    data = _load()
    if name not in data["agents"]:
        return None
    data["agents"][name].update(updates)
    _save(data)
    return data["agents"][name]


def remove_agent(name: str) -> bool:
    data = _load()
    if name not in data["agents"]:
        return False
    del data["agents"][name]
    _save(data)
    return True


def import_agent(workdir: str, tags: list[str] | None = None) -> dict | None:
    """Import an existing agent by reading its Runtime/ directory."""
    workdir_path = Path(workdir).expanduser().resolve()
    runtime_dir = workdir_path / "Runtime"

    if not runtime_dir.exists():
        return None

    # Read agent name
    agent_name_file = runtime_dir / "agent_name"
    if agent_name_file.exists():
        name = agent_name_file.read_text(encoding="utf-8").strip()
    else:
        name = workdir_path.name

    # Read provider
    provider_file = runtime_dir / "runtime_provider"
    if provider_file.exists():
        provider = provider_file.read_text(encoding="utf-8").strip()
    else:
        provider = "unknown"

    # Read interaction mode
    interaction_file = runtime_dir / "interaction_mode"
    if interaction_file.exists():
        interaction = interaction_file.read_text(encoding="utf-8").strip()
    else:
        interaction = "unknown"

    # Read goal from runtime metadata
    goal = ""
    goal_file = runtime_dir / "goal"
    if goal_file.exists():
        try:
            goal = goal_file.read_text(encoding="utf-8").strip()
        except OSError:
            goal = ""

    return register_agent(
        name=name,
        workdir=str(workdir_path),
        provider=provider,
        goal=goal,
        tags=tags or ["imported"],
        interaction=interaction,
    )


def read_agent_status(workdir: str) -> dict:
    """Read real-time status from an agent's Runtime/ directory."""
    workdir_path = Path(workdir)
    runtime_dir = workdir_path / "Runtime"

    def _read(path: Path) -> str:
        if not path.exists():
            return ""
        try:
            return path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def _format_ts(value: str) -> str:
        if not value:
            return "none"
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt.astimezone().strftime("%Y-%m-%d %H:%M")
        except Exception:
            return value.replace("T", " ").replace("Z", "").strip()

    # PID check
    runner_pid = _read(runtime_dir / "pid")
    runner_alive = False
    if runner_pid:
        try:
            os.kill(int(runner_pid), 0)
            runner_alive = True
        except (OSError, ValueError):
            pass

    # State
    state = _read(runtime_dir / "state") or "unknown"
    if state == "running" and not runner_alive:
        state = "stale"

    # Last mailbox message (check human.jsonl first, fall back to MAILBOX.jsonl for migration)
    last_message = ""
    mailbox_file = workdir_path / "mailbox" / "human.jsonl"
    if not mailbox_file.exists():
        mailbox_file = workdir_path / "mailbox" / "MAILBOX.jsonl"
    if mailbox_file.exists():
        lines = mailbox_file.read_text(encoding="utf-8").strip().splitlines()
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                last_message = str(msg.get("message", ""))[:80]
                break
            except json.JSONDecodeError:
                continue

    # Check awaiting state
    awaiting_reply_dir = runtime_dir / "awaiting_reply"
    has_awaiting = awaiting_reply_dir.is_dir() and any(awaiting_reply_dir.iterdir()) if awaiting_reply_dir.is_dir() else False
    # Backward compat
    if not has_awaiting:
        has_awaiting = (runtime_dir / "awaiting_human").exists()

    return {
        "state": state,
        "runner_pid": int(runner_pid) if runner_pid.isdigit() else None,
        "runner_alive": runner_alive,
        "last_heartbeat": _format_ts(_read(runtime_dir / "last_heartbeat")),
        "awaiting_human": has_awaiting,
        "last_message": last_message,
    }


