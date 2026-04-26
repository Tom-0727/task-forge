from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

from flask import Blueprint, jsonify

from registry import get_agent, read_agent_status, remove_agent

from ..common import resolve_agent, tail_file
from ..config import ENGINE_START_SCRIPT, ENGINE_STOP_SCRIPT, HARNESS_DIR

bp = Blueprint("agent_lifecycle", __name__)


@bp.route("/api/agents/<name>/start", methods=["POST"])
def api_agent_start(name: str):
    info, workdir = resolve_agent(name)
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
            "stdout": tail_file(log_file, 800),
        }), 500

    return jsonify({"ok": True, "pid": proc.pid, "stdout": tail_file(log_file, 300)})


@bp.route("/api/agents/<name>/stop", methods=["POST"])
def api_agent_stop(name: str):
    info, workdir = resolve_agent(name)
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


@bp.route("/api/agents/<name>/delete", methods=["POST"])
def api_agent_delete(name: str):
    info = get_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404

    workdir = Path(info["workdir"])

    if ENGINE_STOP_SCRIPT.exists():
        subprocess.run(
            [str(ENGINE_STOP_SCRIPT), "--agent-dir", str(workdir)],
            cwd=str(HARNESS_DIR),
            capture_output=True,
            timeout=45,
        )

    if workdir.exists():
        shutil.rmtree(str(workdir))

    remove_agent(name)

    return jsonify({"ok": True})
