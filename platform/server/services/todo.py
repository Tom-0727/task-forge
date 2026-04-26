from __future__ import annotations

import re
from datetime import date as date_cls, datetime
from pathlib import Path

from .json_store import load_json_list

TODO_ID_RE = re.compile(r"^t\d+$")
SCHEDULED_ID_RE = re.compile(r"^s\d+$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")
WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def next_prefixed_id(items: list[dict], prefix: str) -> str:
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    max_n = 0
    for item in items:
        raw = item.get("id", "") if isinstance(item, dict) else ""
        if not isinstance(raw, str):
            continue
        match = pattern.match(raw)
        if match:
            max_n = max(max_n, int(match.group(1)))
    return f"{prefix}{max_n + 1}"


def parse_todo_date(raw: str | None) -> date_cls:
    if not raw:
        return datetime.now().date()
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("date must be YYYY-MM-DD") from exc


def todo_day_file(workdir: Path, day: date_cls) -> Path:
    return workdir / "todo_list" / day.strftime("%Y%m") / f"{day.strftime('%d')}.json"


def validate_clock_time(raw: object) -> str:
    if not isinstance(raw, str) or not TIME_RE.match(raw):
        raise ValueError("time must be HH:MM")
    try:
        datetime.strptime(raw, "%H:%M")
    except ValueError as exc:
        raise ValueError("time must be a valid 24-hour HH:MM value") from exc
    return raw


def normalize_todo_subtasks(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("subtasks must be an array")
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each subtask must be an object")
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        out.append({"id": len(out) + 1, "text": text, "done": bool(item.get("done", False))})
    return out


def normalize_scheduled_subtasks(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("subtasks must be an array")
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each subtask must be an object")
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        out.append({"id": len(out) + 1, "text": text})
    return out


def normalize_todos(raw: object, existing: list[dict]) -> list[dict]:
    if not isinstance(raw, list):
        raise ValueError("todos must be an array")
    used: set[str] = set()
    id_source = list(existing)
    out: list[dict] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"todos[{index}] must be an object")
        title = str(item.get("title", "")).strip()
        if not title:
            raise ValueError(f"todos[{index}].title is required")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not TODO_ID_RE.match(item_id) or item_id in used:
            while True:
                item_id = next_prefixed_id(id_source, "t")
                id_source.append({"id": item_id})
                if item_id not in used:
                    break
        used.add(item_id)
        out.append({
            "id": item_id,
            "title": title,
            "description": str(item.get("description", "")),
            "subtasks": normalize_todo_subtasks(item.get("subtasks", [])),
            "done": bool(item.get("done", False)),
        })
    return out


def normalize_reminder_at(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("reminder_at must be an object")
    kind = raw.get("kind")
    clock_time = validate_clock_time(raw.get("time"))
    if kind == "weekly":
        weekdays = raw.get("weekdays")
        if not isinstance(weekdays, list) or not weekdays:
            raise ValueError("weekly reminder_at.weekdays must be a non-empty array")
        normalized = []
        for token in weekdays:
            if not isinstance(token, str) or token.upper() not in WEEKDAYS:
                raise ValueError("weekdays must use MON,TUE,WED,THU,FRI,SAT,SUN")
            normalized.append(token.upper())
        return {"kind": "weekly", "time": clock_time, "weekdays": sorted(set(normalized), key=WEEKDAYS.index)}
    if kind == "date":
        raw_date = raw.get("date")
        if not isinstance(raw_date, str):
            raise ValueError("date reminder_at.date is required")
        parse_todo_date(raw_date)
        return {"kind": "date", "time": clock_time, "date": raw_date}
    raise ValueError("reminder_at.kind must be weekly or date")


def normalize_scheduled_tasks(raw: object, existing: list[dict]) -> list[dict]:
    if not isinstance(raw, list):
        raise ValueError("scheduled_tasks must be an array")
    used: set[str] = set()
    id_source = list(existing)
    out: list[dict] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"scheduled_tasks[{index}] must be an object")
        title = str(item.get("title", "")).strip()
        if not title:
            raise ValueError(f"scheduled_tasks[{index}].title is required")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not SCHEDULED_ID_RE.match(item_id) or item_id in used:
            while True:
                item_id = next_prefixed_id(id_source, "s")
                id_source.append({"id": item_id})
                if item_id not in used:
                    break
        used.add(item_id)
        out.append({
            "id": item_id,
            "title": title,
            "description": str(item.get("description", "")),
            "subtasks": normalize_scheduled_subtasks(item.get("subtasks", [])),
            "reminder_at": normalize_reminder_at(item.get("reminder_at")),
        })
    return out


def read_todo_payload(workdir: Path, raw_date: str | None = None) -> dict:
    day = parse_todo_date(raw_date)
    todo_file = todo_day_file(workdir, day)
    scheduled_file = workdir / "scheduled_tasks.json"
    due_file = workdir / "Runtime" / "due_reminders.json"
    return {
        "date": day.isoformat(),
        "todos": load_json_list(todo_file),
        "scheduled_tasks": load_json_list(scheduled_file),
        "due_reminders": load_json_list(due_file),
    }
