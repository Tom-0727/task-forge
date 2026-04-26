from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from ..common import format_mtime

EPISODE_TS_RE = re.compile(r"^ep--(\d{8}T\d{6}Z)--")
MEMORY_HOUSEKEEPING_FILES = {"README.md", "AGENTS.md", "CLAUDE.md"}


def parse_frontmatter(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end < 0:
        return {}

    data: dict[str, str] = {}
    for raw_line in text[4:end].splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and (
            (value[0] == value[-1] == "'") or (value[0] == value[-1] == '"')
        ):
            value = value[1:-1]
        if key:
            data[key] = value
    return data


def memory_kind_root(workdir: Path, kind: str) -> Path | None:
    if kind == "knowledge":
        return workdir / "Memory" / "knowledge"
    if kind == "episodes":
        return workdir / "Memory" / "episodes"
    return None


def is_memory_content_file(rel: Path) -> bool:
    if any(part.startswith(".") for part in rel.parts):
        return False
    return rel.name not in MEMORY_HOUSEKEEPING_FILES


def path_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def episode_sort_and_date(path: Path) -> tuple[float, str, str]:
    match = EPISODE_TS_RE.match(path.name)
    if match:
        stamp = match.group(1)
        try:
            dt = datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            return dt.timestamp(), dt.strftime("%Y-%m-%d"), dt.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    mtime = path_mtime(path)
    if not mtime:
        return 0.0, "unknown", ""
    dt = datetime.fromtimestamp(mtime, timezone.utc)
    return mtime, dt.strftime("%Y-%m-%d"), dt.strftime("%Y-%m-%d %H:%M")


def memory_index(workdir: Path, kind: str, limit: int, cursor: int, date_filter: str = "") -> dict:
    root = memory_kind_root(workdir, kind)
    if root is None:
        return {"error": "kind must be knowledge or episodes"}
    limit = max(1, min(limit, 100))
    cursor = max(0, cursor)
    if not root.exists():
        out: dict = {"items": [], "next_cursor": None}
        if kind == "episodes":
            out["dates"] = []
        return out

    entries: list[tuple[Path, float, str, str]] = []
    date_counts: dict[str, int] = {}
    root_resolved = root.resolve()
    try:
        for path in root.rglob("*.md"):
            try:
                rel = path.relative_to(root)
                path.resolve().relative_to(root_resolved)
            except ValueError:
                continue
            if not is_memory_content_file(rel):
                continue
            if kind == "episodes":
                sort_key, episode_date, occurred_at = episode_sort_and_date(path)
                date_counts[episode_date] = date_counts.get(episode_date, 0) + 1
                if date_filter and episode_date != date_filter:
                    continue
                entries.append((path, sort_key, episode_date, occurred_at))
            else:
                entries.append((path, path_mtime(path), "", ""))
    except OSError:
        out = {"items": [], "next_cursor": None}
        if kind == "episodes":
            out["dates"] = []
        return out

    if kind == "episodes" and not date_filter:
        return {
            "items": [],
            "next_cursor": None,
            "dates": [
                {"date": date, "count": count}
                for date, count in sorted(date_counts.items(), reverse=True)
            ],
            "date": "",
        }

    entries.sort(key=lambda item: item[1], reverse=True)
    page = entries[cursor:cursor + limit]
    items = []
    for path, _, episode_date, occurred_at in page:
        try:
            stat = path.stat()
        except OSError:
            continue
        fm = parse_frontmatter(path)
        rel_path = path.relative_to(workdir).as_posix()
        item = {
            "path": rel_path,
            "name": path.name,
            "last_modified": format_mtime(path),
            "size": stat.st_size,
            "status": fm.get("status", ""),
            "last_edited_at": fm.get("last_edited_at", ""),
        }
        if kind == "knowledge":
            item["summary"] = fm.get("summary", "")
        else:
            item["title"] = fm.get("title", "")
            item["objective"] = fm.get("objective", "")
            item["date"] = episode_date
            item["occurred_at"] = occurred_at
        items.append(item)

    next_cursor = cursor + limit if cursor + limit < len(entries) else None
    out = {"items": items, "next_cursor": next_cursor}
    if kind == "episodes":
        out["dates"] = [
            {"date": date, "count": count}
            for date, count in sorted(date_counts.items(), reverse=True)
        ]
        out["date"] = date_filter
    return out


def resolve_memory_markdown(workdir: Path, raw_path: str) -> Path | None:
    if not raw_path:
        return None
    rel = Path(raw_path)
    if rel.is_absolute() or not rel.parts or rel.parts[0] != "Memory":
        return None
    if any(part.startswith(".") for part in rel.parts):
        return None
    memory_root = (workdir / "Memory").resolve()
    target = (workdir / rel).resolve()
    try:
        target.relative_to(memory_root)
    except ValueError:
        return None
    if target.suffix.lower() != ".md":
        return None
    return target
