from __future__ import annotations

from flask import Blueprint, jsonify

from ..services.overview import build_overview

bp = Blueprint("overview", __name__)


@bp.route("/api/overview")
def api_overview():
    return jsonify(build_overview())
