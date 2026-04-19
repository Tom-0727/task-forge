#!/usr/bin/env python3
"""list_scheduled.py — print the Scheduled Task list from scheduled_tasks.json."""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import json
import sys

from agent_dir import resolve_agent_dir
from todo_common import load_list_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print the Scheduled Task list as JSON.")
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args(argv)

    agent_workdir = resolve_agent_dir(args.agent_workdir)
    store_path = agent_workdir / "scheduled_tasks.json"
    items = load_list_json(store_path)
    print(json.dumps(items, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
