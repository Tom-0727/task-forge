# LifeLong Running Agent Harness

Scaffold tool for creating autonomous Agent workspaces. One command creates a complete workspace with behavioral rules, memory structure, communication mailbox, and a heartbeat launcher.

Based on the design spec in [DESIGNS.md](./DESIGNS.md).

## Quick Start

Single deployment entrypoint: `bootstrap-runtime`.
One command creates workspace, installs deps, seeds goal plus first instruction, and starts runtime.

```bash
./bootstrap-runtime \
  --goal "检查自己的所有机制是否正常，检查 skills 机制是否有 mailbox-operate 和 skill-creator；另外检查 Subagent机制是否可正常使用" \
  --first-instruction "先检查当前 workspace 的关键机制是否正常，并把发现的问题按优先级写进 mailbox" \
  --agent-name "SelfCheckBotCc" \
  --provider codex \
  --interaction web-ui \
  --web-ui-port 8888 \
  --interval 8 \
  --workdir ~/agents/self-check-bot-co
```

Then open `http://127.0.0.1:8888`.

## Template Layout

Templates are split by ownership at the repository root:

- `shared/` — provider-agnostic templates (mailbox, memory, bridge, web-ui, common skills, rules body)
- `providers/codex/` — Codex runtime templates
- `providers/claude/` — Claude runtime templates

`bootstrap-runtime` is now the only scaffolding entrypoint; `create-agent` has been removed.

## What Gets Created

`bootstrap-runtime --provider codex` creates a Codex workspace.  
`bootstrap-runtime --provider claude` creates a Claude workspace.

Common files in both:

```text
<target-dir>/
  stop-agent.sh      # Stop active runtime + bridge + web UI
  status-agent.sh    # Inspect runtime state
  requirements.txt   # Python deps (shared + provider-specific)
  tool-notes/        # One file per non-native external tool
  mailbox/
    human.jsonl      # Human-agent communication (append-only)
  Memory/
    knowledge/
    episodes/
  Runtime/
```

Codex-specific files:

- `AGENTS.md`
- `.agents/skills/mailbox-operate/`
- `run_codex.mjs`
- `start-codex.sh`
- `package.json`

Claude-specific files:

- `CLAUDE.md`
- `.claude/skills/mailbox-operate/`
- `run_claude.py`
- `start-claude.sh`

Also included:

- `mailbox_io.py` — shared append-only mailbox helper
- `mailbox_feishu_bridge.py` — optional Feishu <-> mailbox bridge
- `web_ui_server.py` — optional browser-based mailbox/status UI
- `<provider-skill-root>/skills/mailbox-operate/` — self-contained mailbox-operate skill (SKILL.md + scripts)
- `Memory/knowledge/<AGENTS.md|CLAUDE.md>` / `Memory/episodes/<AGENTS.md|CLAUDE.md>` / `tool-notes/<AGENTS.md|CLAUDE.md>` / `mailbox/<AGENTS.md|CLAUDE.md>` — provider-scoped directory rules
- `mailbox_bridge.env.example` — bridge environment template

If `mailbox_bridge.env` exists, generated runner scripts invoked by `bootstrap-runtime` will start the Feishu bridge automatically.

## Bootstrap Runtime

`bootstrap-runtime` is the only supported deployment entrypoint.
It requires an explicit interaction mode:

```bash
./bootstrap-runtime \
  --goal "Goal text" \
  --first-instruction "First instruction text" \
  --agent-name "ResearchBot" \
  --provider codex|claude \
  --interaction feishu|web-ui \
  --interval 20 \
  --workdir /abs/path/to/runtime
```

Rules:

- `--interaction feishu`: requires `--feishu-app-id`, `--feishu-app-secret`, `--feishu-chat-id`
- `--interaction web-ui`: must not include Feishu arguments
- Feishu and Web UI are mutually exclusive in one runtime launch
- `--goal` is the long-lived objective written into `AGENTS.md` / `CLAUDE.md`
- `--first-instruction` is the first concrete human instruction seeded into `mailbox/MAILBOX.jsonl`
- `--agent-name` is optional for first-time workspace creation; if omitted, it defaults to `basename(workdir)`
- If `workdir` already exists, `--agent-name` is ignored and the existing workspace identity is reused

## Requirements

- Node.js 18+ for Codex runtime
- Python 3.10+ and `uv` for shared services and Claude runtime
- `claude` CLI installed and configured for Claude runtime
- Codex authentication available for Codex runtime, either via ChatGPT sign-in or API key sign-in

## Design

- **Single bootstrap deployment entrypoint** — create/start via `bootstrap-runtime`
- **Provider-separated templates** — `shared/` + `providers/<provider>/`
- **Provider-specific launchers managed internally** — bootstrap orchestrates workspace runner scripts
- **Codex runtime on the official Codex SDK** — same auth model as Codex CLI, resumable threads, streamed events
- **Self-contained provider skills** — Codex loads `.agents/skills`, Claude loads `.claude/skills`, each with SKILL.md + scripts in one directory
- **Heartbeat in provider-specific runners, not in the agent** — agent does work, launcher handles scheduling
- **Session resumption across heartbeats** — Claude resumes via `session_id`, Codex resumes via `thread_id`
- **Append-only mailbox** — simple, auditable human-agent communication
- **Mailbox bridge + skill** — Feishu replies append into the mailbox, and the runner resumes the same session without duplicating human text into prompts
