#!/usr/bin/env python3
"""_write_today.py — atomic-append helper for the todo skill.

Appends a new Todo to `<agent_workdir>/todo_list/<YYYYMM>/<DD>.json`.
Internal utility — agents that are planning their own work should prefer
direct Edit/Write on the day file.
"""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import sys
from datetime import date as _date, datetime
from pathlib import Path

from agent_dir import resolve_agent_dir
from todo_common import allocate_next_id, atomic_write_json, load_list_json


def _parse_date(value: str | None) -> _date:
    if value is None:
        return datetime.now().date()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"--date must be YYYY-MM-DD: {exc}") from exc


def _day_file(agent_workdir: Path, day: _date) -> Path:
    return agent_workdir / "todo_list" / day.strftime("%Y%m") / f"{day.strftime('%d')}.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Append a Todo to the correct day file (atomic).")
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--date", default=None)
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args(argv)

    agent_workdir = resolve_agent_dir(args.agent_workdir)
    day = _parse_date(args.date)
    path = _day_file(agent_workdir, day)

    todos = load_list_json(path)
    new_id = allocate_next_id(todos, "t")
    todos.append(
        {
            "id": new_id,
            "title": args.title,
            "description": args.description,
            "subtasks": [],
            "done": False,
        }
    )
    atomic_write_json(path, todos)

    print(new_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
