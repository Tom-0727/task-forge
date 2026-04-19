#!/bin/bash
# refresh-skills.sh — reconcile a workdir's shared skill symlinks with engine/skills/default.json.
# Private skills (real directories) are left alone. Invoke after adding/removing a shared
# skill in engine/skills/ or editing engine/skills/default.json.
set -euo pipefail

AGENT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-dir) AGENT_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$AGENT_DIR" ] || { echo "missing --agent-dir" >&2; exit 1; }
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENGINE_ROOT="$(cd "$HERE/.." && pwd)"

python3 - "$AGENT_DIR" "$ENGINE_ROOT" <<'PY'
import json, os, shutil, sys
from pathlib import Path

workdir = Path(sys.argv[1]).resolve()
engine_root = Path(sys.argv[2]).resolve()

identity = json.loads((workdir / "Runtime" / "agent.json").read_text(encoding="utf-8"))
provider = identity["provider"]
skills_root = {"claude": ".claude/skills", "codex": ".agents/skills"}[provider]

defaults = json.loads((engine_root / "skills" / "default.json").read_text(encoding="utf-8"))
shared_names = set(defaults.get(provider, []))

skills_dir = workdir / skills_root
skills_dir.mkdir(parents=True, exist_ok=True)

# Drop stale symlinks pointing into engine/skills/ that are no longer in defaults.
for entry in skills_dir.iterdir():
    if not entry.is_symlink():
        continue
    target = Path(os.readlink(entry))
    if not target.is_absolute():
        target = (entry.parent / target).resolve()
    if engine_root in target.parents and entry.name not in shared_names:
        print(f"[refresh-skills] removing stale symlink: {entry.name}")
        entry.unlink()

# Create or replace symlinks for current defaults.
for name in shared_names:
    src = engine_root / "skills" / name
    if not src.exists():
        raise SystemExit(f"engine skill missing: {src}")
    dst = skills_dir / name
    if dst.is_symlink():
        if Path(os.readlink(dst)).resolve() == src.resolve():
            continue
        dst.unlink()
    elif dst.exists():
        raise SystemExit(f"[refresh-skills] refusing to replace non-symlink at {dst}")
    dst.symlink_to(src)
    print(f"[refresh-skills] linked: {name} -> {src}")
PY
