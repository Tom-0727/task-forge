#!/usr/bin/env python3
"""pre_heartbeat.py — scan Scheduled Tasks and publish due reminders for this minute.

Reads scheduled_tasks.json, writes Runtime/due_reminders.json with ids due
at the given minute, and appends to Runtime/scheduled_delivered.json.
`--now YYYY-MM-DDTHH:MM` is optional (tests inject it; production omits).
"""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import sys
from datetime import datetime

from agent_dir import resolve_agent_dir
from todo_common import atomic_write_json, load_list_json

_WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def _parse_now(value: str | None) -> datetime:
    if value is None:
        return datetime.now().replace(second=0, microsecond=0)
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except ValueError as exc:
        raise SystemExit(
            f"--now must be YYYY-MM-DDTHH:MM (24-hour, zero-padded); got '{value}': {exc}"
        ) from exc


def _weekday_token(dt: datetime) -> str:
    return _WEEKDAYS[dt.weekday()]


def _is_due(task: dict, now_dt: datetime) -> bool:
    ra = task.get("reminder_at") or {}
    if ra.get("time") != now_dt.strftime("%H:%M"):
        return False
    kind = ra.get("kind")
    if kind == "weekly":
        return _weekday_token(now_dt) in (ra.get("weekdays") or [])
    if kind == "date":
        return ra.get("date") == now_dt.strftime("%Y-%m-%d")
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish due reminders for this minute.")
    parser.add_argument("--agent-workdir", default=None)
    parser.add_argument("--now", default=None, dest="now_str")
    args = parser.parse_args(argv)

    now_dt = _parse_now(args.now_str)
    now_minute_str = now_dt.strftime("%Y-%m-%dT%H:%M")

    agent_workdir = resolve_agent_dir(args.agent_workdir)
    tasks = load_list_json(agent_workdir / "scheduled_tasks.json")

    due_ids = [task["id"] for task in tasks if _is_due(task, now_dt)]

    runtime_dir = agent_workdir / "Runtime"
    atomic_write_json(runtime_dir / "due_reminders.json", due_ids)

    delivered_path = runtime_dir / "scheduled_delivered.json"
    delivered = load_list_json(delivered_path)
    delivered_set = set(delivered)
    new_tokens = [
        token
        for token in (f"{task_id}@{now_minute_str}" for task_id in due_ids)
        if token not in delivered_set
    ]
    if new_tokens:
        delivered.extend(new_tokens)
        atomic_write_json(delivered_path, delivered)

    print(f"due={len(due_ids)} new_delivered={len(new_tokens)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
