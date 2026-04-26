from __future__ import annotations

import json
from pathlib import Path

from flask import Blueprint, jsonify, request

from registry import list_agents, read_agent_status

from ..common import resolve_agent
from ..services.events import events_revision
from ..services.mailbox import load_contacts, read_history
from ..services.metrics import read_agent_metrics

bp = Blueprint("agent_core", __name__)


@bp.route("/api/agents")
def api_agents():
    agents = list_agents()
    result = []
    for name, info in agents.items():
        workdir = info.get("workdir", "")
        status = read_agent_status(workdir) if workdir and Path(workdir).exists() else {}
        result.append({**info, "status": status})
    return jsonify({"agents": result})


@bp.route("/api/agents/<name>/status")
def api_agent_status(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404
    status = read_agent_status(str(workdir))
    return jsonify({**info, "status": status})


@bp.route("/api/agents/<name>/metrics")
def api_agent_metrics(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404
    return jsonify(read_agent_metrics(workdir))


@bp.route("/api/agents/<name>/detail")
def api_agent_detail(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    limit = request.args.get("limit", 50, type=int)
    contact = request.args.get("contact", "human")
    since_id = request.args.get("since_id", "", type=str)

    status = read_agent_status(str(workdir))
    contacts_raw = load_contacts(workdir)
    contacts_list = [
        {
            "name": cname,
            "type": cinfo.get("type", "unknown"),
            "connected_at": cinfo.get("connected_at", ""),
        }
        for cname, cinfo in contacts_raw.items()
    ]

    messages = read_history(workdir, contact, limit, since_id)

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
        "revision": events_revision(),
    })
