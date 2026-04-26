from __future__ import annotations

import queue
import threading
import time
from pathlib import Path

from registry import list_agents

EVENT_POLL_INTERVAL = 0.5

_subscribers_lock = threading.Lock()
_subscribers: list[queue.Queue] = []
_revision_lock = threading.Lock()
_revision = 0
_watcher_started = False
_watcher_started_lock = threading.Lock()


def events_revision() -> int:
    with _revision_lock:
        return _revision


def bump_revision() -> int:
    global _revision
    with _revision_lock:
        _revision += 1
        return _revision


def publish_event(event: dict) -> None:
    rev = bump_revision()
    event = {**event, "revision": rev}
    with _subscribers_lock:
        dead: list[queue.Queue] = []
        for q in _subscribers:
            try:
                q.put_nowait(event)
            except queue.Full:
                dead.append(q)
        for q in dead:
            try:
                _subscribers.remove(q)
            except ValueError:
                pass


def subscribe_events() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=128)
    with _subscribers_lock:
        _subscribers.append(q)
    return q


def unsubscribe_events(q: queue.Queue) -> None:
    with _subscribers_lock:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


def scan_watch_targets() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name, info in list_agents().items():
        workdir_str = info.get("workdir", "")
        if not workdir_str:
            continue
        workdir = Path(workdir_str)
        if not workdir.exists():
            continue
        runtime_dir = workdir / "Runtime"
        entry: dict = {"state": 0.0, "heartbeat": 0.0, "pid": 0.0, "mailboxes": {}}
        for key, rel in (("state", "state"), ("heartbeat", "last_heartbeat"), ("pid", "pid")):
            p = runtime_dir / rel
            try:
                entry[key] = p.stat().st_mtime if p.exists() else 0.0
            except OSError:
                entry[key] = 0.0
        mailbox_dir = workdir / "mailbox"
        if mailbox_dir.exists():
            try:
                for f in mailbox_dir.iterdir():
                    if f.suffix == ".jsonl":
                        try:
                            entry["mailboxes"][f.name] = f.stat().st_mtime
                        except OSError:
                            pass
            except OSError:
                pass
        out[name] = entry
    return out


def diff_targets(prev: dict, curr: dict) -> tuple[set[str], bool]:
    changed: set[str] = set()
    roster_changed = set(prev.keys()) != set(curr.keys())
    for name, snap in curr.items():
        old = prev.get(name)
        if old is None:
            changed.add(name)
            continue
        if (
            old.get("state") != snap.get("state")
            or old.get("heartbeat") != snap.get("heartbeat")
            or old.get("pid") != snap.get("pid")
            or old.get("mailboxes") != snap.get("mailboxes")
        ):
            changed.add(name)
    for name in prev.keys():
        if name not in curr:
            changed.add(name)
    return changed, roster_changed


def event_watcher_loop() -> None:
    prev = scan_watch_targets()
    while True:
        time.sleep(EVENT_POLL_INTERVAL)
        try:
            curr = scan_watch_targets()
        except Exception:
            continue
        changed, roster_changed = diff_targets(prev, curr)
        if roster_changed:
            publish_event({"type": "dirty", "scope": "overview"})
        for name in changed:
            publish_event({"type": "dirty", "scope": "agent", "name": name})
        if changed and not roster_changed:
            publish_event({"type": "dirty", "scope": "overview"})
        prev = curr


def start_event_watcher() -> None:
    global _watcher_started
    with _watcher_started_lock:
        if _watcher_started:
            return
        _watcher_started = True
    thread = threading.Thread(target=event_watcher_loop, name="event-watcher", daemon=True)
    thread.start()
