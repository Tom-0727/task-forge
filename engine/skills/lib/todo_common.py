#!/usr/bin/env python3
"""todo_common.py — shared helpers for the todo skill scripts.

Hosts three patterns:
  * sequential id allocation with a prefix (s<n> for scheduled tasks,
    t<n> for todos)
  * atomic write-to-tempfile + os.replace
  * defensive load of a JSON-list storage file
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

_ID_RE_CACHE: dict[str, re.Pattern[str]] = {}


def _id_pattern(prefix: str) -> re.Pattern[str]:
    pat = _ID_RE_CACHE.get(prefix)
    if pat is None:
        pat = re.compile(rf"^{re.escape(prefix)}(\d+)$")
        _ID_RE_CACHE[prefix] = pat
    return pat


def allocate_next_id(items: list[dict], prefix: str) -> str:
    """Return the next <prefix><n> id, where n = 1 + max existing n (0 if none)."""
    pattern = _id_pattern(prefix)
    max_n = 0
    for item in items:
        raw = item.get("id", "")
        if not isinstance(raw, str):
            continue
        match = pattern.match(raw)
        if match:
            max_n = max(max_n, int(match.group(1)))
    return f"{prefix}{max_n + 1}"


def atomic_write_json(path: Path, payload) -> None:
    """Write payload as pretty JSON to path using tempfile + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    tmp.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, path)


def load_list_json(path: Path) -> list[dict]:
    """Load a JSON-list storage file. Missing file -> []. Raises SystemExit on malformed."""
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise SystemExit(
            f"{path} must hold a JSON list; got {type(data).__name__}"
        )
    return data
