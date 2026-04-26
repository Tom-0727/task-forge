from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..common import resolve_agent
from ..services.events import publish_event
from ..services.json_store import atomic_write_json, load_json_list
from ..services.todo import (
    normalize_scheduled_tasks,
    normalize_todos,
    parse_todo_date,
    read_todo_payload,
    todo_day_file,
)

bp = Blueprint("todo", __name__)


@bp.route("/api/agents/<name>/todo", methods=["GET"])
def api_agent_todo_get(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    try:
        payload = read_todo_payload(workdir, request.args.get("date", "", type=str))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(payload)


@bp.route("/api/agents/<name>/todo", methods=["POST"])
def api_agent_todo_set(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    try:
        day = parse_todo_date(str(body.get("date", "")))
        todo_file = todo_day_file(workdir, day)
        existing = load_json_list(todo_file)
        todos = normalize_todos(body.get("todos"), existing)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    atomic_write_json(todo_file, todos)
    publish_event({"type": "dirty", "scope": "agent", "name": name})
    return jsonify({"ok": True, "date": day.isoformat(), "todos": todos})


@bp.route("/api/agents/<name>/todo/scheduled", methods=["POST"])
def api_agent_todo_scheduled_set(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    scheduled_file = workdir / "scheduled_tasks.json"
    existing = load_json_list(scheduled_file)
    try:
        scheduled_tasks = normalize_scheduled_tasks(body.get("scheduled_tasks"), existing)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    atomic_write_json(scheduled_file, scheduled_tasks)
    publish_event({"type": "dirty", "scope": "agent", "name": name})
    return jsonify({"ok": True, "scheduled_tasks": scheduled_tasks})
