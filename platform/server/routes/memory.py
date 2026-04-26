from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..common import format_mtime, resolve_agent
from ..services.memory import memory_index, resolve_memory_markdown

bp = Blueprint("memory", __name__)


@bp.route("/api/agents/<name>/memory/index")
def api_agent_memory_index(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    kind = request.args.get("kind", "knowledge", type=str)
    limit = request.args.get("limit", 20, type=int)
    date_filter = request.args.get("date", "", type=str)
    cursor_arg = request.args.get("cursor", "0", type=str)
    try:
        cursor = int(cursor_arg or "0")
    except ValueError:
        cursor = 0

    result = memory_index(workdir, kind, limit, cursor, date_filter)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@bp.route("/api/agents/<name>/memory/file")
def api_agent_memory_file(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    raw_path = request.args.get("path", "", type=str)
    target = resolve_memory_markdown(workdir, raw_path)
    if target is None:
        return jsonify({"error": "path must be a markdown file under Memory/"}), 400
    if not target.exists() or not target.is_file():
        return jsonify({"error": "file not found"}), 404

    try:
        content = target.read_text(encoding="utf-8")
    except OSError:
        return jsonify({"error": "failed to read file"}), 500
    return jsonify({
        "path": target.relative_to(workdir).as_posix(),
        "content": content,
        "last_modified": format_mtime(target),
    })
