---
name: todo
description: Todo list mechanism for the long-run agent. Two concepts — Todo (completion-bearing work items, one JSON file per day) and Scheduled Task (wake-up configurations with minute-granular trigger times).
---

# todo

Paths below use `{skills-dir}` — resolve via the agent's rules file (CLAUDE.md → `.claude/skills`; AGENTS.md → `.agents/skills`).

Use this skill to persist multi-step, time-bound, or cross-heartbeat work.
It provides two concepts:

- **Todo** — a completion-bearing work item with a title, description, a list of subtasks, and a `done` boolean. Todos are stored one JSON file per day under `todo_list/<YYYYMM>/<DD>.json`. The file path encodes the day — there is no `date` field inside a todo.
- **Scheduled Task** — a wake-up configuration with a minute-granular trigger time. Stored as a single JSON list in `scheduled_tasks.json`. Has no `done` field — it is a timer that makes the next heartbeat a `reminder`-kind heartbeat when its fire minute arrives.

## When to use this skill

Use it when:

- The work is multi-step and you want a durable list you can revisit across heartbeats.
- You are making a time-bound commitment (e.g. "do X at 14:00 today" or "every Monday at 09:00").
- The work is likely to span more than one heartbeat and you need to avoid dropping candidate items at a decision point.

Do NOT use it for:

- One-shot answers to a human question resolved in the same heartbeat.
- Scratch work decided and discarded within a single heartbeat.
- External task-management sync or cross-agent shared lists (out of scope).

## Todo — edit the day's file directly

Todos are edited with the SDK-native Read / Edit / Write tools. The path is computed from `now_minute`:

```
todo_list/<YYYYMM>/<DD>.json
# today example: todo_list/202604/19.json
```

Each file holds a JSON list of Todo objects:

```
{
  "id": "t<n>",
  "title": "string",
  "description": "string (free-form, may be empty)",
  "subtasks": [ { "id": 1, "text": "...", "done": false } ],
  "done": false
}
```

Rules: `id` is `t<n>` where `n` is the next sequential integer within this day's file. Subtask `id` is a plain sequential integer within its enclosing todo.

## Todo — atomic write helper (internal)

```bash
uv run python {skills-dir}/todo/scripts/_write_today.py \
    --title "Triage PR queue" \
    --description "Look at the three open PRs on main."
# --date YYYY-MM-DD optional; defaults to today
# --agent-workdir PATH optional; defaults to cwd
# prints the new todo id (e.g. "t1") on stdout
```

Internal utility — prefer direct Edit/Write for agent-driven planning.

## Scheduled Task — dedicated script surface

```bash
# Add a weekly scheduled task:
uv run python {skills-dir}/todo/scripts/add_scheduled.py \
    --title "..." --kind weekly --time HH:MM --weekdays MON,TUE

# Add a one-shot scheduled task:
uv run python {skills-dir}/todo/scripts/add_scheduled.py \
    --title "..." --kind date --time HH:MM --date YYYY-MM-DD

# List all scheduled tasks:
uv run python {skills-dir}/todo/scripts/list_scheduled.py

# Delete a scheduled task by id:
uv run python {skills-dir}/todo/scripts/delete_scheduled.py --id s<n>
```

The pre-heartbeat hook (`pre_heartbeat.py`) is invoked by the runtime before each wake-up prompt. It reads `scheduled_tasks.json` and writes `Runtime/due_reminders.json`; the runtime renders a "Due reminders this minute" section plus today's Todo list into the wake-up prompt.

## Convenience reader

```bash
uv run python {skills-dir}/todo/scripts/fetch_today.py
# prints today's todos (JSON); --date and --agent-workdir optional
```

## Storage layout

```
<agent_workdir>/
  todo_list/
    <YYYYMM>/
      <DD>.json
  scheduled_tasks.json
  Runtime/
    due_reminders.json
    scheduled_delivered.json
```

Writes use tempfile + `os.replace` for atomic rename.

## Rules

- Todos: edit directly with Read/Edit/Write; use `_write_today.py` only when a script-level append is needed.
- Scheduled tasks: MUST be written via `add_scheduled` / `delete_scheduled` — never hand-edit `scheduled_tasks.json`.
- `fetch_today.py` is convenience; `cat` the day file works too.
- Time is taken from `now_minute` injected by the runtime — do not shell out to `date` or call `datetime.now()` in agent prompts.
