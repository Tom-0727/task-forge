from __future__ import annotations

import json
import queue

from flask import Blueprint, Response, stream_with_context

from ..services.events import events_revision, subscribe_events, unsubscribe_events

bp = Blueprint("events", __name__)


@bp.route("/api/events")
def api_events():
    def generate():
        q = subscribe_events()
        try:
            yield f"event: hello\ndata: {json.dumps({'revision': events_revision()})}\n\n"
            while True:
                try:
                    event = q.get(timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            unsubscribe_events(q)

    response = Response(stream_with_context(generate()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response
