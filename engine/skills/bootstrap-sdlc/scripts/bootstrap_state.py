#!/usr/bin/env python3
"""bootstrap_state.py — Bootstrap SDLC state machine.

A small state machine that gates the heartbeat loop. Until phase == "done",
the agent must advance bootstrap phases (prd -> design -> done) before doing
any implementation work. Phase transitions require explicit human approval
via mailbox.

State file: <agent_workdir>/Runtime/bootstrap_state.json
"""

from __future__ import annotations

import _bootstrap  # noqa: F401

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from agent_dir import resolve_agent_dir

VALID_PHASES = ("prd", "design", "done")
ALLOWED_TRANSITIONS = {
    "prd": {"design"},
    "design": {"done"},
    "done": set(),
}


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _state_file(agent_dir: Path) -> Path:
    return agent_dir / "Runtime" / "bootstrap_state.json"


def read_state(agent_dir: Path) -> dict | None:
    path = _state_file(agent_dir)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def get_phase(agent_dir: Path) -> str:
    state = read_state(agent_dir)
    if state is None:
        return "done"
    phase = state.get("phase")
    if phase not in VALID_PHASES:
        return "done"
    return phase


def write_state(agent_dir: Path, state: dict) -> None:
    runtime_dir = agent_dir / "Runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    _state_file(agent_dir).write_text(
        json.dumps(state, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def init_state(
    agent_dir: Path,
    prd_path: str,
    architecture_path: str,
    assumptions_path: str,
    *,
    force: bool = False,
) -> dict:
    if _state_file(agent_dir).exists() and not force:
        raise SystemExit(f"bootstrap state already exists at {_state_file(agent_dir)}")
    now = utcnow()
    state = {
        "phase": "prd",
        "prd_path": prd_path,
        "architecture_path": architecture_path,
        "assumptions_path": assumptions_path,
        "created_at": now,
        "phase_history": [
            {
                "phase": "prd",
                "entered_at": now,
                "entered_by": "deploy-agent",
            }
        ],
    }
    write_state(agent_dir, state)
    return state


def advance_phase(agent_dir: Path, to_phase: str, approver: str, note: str = "") -> dict:
    state = read_state(agent_dir)
    if state is None:
        raise SystemExit("bootstrap state not initialized. Run `bootstrap_state.py init` first.")
    current = state.get("phase", "done")
    if to_phase not in VALID_PHASES:
        raise SystemExit(f"invalid target phase: {to_phase}")
    if to_phase not in ALLOWED_TRANSITIONS.get(current, set()):
        raise SystemExit(
            f"illegal transition: {current} -> {to_phase}. "
            f"Allowed from {current}: {sorted(ALLOWED_TRANSITIONS.get(current, set()))}"
        )
    if not approver.strip():
        raise SystemExit("--approver is required and must be non-empty")

    now = utcnow()
    history = state.setdefault("phase_history", [])
    if history and "exited_at" not in history[-1]:
        history[-1]["exited_at"] = now
        history[-1]["exited_by"] = approver
        if note:
            history[-1]["exit_note"] = note

    state["phase"] = to_phase
    history.append(
        {
            "phase": to_phase,
            "entered_at": now,
            "entered_by": approver,
        }
    )
    write_state(agent_dir, state)
    return state


def reset_state(agent_dir: Path, approver: str, note: str = "") -> dict:
    state = read_state(agent_dir)
    if state is None:
        raise SystemExit("bootstrap state not initialized; cannot reset")
    if not approver.strip():
        raise SystemExit("--approver is required and must be non-empty")
    now = utcnow()
    history = state.setdefault("phase_history", [])
    if history and "exited_at" not in history[-1]:
        history[-1]["exited_at"] = now
        history[-1]["exited_by"] = approver
        history[-1]["exit_note"] = note or "reset"
    state["phase"] = "prd"
    history.append(
        {
            "phase": "prd",
            "entered_at": now,
            "entered_by": approver,
            "entry_note": note or "reset",
        }
    )
    write_state(agent_dir, state)
    return state


def cmd_show(args) -> None:
    agent_dir = resolve_agent_dir(args.agent_workdir)
    state = read_state(agent_dir)
    if state is None:
        print(json.dumps({"phase": "done", "initialized": False}, indent=2))
        return
    print(json.dumps(state, indent=2, ensure_ascii=False))


def cmd_phase(args) -> None:
    agent_dir = resolve_agent_dir(args.agent_workdir)
    print(get_phase(agent_dir))


def cmd_init(args) -> None:
    agent_dir = resolve_agent_dir(args.agent_workdir)
    state = init_state(
        agent_dir,
        prd_path=args.prd_path,
        architecture_path=args.architecture_path,
        assumptions_path=args.assumptions_path,
        force=args.force,
    )
    print(json.dumps(state, indent=2, ensure_ascii=False))


def cmd_advance(args) -> None:
    agent_dir = resolve_agent_dir(args.agent_workdir)
    state = advance_phase(agent_dir, args.to, args.approver, args.note or "")
    print(json.dumps(state, indent=2, ensure_ascii=False))


def cmd_reset(args) -> None:
    agent_dir = resolve_agent_dir(args.agent_workdir)
    state = reset_state(agent_dir, args.approver, args.note or "")
    print(json.dumps(state, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap SDLC state machine.")
    parser.add_argument("--agent-workdir", default=None)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_show = sub.add_parser("show", help="print the full state JSON")
    p_show.set_defaults(func=cmd_show)

    p_phase = sub.add_parser("phase", help="print just the current phase")
    p_phase.set_defaults(func=cmd_phase)

    p_init = sub.add_parser("init", help="initialize a fresh state at phase=prd")
    p_init.add_argument("--prd-path", required=True)
    p_init.add_argument("--architecture-path", required=True)
    p_init.add_argument("--assumptions-path", required=True)
    p_init.add_argument("--force", action="store_true")
    p_init.set_defaults(func=cmd_init)

    p_adv = sub.add_parser("advance", help="advance to the next phase")
    p_adv.add_argument("--to", required=True, choices=VALID_PHASES)
    p_adv.add_argument("--approver", required=True)
    p_adv.add_argument("--note", default="")
    p_adv.set_defaults(func=cmd_advance)

    p_reset = sub.add_parser("reset", help="explicit reset back to phase=prd")
    p_reset.add_argument("--approver", required=True)
    p_reset.add_argument("--note", default="")
    p_reset.set_defaults(func=cmd_reset)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
