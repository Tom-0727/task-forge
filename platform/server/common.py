from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from registry import get_agent


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_ts(value: str) -> str:
    if not value:
        return "none"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value.replace("T", " ").replace("Z", "").strip()


def tail_file(path: Path, limit: int) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")[-limit:]
    except OSError:
        return ""


def format_mtime(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except OSError:
        return ""


def resolve_agent(name: str):
    info = get_agent(name)
    if not info:
        return None, None
    workdir = Path(info["workdir"])
    if not workdir.exists():
        return info, None
    return info, workdir
