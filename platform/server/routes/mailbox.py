from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..common import resolve_agent, utcnow
from ..services.mailbox import (
    append_message,
    load_contacts,
    read_history,
    save_contacts,
    write_pending_message,
)

bp = Blueprint("mailbox", __name__)


@bp.route("/api/agents/<name>/history")
def api_agent_history(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    limit = request.args.get("limit", 50, type=int)
    contact = request.args.get("contact", "human")
    return jsonify({"messages": read_history(workdir, contact, limit)})


@bp.route("/api/agents/<name>/send", methods=["POST"])
def api_agent_send(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    body = request.get_json(silent=True) or {}
    message = body.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    mailbox_path = workdir / "mailbox" / "human.jsonl"
    entry = append_message(mailbox_path, "human", name, "task.platform.message", message)
    write_pending_message(workdir / "Runtime", "human", entry)

    return jsonify({"ok": True, "entry": entry})


@bp.route("/api/agents/<name>/contacts")
def api_agent_contacts(name: str):
    info, workdir = resolve_agent(name)
    if not info:
        return jsonify({"error": "agent not found"}), 404
    if not workdir:
        return jsonify({"error": "workdir not found"}), 404

    contacts = load_contacts(workdir)
    result = []
    for cname, cinfo in contacts.items():
        result.append({
            "name": cname,
            "type": cinfo.get("type", "unknown"),
            "connected_at": cinfo.get("connected_at", ""),
        })
    return jsonify({"contacts": result})


@bp.route("/api/mailbox/connect", methods=["POST"])
def api_mailbox_connect():
    body = request.get_json(silent=True) or {}
    name_a = body.get("agent_a", "").strip()
    name_b = body.get("agent_b", "").strip()

    if not name_a or not name_b:
        return jsonify({"error": "agent_a and agent_b are required"}), 400
    if name_a == name_b:
        return jsonify({"error": "cannot connect an agent to itself"}), 400

    info_a, workdir_a = resolve_agent(name_a)
    info_b, workdir_b = resolve_agent(name_b)

    if not info_a or not workdir_a:
        return jsonify({"error": f"agent '{name_a}' not found or workdir missing"}), 404
    if not info_b or not workdir_b:
        return jsonify({"error": f"agent '{name_b}' not found or workdir missing"}), 404

    now = utcnow()

    contacts_a = load_contacts(workdir_a)
    if name_b not in contacts_a:
        contacts_a[name_b] = {
            "type": "agent",
            "mailbox_file": f"agent.{name_b}.jsonl",
            "remote_workdir": str(workdir_b),
            "connected_at": now,
        }
        save_contacts(workdir_a, contacts_a)
        mailbox_a = workdir_a / "mailbox" / f"agent.{name_b}.jsonl"
        if not mailbox_a.exists():
            mailbox_a.parent.mkdir(parents=True, exist_ok=True)
            mailbox_a.touch()

    contacts_b = load_contacts(workdir_b)
    if name_a not in contacts_b:
        contacts_b[name_a] = {
            "type": "agent",
            "mailbox_file": f"agent.{name_a}.jsonl",
            "remote_workdir": str(workdir_a),
            "connected_at": now,
        }
        save_contacts(workdir_b, contacts_b)
        mailbox_b = workdir_b / "mailbox" / f"agent.{name_a}.jsonl"
        if not mailbox_b.exists():
            mailbox_b.parent.mkdir(parents=True, exist_ok=True)
            mailbox_b.touch()

    return jsonify({"ok": True})


@bp.route("/api/mailbox/disconnect", methods=["POST"])
def api_mailbox_disconnect():
    body = request.get_json(silent=True) or {}
    name_a = body.get("agent_a", "").strip()
    name_b = body.get("agent_b", "").strip()

    if not name_a or not name_b:
        return jsonify({"error": "agent_a and agent_b are required"}), 400

    _, workdir_a = resolve_agent(name_a)
    _, workdir_b = resolve_agent(name_b)

    if workdir_a:
        contacts_a = load_contacts(workdir_a)
        contacts_a.pop(name_b, None)
        save_contacts(workdir_a, contacts_a)

    if workdir_b:
        contacts_b = load_contacts(workdir_b)
        contacts_b.pop(name_a, None)
        save_contacts(workdir_b, contacts_b)

    return jsonify({"ok": True})
