from __future__ import annotations

import json
import subprocess
from pathlib import Path

from flask import Blueprint, jsonify, request

from registry import import_agent, register_agent, remove_agent

from ..config import DEPLOY_SCRIPT

bp = Blueprint("agent_provisioning", __name__)


@bp.route("/api/agents/create", methods=["POST"])
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

    feishu = body.get("feishu")
    if isinstance(feishu, dict):
        app_id = feishu.get("app_id", "").strip()
        app_secret = feishu.get("app_secret", "").strip()
        chat_id = feishu.get("chat_id", "").strip()
        if app_id and app_secret and chat_id:
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

    resolved_name = agent_name
    agent_name_file = workdir_path / "Runtime" / "agent_name"
    if agent_name_file.exists():
        resolved_name = agent_name_file.read_text(encoding="utf-8").strip()
    if not resolved_name:
        resolved_name = workdir_path.name

    work_schedule = body.get("work_schedule")
    if isinstance(work_schedule, dict) and work_schedule.get("windows"):
        schedule_file = workdir_path / "Runtime" / "work_schedule.json"
        schedule_file.write_text(
            json.dumps(work_schedule, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

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


@bp.route("/api/agents/import", methods=["POST"])
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


@bp.route("/api/agents/<name>/remove", methods=["POST"])
def api_agent_remove(name: str):
    if remove_agent(name):
        return jsonify({"ok": True})
    return jsonify({"error": "agent not found"}), 404
