from __future__ import annotations

import json
from pathlib import Path


def default_metrics() -> dict:
    return {
        "schema_version": 1,
        "heartbeat": {
            "count": 0,
            "last_duration_seconds": 0,
            "avg_duration_seconds": 0,
            "total_duration_seconds": 0,
        },
        "compact": {
            "count_since_last": 0,
            "total_compacts": 0,
            "total_heartbeats_between_compacts": 0,
            "avg_heartbeats_between": 0,
            "last_compact_at": None,
        },
        "tokens": {
            "last_turn": {},
            "estimated_context_tokens": 0,
            "lifetime": {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cached_input_tokens": 0,
            },
        },
        "manual_compact": None,
        "last_updated": None,
    }


def read_manual_compact_status(workdir: Path) -> dict | None:
    status_path = workdir / "Runtime" / "compact_status.json"
    if not status_path.exists():
        return None
    try:
        raw = json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return raw if isinstance(raw, dict) else None


def read_agent_metrics(workdir: Path) -> dict:
    metrics_path = workdir / "Runtime" / "metrics.json"
    base = default_metrics()
    base["manual_compact"] = read_manual_compact_status(workdir)
    if not metrics_path.exists():
        return base
    try:
        raw = json.loads(metrics_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return base
    if not isinstance(raw, dict):
        return base

    heartbeat = raw.get("heartbeat") if isinstance(raw.get("heartbeat"), dict) else {}
    compact = raw.get("compact") if isinstance(raw.get("compact"), dict) else {}
    tokens = raw.get("tokens") if isinstance(raw.get("tokens"), dict) else {}
    lifetime = tokens.get("lifetime") if isinstance(tokens.get("lifetime"), dict) else {}
    last_turn = tokens.get("last_turn") if isinstance(tokens.get("last_turn"), dict) else {}

    return {
        "schema_version": raw.get("schema_version", 1),
        "heartbeat": {**base["heartbeat"], **heartbeat},
        "compact": {**base["compact"], **compact},
        "tokens": {
            "last_turn": last_turn,
            "estimated_context_tokens": tokens.get("estimated_context_tokens", 0),
            "lifetime": {**base["tokens"]["lifetime"], **lifetime},
        },
        "manual_compact": read_manual_compact_status(workdir),
        "last_updated": raw.get("last_updated"),
    }
