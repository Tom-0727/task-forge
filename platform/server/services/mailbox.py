from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from ..common import format_ts, utcnow


def read_mailbox(mailbox_path: Path) -> list[dict]:
    if not mailbox_path.exists():
        return []
    messages = []
    for line in mailbox_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            if isinstance(data, dict):
                messages.append(data)
        except json.JSONDecodeError:
            continue
    return messages


def next_message_id(lines: list[str]) -> str:
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
        existing_id = data.get("id", "")
        if isinstance(existing_id, str) and existing_id.startswith(prefix):
            seq = int(existing_id.rsplit(".", 1)[-1]) + 1
            break
        if isinstance(existing_id, str) and existing_id.startswith("mail."):
            break
    return f"{prefix}{seq:03d}"


def append_message(mailbox_path: Path, from_id: str, to_id: str, task_id: str, message: str) -> dict:
    import fcntl

    mailbox_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = utcnow()

    with mailbox_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        handle.seek(0)
        lines = handle.read().splitlines()

        entry = {
            "id": next_message_id(lines),
            "ts": timestamp,
            "from": from_id,
            "to": to_id,
            "task_id": task_id,
            "message": message.strip(),
        }

        handle.seek(0, os.SEEK_END)
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    return entry


def write_pending_message(runtime_dir: Path, contact: str, entry: dict, source: str = "platform") -> None:
    pending_dir = runtime_dir / "pending_messages"
    pending_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "mailbox_id": entry["id"],
        "ts": entry["ts"],
        "source": source,
    }
    (pending_dir / f"{contact}.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_contacts(workdir: Path) -> dict:
    contacts_path = workdir / "mailbox" / "contacts.json"
    if not contacts_path.exists():
        return {}
    try:
        return json.loads(contacts_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_contacts(workdir: Path, contacts: dict) -> None:
    contacts_path = workdir / "mailbox" / "contacts.json"
    contacts_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = contacts_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(contacts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.rename(contacts_path)


def read_history(workdir: Path, contact: str, limit: int, since_id: str = "") -> list[dict]:
    contacts = load_contacts(workdir)
    contact_info = contacts.get(contact)
    if not contact_info:
        return []
    mailbox_path = workdir / "mailbox" / contact_info["mailbox_file"]
    messages = read_mailbox(mailbox_path)

    if since_id:
        cut = -1
        for idx, msg in enumerate(messages):
            if str(msg.get("id", "")) == since_id:
                cut = idx
                break
        if cut >= 0:
            messages = messages[cut + 1:]

    rendered: list[dict] = []
    for msg in messages[-limit:]:
        rendered.append({
            "id": str(msg.get("id", "")),
            "ts": format_ts(str(msg.get("ts", ""))),
            "from": str(msg.get("from", msg.get("role", ""))),
            "to": str(msg.get("to", "")),
            "task_id": str(msg.get("task_id", "")),
            "message": str(msg.get("message", "")),
        })
    return rendered
