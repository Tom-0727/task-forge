from __future__ import annotations

from flask import Blueprint, jsonify

from usage import get_usage

bp = Blueprint("usage", __name__)


@bp.route("/api/usage")
def api_usage():
    return jsonify(get_usage())
