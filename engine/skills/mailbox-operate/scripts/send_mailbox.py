#!/usr/bin/env python3
"""Append an agent-authored message to mailbox, supporting inter-agent and human targets."""

from __future__ import annotations

import _bootstrap  # noqa: F401  -- puts engine/skills/lib on sys.path

import argparse
import json
import sys
from pathlib import Path

from agent_dir import read_agent_name, resolve_agent_dir
from mailbox_io import append_message, load_contacts, write_pending_message


def read_message(message_arg: str | None) -> str:
    if message_arg:
        return message_arg
    if not sys.stdin.isatty():
        return sys.stdin.read()
    raise SystemExit("provide --message or pipe the message via stdin")


def _write_with_retry(
    mailbox_path: Path,
    from_id: str,
    to_id: str,
    task_id: str,
    message: str,
    extra: dict,
    retries: int = 1,
) -> dict:
    for attempt in range(retries + 1):
        try:
            return append_message(mailbox_path, from_id, to_id, task_id, message, extra)
        except Exception:
            if attempt >= retries:
                raise


def send_to_contact(
    agent_dir: Path,
    agent_name: str,
    contact_name: str,
    contact_info: dict,
    message: str,
    task_id: str,
    kind: str,
    await_reply: bool,
) -> dict:
    extra = {"kind": kind, "await_reply": await_reply}

    local_mailbox = agent_dir / "mailbox" / contact_info["mailbox_file"]

    if contact_info["type"] == "agent":
        remote_workdir = Path(contact_info["remote_workdir"])
        remote_contacts = load_contacts(remote_workdir / "mailbox" / "contacts.json")
        my_contact = remote_contacts.get(agent_name)
        if not my_contact:
            raise SystemExit(f"remote agent '{contact_name}' does not have '{agent_name}' in contacts")
        remote_mailbox = remote_workdir / "mailbox" / my_contact["mailbox_file"]

        entry = _write_with_retry(
            remote_mailbox, agent_name, contact_name, task_id, message, extra
        )
        _write_with_retry(
            local_mailbox, agent_name, contact_name, task_id, message, extra
        )

        remote_runtime = remote_workdir / "Runtime"
        write_pending_message(remote_runtime, f"agent.{agent_name}", entry["id"], "agent")

    else:
        entry = _write_with_retry(
            local_mailbox, agent_name, contact_name, task_id, message, extra
        )

    if await_reply:
        awaiting_dir = agent_dir / "Runtime" / "awaiting_reply"
        awaiting_dir.mkdir(parents=True, exist_ok=True)
        contact_key = contact_name if contact_name == "human" else f"agent.{contact_name}"
        (awaiting_dir / contact_key).write_text(f"{entry['id']}\n", encoding="utf-8")

    return entry


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a mailbox message")
    parser.add_argument("--to", default="human")
    parser.add_argument("--broadcast", action="store_true")
    parser.add_argument("--task-id", default="task.agent.message")
    parser.add_argument("--kind", choices=["update", "question", "decision", "blocker"], default="update")
    parser.add_argument("--await-reply", action="store_true")
    parser.add_argument("--message")
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args()

    if args.broadcast and args.await_reply:
        raise SystemExit("--broadcast and --await-reply cannot be used together")

    agent_dir = resolve_agent_dir(args.agent_workdir)
    agent_name = read_agent_name(agent_dir)
    message = read_message(args.message)
    contacts = load_contacts(agent_dir / "mailbox" / "contacts.json")

    if args.broadcast:
        results = []
        for name, info in contacts.items():
            if info.get("type") != "agent":
                continue
            entry = send_to_contact(
                agent_dir, agent_name, name, info, message, args.task_id, args.kind, False
            )
            results.append({"to": name, "id": entry["id"], "ts": entry["ts"]})
        print(json.dumps(results, ensure_ascii=False))
    else:
        if args.to not in contacts:
            raise SystemExit(f"contact '{args.to}' not found in contacts.json")
        entry = send_to_contact(
            agent_dir, agent_name, args.to, contacts[args.to], message,
            args.task_id, args.kind, args.await_reply,
        )
        print(json.dumps({"id": entry["id"], "ts": entry["ts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
