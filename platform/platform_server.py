#!/usr/bin/env python3
"""Agent Platform Server — centralized monitoring and management for all agents."""

from __future__ import annotations

import json
import os
import queue
import secrets
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

from registry import (
    get_agent,
    import_agent,
    list_agents,
    read_agent_status,
    register_agent,
    remove_agent,
    update_agent,
)
from usage import get_usage, start_refresher as start_usage_refresher

HARNESS_DIR = Path(__file__).resolve().parent.parent
DEPLOY_SCRIPT = HARNESS_DIR / "deploy-agent"
ENGINE_START_SCRIPT = HARNESS_DIR / "engine" / "bin" / "start.sh"
ENGINE_STOP_SCRIPT = HARNESS_DIR / "engine" / "bin" / "stop.sh"
PLATFORM_DIR = Path(__file__).resolve().parent
PLATFORM_ENV_FILE = PLATFORM_DIR / ".env"

app = Flask(__name__, static_folder="static")


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_local_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and (
            (value[0] == value[-1] == "'") or (value[0] == value[-1] == '"')
        ):
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_local_env(PLATFORM_ENV_FILE)
PLATFORM_PASSWORD = os.environ.get("PLATFORM_PASSWORD", "")
AUTH_REALM = "Agent Platform"


def _is_authenticated() -> bool:
    auth = request.authorization
    if not auth or auth.type.lower() != "basic":
        return False
    submitted_password = auth.password or ""
    return secrets.compare_digest(submitted_password, PLATFORM_PASSWORD)


def _auth_required_response() -> Response:
    return Response(
        "Unauthorized",
        401,
        {"WWW-Authenticate": f'Basic realm="{AUTH_REALM}"'},
    )


@app.before_request
def _require_auth():
    if _is_authenticated():
        return None
    return _auth_required_response()


# ── Mailbox helpers (inline, no dependency on agent's mailbox_io.py) ──────

def _read_mailbox(mailbox_path: Path) -> list[dict]:
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


def _format_ts(value: str) -> str:
    if not value:
        return "none"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value.replace("T", " ").replace("Z", "").strip()


def _next_message_id(lines: list[str]) -> str:
    import fcntl  # noqa: F811

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
        elif isinstance(existing_id, str) and existing_id.startswith("mail."):
            break
    return f"{prefix}{seq:03d}"


def _append_message(mailbox_path: Path, from_id: str, to_id: str, task_id: str, message: str) -> dict:
    import fcntl

    mailbox_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = _utcnow()

    with mailbox_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        handle.seek(0)
        lines = handle.read().splitlines()

        entry = {
            "id": _next_message_id(lines),
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


def _write_pending_message(runtime_dir: Path, contact: str, entry: dict, source: str = "platform") -> None:
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


def _load_contacts(workdir: Path) -> dict:
    contacts_path = workdir / "mailbox" / "contacts.json"
    if not contacts_path.exists():
        return {}
    try:
        return json.loads(contacts_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_contacts(workdir: Path, contacts: dict) -> None:
    contacts_path = workdir / "mailbox" / "contacts.json"
    contacts_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = contacts_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(contacts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.rename(contacts_path)


def _tail_file(path: Path, limit: int) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")[-limit:]
    except OSError:
        return ""


def _resolve_agent(name: str):
    """Return (agent_info, workdir_path) or (None, None)."""
    info = get_agent(name)
    if not info:
        return None, None
    workdir = Path(info["workdir"])
    if not workdir.exists():
        return info, None
    return info, workdir


# ── Aggregate helpers ────────────────────────────────────────────────────

_OVERVIEW_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="overview")


def _load_agent_snapshot(name: str, info: dict) -> dict:
    """Read status + contacts for one agent. Called in a worker thread."""
    workdir_str = info.get("workdir", "")
    workdir = Path(workdir_str) if workdir_str else None
    status = read_agent_status(workdir_str) if workdir and workdir.exists() else {}
    contacts_list: list[dict] = []
    if workdir and workdir.exists():
        raw = _load_contacts(workdir)
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


def _build_overview() -> dict:
    """Aggregate dashboard payload: agents + connections + usage."""
    agents_map = list_agents()
    items = list(agents_map.items())

    snapshots = list(_OVERVIEW_POOL.map(
        lambda pair: _load_agent_snapshot(pair[0], pair[1]),
        items,
    ))

    # Derive deduped agent-to-agent connections.
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
        "revision": _events_revision(),
    }


def _read_history(workdir: Path, contact: str, limit: int, since_id: str = "") -> list[dict]:
    contacts = _load_contacts(workdir)
    contact_info = contacts.get(contact)
    if not contact_info:
        return []
    mailbox_path = workdir / "mailbox" / contact_info["mailbox_file"]
    messages = _read_mailbox(mailbox_path)

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
            "ts": _format_ts(str(msg.get("ts", ""))),
            "from": str(msg.get("from", msg.get("role", ""))),
            "to": str(msg.get("to", "")),
            "task_id": str(msg.get("task_id", "")),
            "message": str(msg.get("message", "")),
        })
    return rendered


# ── Event bus (SSE) ──────────────────────────────────────────────────────

_EVENT_POLL_INTERVAL = 0.5  # seconds
_event_subscribers_lock = threading.Lock()
_event_subscribers: list[queue.Queue] = []
_event_revision_lock = threading.Lock()
_event_revision = 0
_event_watcher_started = False
_event_watcher_started_lock = threading.Lock()


def _events_revision() -> int:
    with _event_revision_lock:
        return _event_revision


def _bump_revision() -> int:
    global _event_revision
    with _event_revision_lock:
        _event_revision += 1
        return _event_revision


def _publish_event(event: dict) -> None:
    rev = _bump_revision()
    event = {**event, "revision": rev}
    with _event_subscribers_lock:
        dead: list[queue.Queue] = []
        for q in _event_subscribers:
            try:
                q.put_nowait(event)
            except queue.Full:
                dead.append(q)
        for q in dead:
            try:
                _event_subscribers.remove(q)
            except ValueError:
                pass


def _subscribe_events() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=128)
    with _event_subscribers_lock:
        _event_subscribers.append(q)
    return q


def _unsubscribe_events(q: queue.Queue) -> None:
    with _event_subscribers_lock:
        try:
            _event_subscribers.remove(q)
        except ValueError:
            pass


def _scan_watch_targets() -> dict[str, dict]:
    """Return {agent_name: {status: mtime, mailboxes: {file: mtime}}}."""
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


def _diff_targets(prev: dict, curr: dict) -> tuple[set[str], bool]:
    """Return (changed_agent_names, roster_changed)."""
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


def _event_watcher_loop() -> None:
    prev = _scan_watch_targets()
    while True:
        time.sleep(_EVENT_POLL_INTERVAL)
        try:
            curr = _scan_watch_targets()
        except Exception:
            continue
        changed, roster_changed = _diff_targets(prev, curr)
        if roster_changed:
            _publish_event({"type": "dirty", "scope": "overview"})
        for name in changed:
            _publish_event({"type": "dirty", "scope": "agent", "name": name})
        if changed and not roster_changed:
            _publish_event({"type": "dirty", "scope": "overview"})
        prev = curr


def _start_event_watcher() -> None:
    global _event_watcher_started
    with _event_watcher_started_lock:
        if _event_watcher_started:
            return
        _event_watcher_started = True
    thread = threading.Thread(target=_event_watcher_loop, name="event-watcher", daemon=True)
    thread.start()


# ── Frontend ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ── API: Agent list ───────────────────────────────────────────────────────

@app.route("/api/agents")
def api_agents():
    agents = list_agents()
    result = []
    for name, info in agents.items():
        workdir = info.get("workdir", "")
        status = read_agent_status(workdir) if workdir and Path(workdir).exists() else {}
        result.append({**info, "status": status})
    return jsonify({"agents": result})


# ── API: Single agent status ─────────────────────────────────────────────

@app.route("/api/agents/<name>/status")
def api_agent_status(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404
    status = read_agent_status(str(workdir))
    return jsonify({**info, "status": status})


# ── API: Mailbox history ─────────────────────────────────────────────────

@app.route("/api/agents/<name>/history")
def api_agent_history(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    limit = request.args.get("limit", 50, type=int)
    contact = request.args.get("contact", "human")

    contacts = _load_contacts(workdir)
    contact_info = contacts.get(contact)
    if not contact_info:
        return jsonify({"messages": []})

    mailbox_path = workdir / "mailbox" / contact_info["mailbox_file"]
    messages = _read_mailbox(mailbox_path)

    rendered = []
    for msg in messages[-limit:]:
        rendered.append({
            "id": str(msg.get("id", "")),
            "ts": _format_ts(str(msg.get("ts", ""))),
            "from": str(msg.get("from", msg.get("role", ""))),
            "to": str(msg.get("to", "")),
            "task_id": str(msg.get("task_id", "")),
            "message": str(msg.get("message", "")),
        })
    return jsonify({"messages": rendered})


# ── API: Send message ────────────────────────────────────────────────────

@app.route("/api/agents/<name>/send", methods=["POST"])
def api_agent_send(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    message = body.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    mailbox_path = workdir / "mailbox" / "human.jsonl"
    entry = _append_message(mailbox_path, "human", name, "task.platform.message", message)

    _write_pending_message(workdir / "Runtime", "human", entry)

    return jsonify({"ok": True, "entry": entry})


# ── API: Set interval ────────────────────────────────────────────────────

@app.route("/api/agents/<name>/interval", methods=["POST"])
def api_agent_interval(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    interval = body.get("interval")
    if not isinstance(interval, int) or interval < 1:
        return jsonify({"error": "interval must be a positive integer (minutes)"}), 400

    # Write to Runtime/interval so the runner picks it up next cycle
    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "interval").write_text(str(interval))

    # Also update registry
    update_agent(name, {"interval": interval})

    return jsonify({"ok": True, "interval": interval})


# ── API: Compact interval ────────────────────────────────────────────

@app.route("/api/agents/<name>/compact-interval", methods=["GET"])
def api_agent_compact_interval_get(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    override_file = workdir / "Runtime" / "compact_interval"
    identity_file = workdir / "Runtime" / "agent.json"

    default = 0
    if identity_file.exists():
        try:
            ident = json.loads(identity_file.read_text(encoding="utf-8"))
            default = int(ident.get("runtime", {}).get("default_compact_every_n_heartbeats", 0))
        except (json.JSONDecodeError, OSError, TypeError, ValueError):
            default = 0

    override: int | None = None
    if override_file.exists():
        try:
            override = int(override_file.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            override = None

    effective = override if override is not None else default
    return jsonify({"default": default, "override": override, "effective": effective})


@app.route("/api/agents/<name>/compact-interval", methods=["POST"])
def api_agent_compact_interval_set(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    value = body.get("interval")
    if value is None:
        # clear override — revert to identity default
        override_file = workdir / "Runtime" / "compact_interval"
        override_file.unlink(missing_ok=True)
        return jsonify({"ok": True, "override": None})

    if not isinstance(value, int) or value < 0:
        return jsonify({"error": "interval must be a non-negative integer (0 disables)"}), 400

    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "compact_interval").write_text(str(value))
    return jsonify({"ok": True, "override": value})


# ── API: Passive mode ───────────────────────────────────────────────

@app.route("/api/agents/<name>/passive", methods=["POST"])
def api_agent_passive(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    enabled = body.get("enabled", False)

    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    passive_file = runtime_dir / "passive_mode"

    if enabled:
        passive_file.write_text("1")
    else:
        passive_file.unlink(missing_ok=True)

    return jsonify({"ok": True, "passive_mode": enabled})


# ── API: Work schedule ──────────────────────────────────────────────

@app.route("/api/agents/<name>/schedule", methods=["GET"])
def api_agent_schedule_get(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    schedule_file = workdir / "Runtime" / "work_schedule.json"
    if not schedule_file.exists():
        return jsonify({"schedule": None})

    try:
        schedule = json.loads(schedule_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return jsonify({"schedule": None})

    return jsonify({"schedule": schedule})


@app.route("/api/agents/<name>/schedule", methods=["POST"])
def api_agent_schedule_set(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    schedule = body.get("schedule")

    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    schedule_file = runtime_dir / "work_schedule.json"

    # schedule=null means clear (24/7 mode)
    if schedule is None:
        schedule_file.unlink(missing_ok=True)
        update_agent(name, {"work_schedule": None})
        return jsonify({"ok": True, "schedule": None})

    if not isinstance(schedule, dict):
        return jsonify({"error": "schedule must be an object or null"}), 400

    windows = schedule.get("windows")
    if not isinstance(windows, list) or len(windows) == 0:
        return jsonify({"error": "schedule.windows must be a non-empty array"}), 400

    for i, w in enumerate(windows):
        if not isinstance(w, dict):
            return jsonify({"error": f"windows[{i}] must be an object"}), 400
        if not isinstance(w.get("days"), list) or not w["days"]:
            return jsonify({"error": f"windows[{i}].days must be a non-empty array of integers"}), 400
        for d in w["days"]:
            if not isinstance(d, int) or d < 1 or d > 7:
                return jsonify({"error": f"windows[{i}].days values must be integers 1-7"}), 400
        if not isinstance(w.get("start"), str) or not isinstance(w.get("end"), str):
            return jsonify({"error": f"windows[{i}].start and .end must be HH:MM strings"}), 400

    schedule_file.write_text(
        json.dumps(schedule, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    update_agent(name, {"work_schedule": schedule})

    return jsonify({"ok": True, "schedule": schedule})


# ── API: Start (restart a stopped agent) ─────────────────────────────────

@app.route("/api/agents/<name>/start", methods=["POST"])
def api_agent_start(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    if not ENGINE_START_SCRIPT.exists():
        return jsonify({"error": "engine start.sh not found"}), 500
    if not ENGINE_STOP_SCRIPT.exists():
        return jsonify({"error": "engine stop.sh not found"}), 500

    status = read_agent_status(str(workdir))
    if status.get("runner_alive"):
        return jsonify({"ok": True, "already_running": True})

    stop_result = subprocess.run(
        [str(ENGINE_STOP_SCRIPT), "--agent-dir", str(workdir)],
        cwd=str(HARNESS_DIR),
        capture_output=True,
        text=True,
        timeout=45,
    )
    if stop_result.returncode != 0:
        return jsonify({
            "error": "pre-start stop failed",
            "stdout": stop_result.stdout[-500:] if stop_result.stdout else "",
            "stderr": stop_result.stderr[-500:] if stop_result.stderr else "",
        }), 500

    log_file = workdir / "Runtime" / "logs" / "start.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        proc = subprocess.Popen(
            [str(ENGINE_START_SCRIPT), "--agent-dir", str(workdir)],
            cwd=str(HARNESS_DIR),
            stdout=handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    time.sleep(0.5)
    if proc.poll() is not None:
        return jsonify({
            "error": "start failed",
            "returncode": proc.returncode,
            "stdout": _tail_file(log_file, 800),
        }), 500

    return jsonify({"ok": True, "pid": proc.pid, "stdout": _tail_file(log_file, 300)})


# ── API: Stop ────────────────────────────────────────────────────────────

@app.route("/api/agents/<name>/stop", methods=["POST"])
def api_agent_stop(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    if not ENGINE_STOP_SCRIPT.exists():
        return jsonify({"error": "engine stop.sh not found"}), 500
    result = subprocess.run(
        [str(ENGINE_STOP_SCRIPT), "--agent-dir", str(workdir)],
        cwd=str(HARNESS_DIR),
        capture_output=True,
        text=True,
        timeout=45,
    )
    return jsonify({
        "ok": result.returncode == 0,
        "stdout": result.stdout[-500:] if result.stdout else "",
        "stderr": result.stderr[-500:] if result.stderr else "",
    })


# ── API: Delete agent (registry + workdir) ───────────────────────────────

@app.route("/api/agents/<name>/delete", methods=["POST"])
def api_agent_delete(name: str):
    import shutil

    info = get_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404

    workdir = Path(info["workdir"])

    # Stop the agent first if running
    if ENGINE_STOP_SCRIPT.exists():
        subprocess.run(
            [str(ENGINE_STOP_SCRIPT), "--agent-dir", str(workdir)],
            cwd=str(HARNESS_DIR),
            capture_output=True,
            timeout=45,
        )

    # Remove workdir
    if workdir.exists():
        shutil.rmtree(str(workdir))

    # Remove from registry
    remove_agent(name)

    return jsonify({"ok": True})


# ── API: Create agent ────────────────────────────────────────────────────

@app.route("/api/agents/create", methods=["POST"])
def api_agents_create():
    body = request.get_json(silent=True) or {}

    goal = body.get("goal", "").strip()
    first_instruction = body.get("first_instruction", "").strip()
    provider = body.get("provider", "").strip()
    workdir = body.get("workdir", "").strip()
    interval = body.get("interval", 20)
    tags = body.get("tags", [])
    agent_name = body.get("agent_name", "").strip()

    if not goal:
        return jsonify({"error": "goal is required"}), 400
    if not first_instruction:
        return jsonify({"error": "first_instruction is required"}), 400
    if provider not in ("claude", "codex"):
        return jsonify({"error": "provider must be claude or codex"}), 400
    if not workdir:
        return jsonify({"error": "workdir is required"}), 400

    workdir_path = Path(workdir).expanduser().resolve()

    # Build deploy-agent command
    cmd = [
        str(DEPLOY_SCRIPT),
        "--goal", goal,
        "--first-instruction", first_instruction,
        "--provider", provider,
        "--interaction", "platform",
        "--interval", str(interval),
        "--workdir", str(workdir_path),
    ]
    if agent_name:
        cmd.extend(["--agent-name", agent_name])

    # Feishu config (optional)
    feishu = body.get("feishu")
    if isinstance(feishu, dict):
        app_id = feishu.get("app_id", "").strip()
        app_secret = feishu.get("app_secret", "").strip()
        chat_id = feishu.get("chat_id", "").strip()
        if app_id and app_secret and chat_id:
            cmd[cmd.index("--interaction") + 1] = "platform"
            cmd.extend([
                "--feishu-app-id", app_id,
                "--feishu-app-secret", app_secret,
                "--feishu-chat-id", chat_id,
            ])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            start_new_session=True,
        )
        if result.returncode != 0:
            return jsonify({
                "error": "deploy-agent failed",
                "stderr": result.stderr[-500:] if result.stderr else "",
                "stdout": result.stdout[-500:] if result.stdout else "",
            }), 500
    except subprocess.TimeoutExpired:
        return jsonify({"error": "deploy-agent timed out"}), 500

    # Resolve actual agent name from Runtime/
    resolved_name = agent_name
    agent_name_file = workdir_path / "Runtime" / "agent_name"
    if agent_name_file.exists():
        resolved_name = agent_name_file.read_text(encoding="utf-8").strip()
    if not resolved_name:
        resolved_name = workdir_path.name

    # Write work_schedule if provided
    work_schedule = body.get("work_schedule")
    if isinstance(work_schedule, dict) and work_schedule.get("windows"):
        schedule_file = workdir_path / "Runtime" / "work_schedule.json"
        schedule_file.write_text(
            json.dumps(work_schedule, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    # Register in platform registry
    entry = register_agent(
        name=resolved_name,
        workdir=str(workdir_path),
        provider=provider,
        goal=goal,
        interval=interval,
        tags=tags,
        interaction="platform",
        work_schedule=work_schedule if isinstance(work_schedule, dict) else None,
    )

    return jsonify({"ok": True, "agent": entry})


# ── API: Import existing agent ───────────────────────────────────────────

@app.route("/api/agents/import", methods=["POST"])
def api_agents_import():
    body = request.get_json(silent=True) or {}
    workdir = body.get("workdir", "").strip()
    tags = body.get("tags", [])

    if not workdir:
        return jsonify({"error": "workdir is required"}), 400

    workdir_path = Path(workdir).expanduser().resolve()
    if not workdir_path.exists():
        return jsonify({"error": "workdir does not exist"}), 404

    entry = import_agent(str(workdir_path), tags=tags)
    if not entry:
        return jsonify({"error": "no Runtime/ directory found in workdir"}), 400

    return jsonify({"ok": True, "agent": entry})


# ── API: Remove agent from registry ─────────────────────────────────────

@app.route("/api/agents/<name>/remove", methods=["POST"])
def api_agent_remove(name: str):
    if remove_agent(name):
        return jsonify({"ok": True})
    return jsonify({"error": "agent not found"}), 404


# ── API: Mailbox contacts ────────────────────────────────────────────────

@app.route("/api/agents/<name>/contacts")
def api_agent_contacts(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    contacts = _load_contacts(workdir)
    result = []
    for cname, cinfo in contacts.items():
        result.append({
            "name": cname,
            "type": cinfo.get("type", "unknown"),
            "connected_at": cinfo.get("connected_at", ""),
        })
    return jsonify({"contacts": result})


# ── API: Mailbox connect/disconnect ─────────────────────────────────────

@app.route("/api/mailbox/connect", methods=["POST"])
def api_mailbox_connect():
    body = request.get_json(silent=True) or {}
    name_a = body.get("agent_a", "").strip()
    name_b = body.get("agent_b", "").strip()

    if not name_a or not name_b:
        return jsonify({"error": "agent_a and agent_b are required"}), 400
    if name_a == name_b:
        return jsonify({"error": "cannot connect an agent to itself"}), 400

    info_a, workdir_a = _resolve_agent(name_a)
    info_b, workdir_b = _resolve_agent(name_b)

    if not info_a or not workdir_a:
        return jsonify({"error": f"agent '{name_a}' not found or workdir missing"}), 404
    if not info_b or not workdir_b:
        return jsonify({"error": f"agent '{name_b}' not found or workdir missing"}), 404

    now = _utcnow()

    # Update A's contacts with B
    contacts_a = _load_contacts(workdir_a)
    if name_b not in contacts_a:
        contacts_a[name_b] = {
            "type": "agent",
            "mailbox_file": f"agent.{name_b}.jsonl",
            "remote_workdir": str(workdir_b),
            "connected_at": now,
        }
        _save_contacts(workdir_a, contacts_a)
        # Create empty mailbox file
        mailbox_a = workdir_a / "mailbox" / f"agent.{name_b}.jsonl"
        if not mailbox_a.exists():
            mailbox_a.parent.mkdir(parents=True, exist_ok=True)
            mailbox_a.touch()

    # Update B's contacts with A
    contacts_b = _load_contacts(workdir_b)
    if name_a not in contacts_b:
        contacts_b[name_a] = {
            "type": "agent",
            "mailbox_file": f"agent.{name_a}.jsonl",
            "remote_workdir": str(workdir_a),
            "connected_at": now,
        }
        _save_contacts(workdir_b, contacts_b)
        mailbox_b = workdir_b / "mailbox" / f"agent.{name_a}.jsonl"
        if not mailbox_b.exists():
            mailbox_b.parent.mkdir(parents=True, exist_ok=True)
            mailbox_b.touch()

    return jsonify({"ok": True})


@app.route("/api/mailbox/disconnect", methods=["POST"])
def api_mailbox_disconnect():
    body = request.get_json(silent=True) or {}
    name_a = body.get("agent_a", "").strip()
    name_b = body.get("agent_b", "").strip()

    if not name_a or not name_b:
        return jsonify({"error": "agent_a and agent_b are required"}), 400

    info_a, workdir_a = _resolve_agent(name_a)
    info_b, workdir_b = _resolve_agent(name_b)

    if workdir_a:
        contacts_a = _load_contacts(workdir_a)
        contacts_a.pop(name_b, None)
        _save_contacts(workdir_a, contacts_a)

    if workdir_b:
        contacts_b = _load_contacts(workdir_b)
        contacts_b.pop(name_a, None)
        _save_contacts(workdir_b, contacts_b)

    return jsonify({"ok": True})


# ── API: Aggregate overview (dashboard single-shot) ─────────────────────

@app.route("/api/overview")
def api_overview():
    return jsonify(_build_overview())


# ── API: Aggregate detail (single-shot agent page) ──────────────────────

@app.route("/api/agents/<name>/detail")
def api_agent_detail(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    limit = request.args.get("limit", 50, type=int)
    contact = request.args.get("contact", "human")
    since_id = request.args.get("since_id", "", type=str)

    status = read_agent_status(str(workdir))
    contacts_raw = _load_contacts(workdir)
    contacts_list = [
        {
            "name": cname,
            "type": cinfo.get("type", "unknown"),
            "connected_at": cinfo.get("connected_at", ""),
        }
        for cname, cinfo in contacts_raw.items()
    ]

    messages = _read_history(workdir, contact, limit, since_id)

    schedule_file = workdir / "Runtime" / "work_schedule.json"
    schedule: dict | None = None
    if schedule_file.exists():
        try:
            schedule = json.loads(schedule_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            schedule = None

    passive_mode = (workdir / "Runtime" / "passive_mode").exists()

    return jsonify({
        **info,
        "status": status,
        "contacts": contacts_list,
        "messages": messages,
        "schedule": schedule,
        "passive_mode": passive_mode,
        "history_contact": contact,
        "revision": _events_revision(),
    })


# ── API: SSE event stream ────────────────────────────────────────────────

@app.route("/api/events")
def api_events():
    def generate():
        q = _subscribe_events()
        try:
            # Greeting event so the client sees the connection is live.
            yield f"event: hello\ndata: {json.dumps({'revision': _events_revision()})}\n\n"
            while True:
                try:
                    event = q.get(timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except queue.Empty:
                    # Heartbeat comment keeps proxies from closing the stream.
                    yield ": keepalive\n\n"
        finally:
            _unsubscribe_events(q)

    response = Response(stream_with_context(generate()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


# ── API: LLM usage (Claude + Codex) ─────────────────────────────────────

@app.route("/api/usage")
def api_usage():
    return jsonify(get_usage())


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    import argparse

    if not PLATFORM_PASSWORD:
        print(
            f"PLATFORM_PASSWORD is not set. Configure it in {PLATFORM_ENV_FILE}.",
            file=sys.stderr,
        )
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Agent Platform Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=9000, help="Bind port (default: 9000)")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    args = parser.parse_args()

    print(f"Agent Platform starting on http://{args.host}:{args.port}")
    start_usage_refresher()
    _start_event_watcher()
    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)


if __name__ == "__main__":
    main()
