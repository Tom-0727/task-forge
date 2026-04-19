#!/usr/bin/env python3
"""List mailbox contacts for agent consumption."""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import json

from agent_dir import resolve_agent_dir
from mailbox_io import load_contacts


def main() -> None:
    parser = argparse.ArgumentParser(description="List mailbox contacts.")
    parser.add_argument("--agent-workdir", default=None)
    args = parser.parse_args()

    agent_dir = resolve_agent_dir(args.agent_workdir)
    contacts = load_contacts(agent_dir / "mailbox" / "contacts.json")
    result = []
    for name, info in contacts.items():
        result.append({
            "name": name,
            "type": info.get("type", "unknown"),
            "connected_at": info.get("connected_at", ""),
        })
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
