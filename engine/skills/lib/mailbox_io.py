#!/usr/bin/env python3
"""Shared helpers for append-only mailbox reads and writes."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import fcntl


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _valid_message_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    if not value.startswith("mail."):
        return None
    parts = value.split(".")
    if len(parts) != 3:
        return None
    if not parts[1].endswith("Z"):
        return None
    if not parts[2].isdigit():
        return None
    return value


def _next_message_id(lines: list[str], timestamp: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prefix = f"mail.{stamp}."
    seq = 1

    for raw_line in reversed(lines):
        line = raw_line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue

        existing_id = _valid_message_id(data.get("id"))
        if not existing_id or not existing_id.startswith(prefix):
            if existing_id:
                break
            continue

        seq = int(existing_id.rsplit(".", 1)[-1]) + 1
        break

    return f"{prefix}{seq:03d}"


def read_messages(mailbox_path: Path) -> list[dict]:
    if not mailbox_path.exists():
        return []

    messages: list[dict] = []
    for raw_line in mailbox_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            messages.append(data)
    return messages


def messages_after_id(
    mailbox_path: Path,
    last_id: str | None,
    sender: str | None = None,
) -> list[dict]:
    messages = read_messages(mailbox_path)
    if last_id is None:
        return [msg for msg in messages if sender is None or msg.get("from") == sender]

    pending: list[dict] = []
    found = False

    for message in messages:
        if not found:
            if message.get("id") == last_id:
                found = True
            continue
        if sender is None or message.get("from") == sender:
            pending.append(message)

    if found:
        return pending

    return [msg for msg in messages if sender is None or msg.get("from") == sender]


def mailbox_contains_field(mailbox_path: Path, field: str, expected_value: str) -> bool:
    for message in reversed(read_messages(mailbox_path)):
        if message.get(field) == expected_value:
            return True
    return False


def append_message(
    mailbox_path: Path,
    from_id: str,
    to_id: str,
    task_id: str,
    message: str,
    extra: dict | None = None,
) -> dict:
    mailbox_path.parent.mkdir(parents=True, exist_ok=True)

    clean_message = message.strip()
    if not clean_message:
        raise ValueError("message must not be empty")

    timestamp = utcnow()

    with mailbox_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        handle.seek(0)
        lines = handle.read().splitlines()

        entry = {
            "id": _next_message_id(lines, timestamp),
            "ts": timestamp,
            "from": from_id,
            "to": to_id,
            "task_id": task_id,
            "message": clean_message,
        }
        if extra:
            entry.update(extra)

        handle.seek(0, os.SEEK_END)
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    return entry


def load_contacts(contacts_path: Path) -> dict:
    if not contacts_path.exists():
        return {}
    try:
        return json.loads(contacts_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_contacts(contacts_path: Path, contacts: dict) -> None:
    contacts_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = contacts_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(contacts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.rename(contacts_path)


def write_pending_message(runtime_dir: Path, contact: str, mailbox_id: str, source: str) -> None:
    pending_dir = runtime_dir / "pending_messages"
    pending_dir.mkdir(parents=True, exist_ok=True)
    pending_file = pending_dir / f"{contact}.json"
    data = {"mailbox_id": mailbox_id, "ts": utcnow(), "source": source}
    pending_file.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")


def load_pending_messages(runtime_dir: Path) -> dict[str, dict]:
    pending_dir = runtime_dir / "pending_messages"
    if not pending_dir.is_dir():
        return {}
    result = {}
    for f in pending_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                contact = f.stem
                result[contact] = data
        except (json.JSONDecodeError, OSError):
            continue
    return result


def clear_pending_message(runtime_dir: Path, contact: str, expected_mailbox_id: str | None) -> None:
    if not expected_mailbox_id:
        return
    pending_file = runtime_dir / "pending_messages" / f"{contact}.json"
    if not pending_file.exists():
        return
    try:
        data = json.loads(pending_file.read_text(encoding="utf-8"))
        if data.get("mailbox_id") == expected_mailbox_id:
            pending_file.unlink(missing_ok=True)
    except (json.JSONDecodeError, OSError):
        pass


def count_unread(mailbox_path: Path, last_id: str | None) -> int:
    return len(messages_after_id(mailbox_path, last_id))
