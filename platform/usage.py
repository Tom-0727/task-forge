"""LLM quota snapshots for Claude and Codex CLIs.

Launches the platform/scripts/capture_*_tmux.sh scripts (which spawn a
short-lived claude/codex session, send /status, and capture the pane),
parses the resulting text into structured data, and caches it in memory
and on disk.

A background thread refreshes the snapshot once per hour so that
/api/usage stays cheap for the frontend.
"""

from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent / "scripts"
CACHE_FILE = Path(__file__).resolve().parent / ".usage_cache.json"

REFRESH_INTERVAL_SECONDS = 3600  # 1 hour
CAPTURE_TIMEOUT_SECONDS = 60

CLAUDE_SCRIPT = "capture_claude_usage_tmux.sh"
CODEX_SCRIPT = "capture_codex_status_tmux.sh"

_cache: dict = {}
_cache_lock = threading.Lock()
_refresh_lock = threading.Lock()
_refresher_started = False
_refresher_started_lock = threading.Lock()


# ── Capture ──────────────────────────────────────────────────────────────

def _run_capture_script(script_name: str) -> str:
    script_path = SCRIPTS_DIR / script_name
    if not script_path.exists():
        raise FileNotFoundError(f"capture script not found: {script_path}")
    result = subprocess.run(
        ["bash", str(script_path)],
        cwd=str(HARNESS_DIR),
        capture_output=True,
        text=True,
        timeout=CAPTURE_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{script_name} exited with {result.returncode}: "
            f"{result.stderr.strip()[-200:]}"
        )
    return result.stdout


# ── Parsing: Claude ──────────────────────────────────────────────────────

def _parse_claude(text: str) -> dict:
    """Parse the `/status` Usage tab output from the claude CLI.

    Expected layout (whitespace varies):
        Current session
        ████████▌                                          17% used
        Resets 1am (Asia/Singapore)

        Current week (all models)
        ███████████                                        22% used
        Resets Apr 13, 1pm (Asia/Singapore)
    """
    lines = text.splitlines()
    out: dict = {}

    def scan_block(start: int, key_prefix: str) -> None:
        # Look ahead up to 4 lines for percent + resets
        for j in range(start, min(start + 5, len(lines))):
            line = lines[j]
            m = re.search(r"(\d+)\s*%\s*used", line)
            if m and f"{key_prefix}_percent_used" not in out:
                out[f"{key_prefix}_percent_used"] = int(m.group(1))
            m = re.search(r"Resets\s+(.+?)\s*$", line)
            if m and f"{key_prefix}_resets" not in out:
                out[f"{key_prefix}_resets"] = m.group(1).strip()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("Current session"):
            scan_block(i + 1, "session")
        elif stripped.startswith("Current week"):
            scan_block(i + 1, "week")

    return out


# ── Parsing: Codex ───────────────────────────────────────────────────────

_BORDER_RE = re.compile(r"^[│┃|╭╰─]+|[│┃|╭╰─]+$")


def _strip_borders(line: str) -> str:
    # Remove leading/trailing box-drawing characters and surrounding whitespace
    stripped = line.strip()
    stripped = re.sub(r"^[│┃|]\s*", "", stripped)
    stripped = re.sub(r"\s*[│┃|]\s*$", "", stripped)
    return stripped.strip()


def _extract_codex_group(subset_lines: list[str]) -> dict:
    """Extract 5h + weekly percent-left + resets from a slice of codex lines."""
    parsed: dict = {}
    current: str | None = None
    for line in subset_lines:
        lower = line.lower()
        if lower.startswith("5h limit"):
            current = "5h"
            m = re.search(r"(\d+)\s*%\s*left", line)
            if m:
                parsed["5h_percent_left"] = int(m.group(1))
        elif lower.startswith("weekly limit"):
            current = "weekly"
            m = re.search(r"(\d+)\s*%\s*left", line)
            if m:
                parsed["weekly_percent_left"] = int(m.group(1))
        elif current and "resets" in lower:
            m = re.search(r"resets\s+([^)]+?)\s*\)?\s*$", line, re.IGNORECASE)
            if m:
                parsed[f"{current}_resets"] = m.group(1).strip()
    return parsed


def _parse_codex(text: str) -> dict:
    """Parse the `/status` panel from the codex CLI.

    Expected layout (borders + whitespace vary):
        Model:                       gpt-5.4 (reasoning high, ...)
        ...
        5h limit:                    [████...] 98% left
                                     (resets 00:13 on 12 Apr)
        Weekly limit:                [████...] 98% left
                                     (resets 09:00 on 17 Apr)
        GPT-5.3-Codex-Spark limit:
        5h limit:                    [...] 100% left
                                     (resets 03:44 on 12 Apr)
        Weekly limit:                [...] 100% left
                                     (resets 22:44 on 18 Apr)
    """
    clean_lines = [_strip_borders(line) for line in text.splitlines()]

    out: dict = {}

    # Model label from the "Model:" row
    for line in clean_lines:
        m = re.match(r"Model:\s*(.+)$", line)
        if m:
            # strip a trailing "(...)" descriptor
            label = m.group(1)
            label = re.sub(r"\s*\(.*\)\s*$", "", label).strip()
            if label:
                out["model"] = label
            break

    # Split by the "Spark limit:" section header (spark-specific block)
    spark_idx: int | None = None
    for idx, line in enumerate(clean_lines):
        if "spark limit" in line.lower():
            spark_idx = idx
            break

    if spark_idx is not None:
        out.update(_extract_codex_group(clean_lines[:spark_idx]))
        spark_parsed = _extract_codex_group(clean_lines[spark_idx:])
        if spark_parsed:
            out["spark"] = spark_parsed
    else:
        out.update(_extract_codex_group(clean_lines))

    return out


# ── Snapshot management ─────────────────────────────────────────────────

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_cache(snapshot: dict) -> None:
    try:
        CACHE_FILE.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass


def _load_cache_from_disk() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def refresh_usage() -> dict:
    """Run capture scripts, parse, update cache. Serialized via _refresh_lock."""
    global _cache
    with _refresh_lock:
        snapshot: dict = {"updated_at": _utcnow_iso()}
        errors: dict = {}

        try:
            claude_out = _run_capture_script(CLAUDE_SCRIPT)
            parsed = _parse_claude(claude_out)
            if parsed:
                snapshot["claude"] = parsed
            else:
                errors["claude"] = "could not parse usage output"
        except Exception as exc:  # noqa: BLE001
            errors["claude"] = str(exc)

        try:
            codex_out = _run_capture_script(CODEX_SCRIPT)
            parsed = _parse_codex(codex_out)
            if parsed:
                snapshot["codex"] = parsed
            else:
                errors["codex"] = "could not parse status output"
        except Exception as exc:  # noqa: BLE001
            errors["codex"] = str(exc)

        if errors:
            snapshot["errors"] = errors

        with _cache_lock:
            _cache = snapshot
        _write_cache(snapshot)
        return snapshot


def get_usage() -> dict:
    """Return the current snapshot, loading from disk if the process is fresh."""
    global _cache
    with _cache_lock:
        if _cache:
            return _cache
    disk = _load_cache_from_disk()
    if disk:
        with _cache_lock:
            _cache = disk
    return disk


def start_refresher() -> None:
    """Kick off a background thread that refreshes the cache every hour."""
    global _refresher_started
    with _refresher_started_lock:
        if _refresher_started:
            return
        _refresher_started = True

    def _loop() -> None:
        while True:
            try:
                refresh_usage()
            except Exception:  # noqa: BLE001 — background loop, swallow + retry
                pass
            time.sleep(REFRESH_INTERVAL_SECONDS)

    thread = threading.Thread(target=_loop, name="usage-refresher", daemon=True)
    thread.start()
