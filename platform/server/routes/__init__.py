from __future__ import annotations

from flask import Flask

from .agent_core import bp as agent_core_bp
from .agent_lifecycle import bp as agent_lifecycle_bp
from .agent_provisioning import bp as agent_provisioning_bp
from .agent_settings import bp as agent_settings_bp
from .events import bp as events_bp
from .frontend import bp as frontend_bp
from .mailbox import bp as mailbox_bp
from .memory import bp as memory_bp
from .overview import bp as overview_bp
from .todo import bp as todo_bp
from .usage import bp as usage_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(frontend_bp)
    app.register_blueprint(agent_core_bp)
    app.register_blueprint(agent_settings_bp)
    app.register_blueprint(agent_lifecycle_bp)
    app.register_blueprint(agent_provisioning_bp)
    app.register_blueprint(memory_bp)
    app.register_blueprint(mailbox_bp)
    app.register_blueprint(todo_bp)
    app.register_blueprint(overview_bp)
    app.register_blueprint(events_bp)
    app.register_blueprint(usage_bp)
