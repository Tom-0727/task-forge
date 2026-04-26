from __future__ import annotations

from flask import Blueprint, current_app, send_from_directory

bp = Blueprint("frontend", __name__)


@bp.route("/")
def index():
    return send_from_directory(current_app.static_folder, "index.html")


@bp.route("/agents/<path:name>")
@bp.route("/agents/<path:name>/memory")
def app_route(name: str):
    return send_from_directory(current_app.static_folder, "index.html")
