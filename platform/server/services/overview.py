from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from registry import list_agents, read_agent_status
from usage import get_usage

from .events import events_revision
from .mailbox import load_contacts

_OVERVIEW_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="overview")


def load_agent_snapshot(name: str, info: dict) -> dict:
    workdir_str = info.get("workdir", "")
    workdir = Path(workdir_str) if workdir_str else None
    status = read_agent_status(workdir_str) if workdir and workdir.exists() else {}
    contacts_list: list[dict] = []
    if workdir and workdir.exists():
        raw = load_contacts(workdir)
        for cname, cinfo in raw.items():
            contacts_list.append({
                "name": cname,
                "type": cinfo.get("type", "unknown"),
                "connected_at": cinfo.get("connected_at", ""),
            })
    passive_mode = False
    if workdir and workdir.exists():
        passive_mode = (workdir / "Runtime" / "passive_mode").exists()

    return {
        **info,
        "status": status,
        "contacts": contacts_list,
        "passive_mode": passive_mode,
    }


def build_overview() -> dict:
    agents_map = list_agents()
    items = list(agents_map.items())

    snapshots = list(_OVERVIEW_POOL.map(
        lambda pair: load_agent_snapshot(pair[0], pair[1]),
        items,
    ))

    conn_map: dict[str, dict] = {}
    for snap in snapshots:
        owner = snap.get("name", "")
        for c in snap.get("contacts", []):
            if c.get("type") != "agent":
                continue
            other = c.get("name", "")
            if not owner or not other:
                continue
            a, b = sorted([owner, other])
            key = f"{a}<->{b}"
            if key not in conn_map:
                conn_map[key] = {"a": a, "b": b}

    return {
        "agents": snapshots,
        "connections": list(conn_map.values()),
        "usage": get_usage(),
        "revision": events_revision(),
    }
