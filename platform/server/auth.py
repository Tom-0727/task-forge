from __future__ import annotations

import secrets

from flask import Flask, Response, request

from .config import AUTH_REALM, PLATFORM_PASSWORD


def is_authenticated() -> bool:
    auth = request.authorization
    if not auth or (auth.type or "").lower() != "basic":
        return False
    submitted_password = auth.password or ""
    return secrets.compare_digest(submitted_password, PLATFORM_PASSWORD)


def auth_required_response() -> Response:
    return Response(
        "Unauthorized",
        401,
        {"WWW-Authenticate": f'Basic realm="{AUTH_REALM}"'},
    )


def init_auth(app: Flask) -> None:
    @app.before_request
    def require_auth():
        if is_authenticated():
            return None
        return auth_required_response()
