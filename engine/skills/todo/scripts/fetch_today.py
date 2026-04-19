#!/usr/bin/env python3
"""fetch_today.py — print the Todo list for a given day as JSON."""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import json
import sys
from datetime import date as _date, datetime
from pathlib import Path

from agent_dir import resolve_agent_dir
from todo_common import load_list_json


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
    parser = argparse.ArgumentParser(description="Print the Todo list for a given day as JSON.")
    parser.add_argument("--date", default=None)
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args(argv)

    agent_workdir = resolve_agent_dir(args.agent_workdir)
    day = _parse_date(args.date)
    path = _day_file(agent_workdir, day)

    todos = load_list_json(path)
    print(json.dumps(todos, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
