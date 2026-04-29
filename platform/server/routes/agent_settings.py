from __future__ import annotations

import json
import uuid

from flask import Blueprint, jsonify, request

from registry import read_agent_status, update_agent

from ..common import resolve_agent, utcnow
from ..services.events import publish_event

bp = Blueprint("agent_settings", __name__)


def write_json_atomic(path, payload: dict) -> None:
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


@bp.route("/api/agents/<name>/interval", methods=["POST"])
def api_agent_interval(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    interval = body.get("interval")
    if not isinstance(interval, int) or interval < 1:
        return jsonify({"error": "interval must be a positive integer (minutes)"}), 400

    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "interval").write_text(str(interval))
    update_agent(name, {"interval": interval})

    return jsonify({"ok": True, "interval": interval})


@bp.route("/api/agents/<name>/passive", methods=["POST"])
def api_agent_passive(name: str):
    info, workdir = resolve_agent(name)
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


@bp.route("/api/agents/<name>/compact", methods=["POST"])
def api_agent_compact(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404
    provider = info.get("provider")
    if provider not in {"codex", "claude"}:
        return jsonify({"error": "manual compact is only supported for codex or claude agents"}), 400

    status = read_agent_status(str(workdir))
    if not status.get("runtime_alive"):
        return jsonify({"error": "agent runtime is not running"}), 409

    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    request_file = runtime_dir / "compact_request.json"
    status_file = runtime_dir / "compact_status.json"

    if request_file.exists():
        try:
            existing = json.loads(request_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = {}
        return jsonify({"ok": True, "already_pending": True, "request": existing})

    now = utcnow()
    req = {
        "id": f"compact-{uuid.uuid4().hex}",
        "provider": provider,
        "requested_at": now,
        "requested_by": "platform",
    }
    status_payload = {
        "state": "pending",
        "request_id": req["id"],
        "provider": provider,
        "requested_at": now,
    }
    write_json_atomic(status_file, status_payload)
    write_json_atomic(request_file, req)
    publish_event({"type": "dirty", "scope": "agent", "name": name})

    return jsonify({"ok": True, "request": req, "status": status_payload})


@bp.route("/api/agents/<name>/schedule", methods=["GET"])
def api_agent_schedule_get(name: str):
    info, workdir = resolve_agent(name)
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


@bp.route("/api/agents/<name>/schedule", methods=["POST"])
def api_agent_schedule_set(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    schedule = body.get("schedule")

    runtime_dir = workdir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    schedule_file = runtime_dir / "work_schedule.json"

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
