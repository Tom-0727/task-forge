#!/usr/bin/env python3
"""Agent Platform Server — centralized monitoring and management for all agents."""

from __future__ import annotations

import json
import os
import secrets
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

from registry import (
    get_agent,
    import_agent,
    list_agents,
    read_agent_status,
    read_ratelimit,
    register_agent,
    remove_agent,
    update_agent,
)

HARNESS_DIR = Path(__file__).resolve().parent.parent
BOOTSTRAP_SCRIPT = HARNESS_DIR / "bootstrap-runtime"
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


def _append_message(mailbox_path: Path, role: str, task_id: str, message: str) -> dict:
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
            "role": role,
            "task_id": task_id,
            "message": message.strip(),
        }

        handle.seek(0, os.SEEK_END)
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    return entry


def _write_pending_human(runtime_dir: Path, entry: dict) -> None:
    runtime_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "mailbox_id": entry["id"],
        "ts": entry["ts"],
        "source": "platform",
    }
    (runtime_dir / "pending_human.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _resolve_agent(name: str):
    """Return (agent_info, workdir_path) or (None, None)."""
    info = get_agent(name)
    if not info:
        return None, None
    workdir = Path(info["workdir"])
    if not workdir.exists():
        return info, None
    return info, workdir


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
    mailbox_path = workdir / "mailbox" / "MAILBOX.jsonl"
    messages = _read_mailbox(mailbox_path)

    rendered = []
    for msg in messages[-limit:]:
        rendered.append({
            "id": str(msg.get("id", "")),
            "ts": _format_ts(str(msg.get("ts", ""))),
            "role": str(msg.get("role", "")),
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

    mailbox_path = workdir / "mailbox" / "MAILBOX.jsonl"
    entry = _append_message(mailbox_path, "human", "task.platform.message", message)

    # Write pending_human.json to wake the agent
    _write_pending_human(workdir / "Runtime", entry)

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

    provider = info.get("provider", "")
    interval = info.get("interval", 20)

    # Read interval from Runtime/interval if available
    interval_file = workdir / "Runtime" / "interval"
    if interval_file.exists():
        try:
            interval = int(interval_file.read_text().strip())
        except (ValueError, OSError):
            pass

    start_script = workdir / f"start-{provider}.sh"
    if not start_script.exists():
        return jsonify({"error": f"start-{provider}.sh not found"}), 404

    # Determine if bridge should be skipped
    interaction = info.get("interaction", "")
    env = dict(os.environ)
    if interaction in ("web-ui", "platform"):
        has_feishu = (workdir / "mailbox_bridge.env").exists()
        if not has_feishu:
            env["TASK_FORGE_SKIP_BRIDGE"] = "1"

    result = subprocess.run(
        ["bash", str(start_script), "--interval", str(interval)],
        cwd=str(workdir),
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        start_new_session=True,
    )

    if result.returncode != 0:
        return jsonify({
            "error": "start failed",
            "stdout": result.stdout[-500:] if result.stdout else "",
            "stderr": result.stderr[-500:] if result.stderr else "",
        }), 500

    return jsonify({"ok": True, "stdout": result.stdout[-300:] if result.stdout else ""})


# ── API: Stop ────────────────────────────────────────────────────────────

@app.route("/api/agents/<name>/stop", methods=["POST"])
def api_agent_stop(name: str):
    info, workdir = _resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    stop_script = workdir / "stop-agent.sh"
    if stop_script.exists():
        result = subprocess.run(
            ["bash", str(stop_script)],
            cwd=str(workdir),
            capture_output=True,
            text=True,
            timeout=30,
        )
        return jsonify({
            "ok": result.returncode == 0,
            "stdout": result.stdout[-500:] if result.stdout else "",
            "stderr": result.stderr[-500:] if result.stderr else "",
        })
    return jsonify({"error": "stop-agent.sh not found"}), 404


# ── API: Delete agent (registry + workdir) ───────────────────────────────

@app.route("/api/agents/<name>/delete", methods=["POST"])
def api_agent_delete(name: str):
    import shutil

    info = get_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404

    workdir = Path(info["workdir"])

    # Stop the agent first if running
    stop_script = workdir / "stop-agent.sh"
    if stop_script.exists():
        subprocess.run(
            ["bash", str(stop_script)],
            cwd=str(workdir),
            capture_output=True,
            timeout=30,
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
    provider = body.get("provider", "").strip()
    workdir = body.get("workdir", "").strip()
    interval = body.get("interval", 20)
    tags = body.get("tags", [])
    agent_name = body.get("agent_name", "").strip()

    if not goal:
        return jsonify({"error": "goal is required"}), 400
    if provider not in ("claude", "codex"):
        return jsonify({"error": "provider must be claude or codex"}), 400
    if not workdir:
        return jsonify({"error": "workdir is required"}), 400

    workdir_path = Path(workdir).expanduser().resolve()

    # Build bootstrap-runtime command
    cmd = [
        str(BOOTSTRAP_SCRIPT),
        "--goal", goal,
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
                "error": "bootstrap-runtime failed",
                "stderr": result.stderr[-500:] if result.stderr else "",
                "stdout": result.stdout[-500:] if result.stdout else "",
            }), 500
    except subprocess.TimeoutExpired:
        return jsonify({"error": "bootstrap-runtime timed out"}), 500

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


# ── API: Rate limit ──────────────────────────────────────────────────────

@app.route("/api/ratelimit")
def api_ratelimit():
    agents = list_agents()
    latest_claude = None

    for name, info in agents.items():
        if info.get("provider") != "claude":
            continue
        workdir = info.get("workdir", "")
        if not workdir:
            continue
        rl = read_ratelimit(workdir)
        if not rl:
            continue
        if latest_claude is None or rl.get("ts", "") > latest_claude.get("last_updated", ""):
            latest_claude = {
                "status": rl.get("status"),
                "resets_at": rl.get("resets_at"),
                "rate_limit_type": rl.get("rate_limit_type"),
                "last_updated": rl.get("ts"),
                "source_agent": name,
            }

    result = {}
    if latest_claude:
        result["claude"] = latest_claude

    return jsonify(result)


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
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
