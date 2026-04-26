from __future__ import annotations

import argparse
import sys

from flask import Flask

from usage import start_refresher as start_usage_refresher

from .auth import init_auth
from .config import PLATFORM_ENV_FILE, PLATFORM_PASSWORD, STATIC_DIR
from .routes import register_routes
from .services.events import start_event_watcher


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR))
    init_auth(app)
    register_routes(app)
    return app


def main() -> None:
    if not PLATFORM_PASSWORD:
        print(
            f"PLATFORM_PASSWORD is not set. Configure it in {PLATFORM_ENV_FILE}.",
            file=sys.stderr,
        )
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Agent Platform Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=9000, help="Bind port (default: 9000)")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    args = parser.parse_args()

    print(f"Agent Platform starting on http://{args.host}:{args.port}")
    start_usage_refresher()
    start_event_watcher()
    create_app().run(host=args.host, port=args.port, debug=args.debug, threaded=True)


if __name__ == "__main__":
    main()
