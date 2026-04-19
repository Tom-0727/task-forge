#!/usr/bin/env python3
"""delete_scheduled.py — remove a Scheduled Task by id from scheduled_tasks.json."""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import sys

from agent_dir import resolve_agent_dir
from todo_common import atomic_write_json, load_list_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Delete a Scheduled Task by id.")
    parser.add_argument("--id", required=True, dest="task_id")
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args(argv)

    agent_workdir = resolve_agent_dir(args.agent_workdir)
    store_path = agent_workdir / "scheduled_tasks.json"

    items = load_list_json(store_path)
    remaining = [item for item in items if item.get("id") != args.task_id]
    if len(remaining) == len(items):
        print(f"no scheduled task with id {args.task_id}", file=sys.stderr)
        return 2

    atomic_write_json(store_path, remaining)
    print(args.task_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
