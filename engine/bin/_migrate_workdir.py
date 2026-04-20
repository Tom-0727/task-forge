#!/usr/bin/env python3
"""Migrate a legacy agent workdir to the shim layout.

Detects the old per-workdir Python runtime (run_claude.py / run_codex.mjs,
mailbox_feishu_bridge.py, web_ui_server.py, start-*.sh, Runtime/agent_name,
Runtime/interaction_mode, ...) and rewrites it to use Runtime/agent.json + the
central engine. Dry-run by default; pass --apply to mutate.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

LEGACY_ROOT_FILES = [
    "mailbox_feishu_bridge.py",
    "mailbox_io.py",
    "web_ui_server.py",
    "run_claude.py",
    "run_codex.mjs",
    "start-claude.sh",
    "start-codex.sh",
    "stop-agent.sh",
    "status-agent.sh",
    "requirements.txt",
    "package.json",
    "package-lock.json",
    "mailbox_bridge.env.example",
]

LEGACY_ROOT_DIRS = [
    "__pycache__",
    ".venv",
    "node_modules",
]

LEGACY_RUNTIME_FILES = [
    "agent_name",
    "interaction_mode",
    "runtime_provider",
    "web_ui_port",
    "feishu_app_id",
    "feishu_app_secret",
    "feishu_chat_id",
    "allowed_user_ids",
    "first_instruction",
    "bootstrap_state.json",
]

LEGACY_SKILL_LINKS = ["bootstrap-sdlc"]
RULES_TEMPLATE = "agent-rules.md.tmpl"
PROVIDER_RULES_CONFIG = {
    "claude": {
        "provider_name": "Claude",
        "rules_filename": "CLAUDE.md",
        "skill_root": ".claude/skills",
        "workspace_provider_layout": "\n".join((
            "  .claude/",
            "    skills/                 # Auto-discovered skills (shared are symlinks, private are real dirs)",
            "    agents/                 # Provider-native subagent definitions",
        )),
        "episode_planner_name": "episode-planner",
        "episode_executor_name": "episode-executor",
        "episode_evaluator_name": "episode-evaluator",
    },
    "codex": {
        "provider_name": "Codex",
        "rules_filename": "AGENTS.md",
        "skill_root": ".agents/skills",
        "workspace_provider_layout": "\n".join((
            "  .agents/",
            "    skills/                 # Auto-discovered skills (shared are symlinks, private are real dirs)",
            "  .codex/",
            "    agents/                 # Provider-native subagent definitions (*.toml)",
        )),
        "episode_planner_name": "episode_planner",
        "episode_executor_name": "episode_executor",
        "episode_evaluator_name": "episode_evaluator",
    },
}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return ""


def parse_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        out[k.strip()] = v
    return out


def detect_provider(workdir: Path) -> str:
    if (workdir / "run_claude.py").exists() or (workdir / "start-claude.sh").exists():
        return "claude"
    if (workdir / "run_codex.mjs").exists() or (workdir / "start-codex.sh").exists():
        return "codex"
    if (workdir / ".claude").is_dir():
        return "claude"
    if (workdir / ".codex").is_dir() or (workdir / ".agents").is_dir():
        return "codex"
    raise SystemExit(f"cannot infer provider from {workdir}")


def derive_identity(workdir: Path) -> dict:
    runtime = workdir / "Runtime"
    agent_name = read_text(runtime / "agent_name") or workdir.name
    provider = read_text(runtime / "runtime_provider") or detect_provider(workdir)
    interaction_mode = read_text(runtime / "interaction_mode") or "none"
    env = parse_env(workdir / "mailbox_bridge.env")
    if interaction_mode == "platform":
        interaction_mode = "feishu" if env.get("FEISHU_APP_ID") else "none"
    if interaction_mode not in {"web-ui", "feishu", "none"}:
        raise SystemExit(f"unknown legacy interaction mode: {interaction_mode}")

    web_ui_port: int | None = None
    port_raw = read_text(runtime / "web_ui_port")
    if port_raw:
        try:
            web_ui_port = int(port_raw)
        except ValueError:
            web_ui_port = None

    interval_raw = read_text(runtime / "interval")
    try:
        interval = int(interval_raw) if interval_raw else 30
    except ValueError:
        interval = 30

    feishu = None
    if interaction_mode == "feishu":
        chat_id = env.get("FEISHU_CHAT_ID", "")
        if chat_id:
            feishu = {
                "app_id_env": "FEISHU_APP_ID",
                "app_secret_env": "FEISHU_APP_SECRET",
                "chat_id": chat_id,
            }

    return {
        "agent_name": agent_name,
        "provider": provider,
        "interaction_mode": interaction_mode,
        "web_ui_port": web_ui_port,
        "feishu": feishu,
        "interval": interval,
    }


def plan_removals(workdir: Path) -> tuple[list[Path], list[Path]]:
    files: list[Path] = []
    dirs: list[Path] = []
    for name in LEGACY_ROOT_FILES:
        p = workdir / name
        if p.is_file() or p.is_symlink():
            files.append(p)
    for name in LEGACY_ROOT_DIRS:
        p = workdir / name
        if p.is_dir() and not p.is_symlink():
            dirs.append(p)
    runtime = workdir / "Runtime"
    for name in LEGACY_RUNTIME_FILES:
        p = runtime / name
        if p.is_file() or p.is_symlink():
            files.append(p)
    for skill_root in (workdir / ".claude" / "skills", workdir / ".agents" / "skills"):
        if not skill_root.is_dir():
            continue
        for name in LEGACY_SKILL_LINKS:
            p = skill_root / name
            if p.is_symlink() or p.exists():
                files.append(p)
    return files, dirs


def load_engine_version(engine_root: Path) -> str:
    pkg = json.loads((engine_root / "package.json").read_text(encoding="utf-8"))
    return pkg.get("version", "0.0.0")


def write_agent_json(workdir: Path, ident: dict, engine_version: str) -> Path:
    runtime = workdir / "Runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    interaction: dict = {"mode": ident["interaction_mode"]}
    if ident["web_ui_port"] is not None:
        interaction["web_ui_port"] = ident["web_ui_port"]
    if ident["feishu"] is not None:
        interaction["feishu"] = ident["feishu"]
    identity = {
        "schema_version": 1,
        "agent_name": ident["agent_name"],
        "provider": ident["provider"],
        "created_at": utcnow_iso(),
        "engine_version_at_create": engine_version,
        "interaction": interaction,
        "runtime": {
            "default_interval_minutes": ident["interval"],
            "default_max_turns": 400,
            "default_max_budget_usd": 5.0,
            "default_compact_every_n_heartbeats": 0,
        },
    }
    path = runtime / "agent.json"
    path.write_text(json.dumps(identity, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def render_rules_file(workdir: Path, engine_root: Path, ident: dict) -> Path | None:
    provider = ident["provider"]
    cfg = PROVIDER_RULES_CONFIG[provider]
    tmpl = engine_root / "templates" / RULES_TEMPLATE
    dst = workdir / cfg["rules_filename"]
    if not tmpl.exists():
        return None
    goal = ""
    goal_file = workdir / "Runtime" / "goal"
    if goal_file.exists():
        goal = goal_file.read_text(encoding="utf-8").rstrip()
    replacements = {
        "AGENT_NAME": ident["agent_name"],
        "GOAL": goal,
        "PROVIDER_NAME": cfg["provider_name"],
        "RULES_FILENAME": cfg["rules_filename"],
        "SKILLS_DIR": cfg["skill_root"],
        "WORKSPACE_PROVIDER_LAYOUT": cfg["workspace_provider_layout"],
        "EPISODE_PLANNER_NAME": cfg["episode_planner_name"],
        "EPISODE_EXECUTOR_NAME": cfg["episode_executor_name"],
        "EPISODE_EVALUATOR_NAME": cfg["episode_evaluator_name"],
    }
    body = tmpl.read_text(encoding="utf-8")
    for k, v in replacements.items():
        body = body.replace("{{" + k + "}}", v)
    dst.write_text(body, encoding="utf-8")
    return dst


def render_subagents(workdir: Path, engine_root: Path, ident: dict) -> list[Path]:
    provider = ident["provider"]
    cfg = {
        "claude": {
            "dir": "agents/claude",
            "root": ".claude/agents",
            "suffix": ".md",
            "planner": "episode-planner",
            "executor": "episode-executor",
            "evaluator": "episode-evaluator",
        },
        "codex": {
            "dir": "agents/codex",
            "root": ".codex/agents",
            "suffix": ".toml",
            "planner": "episode_planner",
            "executor": "episode_executor",
            "evaluator": "episode_evaluator",
        },
    }[provider]
    src_dir = engine_root / "templates" / cfg["dir"]
    dst_dir = workdir / cfg["root"]
    dst_dir.mkdir(parents=True, exist_ok=True)
    replacements = {
        "AGENT_NAME": ident["agent_name"],
        "EPISODE_PLANNER_NAME": cfg["planner"],
        "EPISODE_EXECUTOR_NAME": cfg["executor"],
        "EPISODE_EVALUATOR_NAME": cfg["evaluator"],
    }
    suffix = cfg["suffix"] + ".tmpl"
    out: list[Path] = []
    for tmpl in sorted(src_dir.glob(f"*{suffix}")):
        body = tmpl.read_text(encoding="utf-8")
        for k, v in replacements.items():
            body = body.replace("{{" + k + "}}", v)
        dst = dst_dir / tmpl.name[: -len(".tmpl")]
        dst.write_text(body, encoding="utf-8")
        out.append(dst)
    return out


def clean_stale_subagents(workdir: Path, ident: dict) -> list[Path]:
    """Remove legacy subagent roots that don't match the current provider."""
    provider = ident["provider"]
    stale_roots = {
        "claude": [".codex/agents", ".agents/subagents"],
        "codex": [".claude/agents", ".agents/subagents"],
    }[provider]
    removed: list[Path] = []
    for rel in stale_roots:
        p = workdir / rel
        if p.is_dir() and not p.is_symlink():
            removed.append(p)
    return removed


def unpack_shared_skill_dirs(engine_root: Path, workdir: Path, provider: str) -> list[Path]:
    """Remove legacy real-dir copies of shared skills so refresh-skills can link them."""
    defaults = json.loads((engine_root / "skills" / "default.json").read_text(encoding="utf-8"))
    shared = defaults.get(provider, [])
    skills_root = workdir / (".claude/skills" if provider == "claude" else ".agents/skills")
    removed: list[Path] = []
    for name in shared:
        p = skills_root / name
        if p.exists() and not p.is_symlink() and p.is_dir():
            shutil.rmtree(p)
            removed.append(p)
    return removed


def refresh_skills(engine_root: Path, workdir: Path) -> None:
    subprocess.check_call([str(engine_root / "bin" / "refresh-skills.sh"),
                           "--agent-dir", str(workdir)])


def stop_agent(engine_root: Path, workdir: Path) -> None:
    script = engine_root / "bin" / "stop.sh"
    if script.exists():
        subprocess.call([str(script), "--agent-dir", str(workdir)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent-dir", required=True)
    ap.add_argument("--engine-root", required=True)
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--refresh-subagents-only", action="store_true")
    args = ap.parse_args()

    workdir = Path(args.agent_dir).resolve()
    engine_root = Path(args.engine_root).resolve()

    agent_json = workdir / "Runtime" / "agent.json"
    if args.refresh_subagents_only:
        if not agent_json.exists():
            raise SystemExit(f"missing Runtime/agent.json: {agent_json}")
        existing = json.loads(agent_json.read_text(encoding="utf-8"))
        ident = {
            "agent_name": existing["agent_name"],
            "provider": existing["provider"],
            "interaction_mode": existing["interaction"]["mode"],
            "web_ui_port": existing["interaction"].get("web_ui_port"),
            "feishu": existing["interaction"].get("feishu"),
            "interval": existing["runtime"]["default_interval_minutes"],
        }
        rendered = render_subagents(workdir, engine_root, ident)
        print(f"[migrate] refreshed {len(rendered)} subagent files")
        for p in rendered:
            print(f"  - {p.relative_to(workdir)}")
        return 0

    if agent_json.exists():
        existing = json.loads(agent_json.read_text(encoding="utf-8"))
        ident = {
            "agent_name": existing["agent_name"],
            "provider": existing["provider"],
            "interaction_mode": existing["interaction"]["mode"],
            "web_ui_port": existing["interaction"].get("web_ui_port"),
            "feishu": existing["interaction"].get("feishu"),
            "interval": existing["runtime"]["default_interval_minutes"],
        }
        print(f"[migrate] {workdir}: agent.json already written, only running cleanup")
    else:
        ident = derive_identity(workdir)
    remove_files, remove_dirs = plan_removals(workdir)
    stale_subagent_roots = clean_stale_subagents(workdir, ident)
    dry = not args.apply

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[migrate] {mode} target={workdir}")
    print(f"  agent_name    : {ident['agent_name']}")
    print(f"  provider      : {ident['provider']}")
    print(f"  interaction   : {ident['interaction_mode']}"
          + (f" port={ident['web_ui_port']}" if ident['web_ui_port'] else "")
          + (f" chat={ident['feishu']['chat_id']}" if ident['feishu'] else ""))
    print(f"  interval      : {ident['interval']}m")
    print(f"  files removed : {len(remove_files)}")
    for p in remove_files:
        print(f"    - {p.relative_to(workdir)}")
    print(f"  dirs removed  : {len(remove_dirs) + len(stale_subagent_roots)}")
    for p in remove_dirs + stale_subagent_roots:
        print(f"    - {p.relative_to(workdir)}")

    if dry:
        print("[migrate] dry-run; nothing changed. pass --apply to commit.")
        return 0

    stop_agent(engine_root, workdir)

    if not agent_json.exists():
        engine_version = load_engine_version(engine_root)
        write_agent_json(workdir, ident, engine_version)
        print("[migrate] wrote Runtime/agent.json")
    else:
        existing = json.loads(agent_json.read_text(encoding="utf-8"))
        runtime_cfg = existing.setdefault("runtime", {})
        if "default_compact_every_n_heartbeats" not in runtime_cfg:
            runtime_cfg["default_compact_every_n_heartbeats"] = 0
            agent_json.write_text(
                json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            print("[migrate] upgraded Runtime/agent.json runtime.default_compact_every_n_heartbeats")
    rendered = render_subagents(workdir, engine_root, ident)
    print(f"[migrate] rendered {len(rendered)} subagent files")

    rules_dst = render_rules_file(workdir, engine_root, ident)
    if rules_dst is not None:
        print(f"[migrate] refreshed rules file {rules_dst.relative_to(workdir)}")

    unpacked = unpack_shared_skill_dirs(engine_root, workdir, ident["provider"])
    for p in unpacked:
        print(f"[migrate] removed legacy skill dir {p.relative_to(workdir)}")
    refresh_skills(engine_root, workdir)
    print("[migrate] refreshed skill symlinks")

    for p in remove_files:
        try:
            p.unlink()
        except OSError as exc:
            print(f"[migrate] warn: could not remove {p}: {exc}", file=sys.stderr)
    for p in remove_dirs + stale_subagent_roots:
        try:
            shutil.rmtree(p)
        except OSError as exc:
            print(f"[migrate] warn: could not remove {p}: {exc}", file=sys.stderr)

    print(f"[migrate] done. start with: engine/bin/start.sh --agent-dir {workdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
