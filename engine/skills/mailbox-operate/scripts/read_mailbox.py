#!/usr/bin/env python3
"""Read mailbox messages for agent consumption, supporting per-contact reading."""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import json
from pathlib import Path

from agent_dir import resolve_agent_dir
from mailbox_io import count_unread, load_contacts, messages_after_id, read_messages


def load_last_read_id(agent_dir: Path, contact: str) -> str | None:
    state_path = agent_dir / "Runtime" / "mailbox_read_last_id" / contact
    if not state_path.exists():
        return None
    value = state_path.read_text(encoding="utf-8").strip()
    return value or None


def save_last_read_id(agent_dir: Path, contact: str, mailbox_id: str) -> None:
    state_dir = agent_dir / "Runtime" / "mailbox_read_last_id"
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / contact).write_text(f"{mailbox_id}\n", encoding="utf-8")


def contact_key(contact_name: str) -> str:
    return contact_name if contact_name == "human" else f"agent.{contact_name}"


def do_summary(agent_dir: Path, contacts: dict) -> None:
    result = []
    for name, info in contacts.items():
        key = contact_key(name)
        mailbox_path = agent_dir / "mailbox" / info["mailbox_file"]
        last_id = load_last_read_id(agent_dir, key)
        n = count_unread(mailbox_path, last_id)
        if n > 0:
            result.append({"contact": name, "unread": n})
    print(json.dumps(result, ensure_ascii=False))


def do_read(agent_dir: Path, contact_name: str, contact_info: dict, count: int | None) -> None:
    key = contact_key(contact_name)
    mailbox_path = agent_dir / "mailbox" / contact_info["mailbox_file"]

    if count is not None:
        all_msgs = read_messages(mailbox_path)
        output = all_msgs[-count:]
    else:
        last_read_id = load_last_read_id(agent_dir, key)
        output = messages_after_id(mailbox_path, last_read_id)

    if output:
        last_id = output[-1].get("id")
        if isinstance(last_id, str) and last_id:
            save_last_read_id(agent_dir, key, last_id)

    print(json.dumps(output, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read mailbox messages. Without --from, reads human messages. With --summary, shows unread counts per contact."
    )
    parser.add_argument("--from", dest="from_contact", default="human")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("count", nargs="?", type=int)
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args()

    if args.count is not None and args.count <= 0:
        raise SystemExit("count must be a positive integer")

    agent_dir = resolve_agent_dir(args.agent_workdir)
    contacts = load_contacts(agent_dir / "mailbox" / "contacts.json")

    if args.summary:
        do_summary(agent_dir, contacts)
        return

    if args.from_contact not in contacts:
        raise SystemExit(f"contact '{args.from_contact}' not found in contacts.json")

    do_read(agent_dir, args.from_contact, contacts[args.from_contact], args.count)


if __name__ == "__main__":
    main()
