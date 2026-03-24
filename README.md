# task-forge

Scaffold tool for creating autonomous Agent workspaces. One command creates a complete workspace with behavioral rules, memory structure, communication mailbox, and a heartbeat launcher.

Based on the design spec in [DESIGNS.md](./DESIGNS.md).

## Quick Start

Single deployment entrypoint: `bootstrap-runtime`.
One command creates workspace, installs deps, seeds goal, and starts runtime.

```bash
./bootstrap-runtime \
  --goal "Research OpenAI Agents SDK examples" \
  --agent-name "ResearchBot" \
  --provider codex \
  --interaction web-ui \
  --interval 20 \
  --workdir ~/agents/researcher
```

Then open `http://127.0.0.1:8080`.

## What Gets Created

```
<target-dir>/
  AGENTS.md          # Behavioral rules (always loaded by the agent)
  .agents/skills/    # Codex project skills
  .claude/skills/    # Claude project skills
  skills/            # Shared skill implementations
  run_claude.py      # Claude heartbeat launcher
  run_codex.mjs      # Codex heartbeat launcher (official Codex SDK)
  start-claude.sh    # One-command Claude startup
  start-codex.sh     # One-command Codex startup
  stop-agent.sh      # Stop the active runtime + bridge
  status-agent.sh    # Inspect runtime state
  requirements.txt   # Python dependencies for Claude + bridge + skills
  package.json       # Node dependency for the Codex runtime
  tool-notes/        # One file per non-native external tool
  mailbox/
    MAILBOX.jsonl    # Human-agent communication (append-only)
  Memory/
    knowledge/       # Distilled long-term knowledge
      factual/
      conceptual/
      heuristic/
      metacognitive/
    episodes/        # Bounded execution records
  Runtime/           # Scheduler state (session ID, PID, heartbeat)
```

Generated workspaces now also include:

- `mailbox_io.py` — shared append-only mailbox helper
- `mailbox_feishu_bridge.py` — optional Feishu <-> mailbox bridge
- `web_ui_server.py` — optional browser-based mailbox/status UI
- `.agents/skills/mailbox-send/` — Codex project skill entrypoint
- `.claude/skills/mailbox-send/` — Claude project skill entrypoint
- `skills/mailbox-send/scripts/` — shared mailbox-send implementation
- `mailbox_bridge.env.example` — bridge environment template

If `mailbox_bridge.env` exists, the generated runner scripts invoked by `bootstrap-runtime` will start the Feishu bridge automatically.

## Bootstrap Runtime

`bootstrap-runtime` is the only supported deployment entrypoint.
It requires an explicit interaction mode:

```bash
./bootstrap-runtime \
  --goal "Goal text" \
  --agent-name "ResearchBot" \
  --provider codex \
  --interaction feishu|web-ui \
  --interval 20 \
  --workdir /abs/path/to/runtime
```

Rules:

- `--interaction feishu`: requires `--feishu-app-id`, `--feishu-app-secret`, `--feishu-chat-id`
- `--interaction web-ui`: must not include Feishu arguments
- Feishu and Web UI are mutually exclusive in one runtime launch
- `--agent-name` is optional for first-time workspace creation; if omitted, it defaults to `basename(workdir)`
- If `workdir` already exists, `--agent-name` is ignored and the existing workspace identity is reused

## Requirements

- Node.js 18+
- Python 3.10+ and `uv` for the Claude runtime and optional Feishu bridge
- `claude` CLI installed and configured for the Claude runtime
- Codex authentication available for the Codex runtime, either via ChatGPT sign-in or API key sign-in

## Design

- **Single bootstrap deployment entrypoint** — create/start via `bootstrap-runtime`
- **Provider-specific launchers managed internally** — bootstrap orchestrates workspace runner scripts
- **Codex runtime on the official Codex SDK** — same auth model as Codex CLI, resumable threads, streamed events
- **Dual-compatible project skills** — Codex loads `.agents/skills`, Claude loads `.claude/skills`, both share the same implementation script
- **Templates as separate files** — easier to maintain than embedded strings
- **Heartbeat in provider-specific runners, not in the agent** — agent does work, launcher handles scheduling
- **Session resumption across heartbeats** — Claude resumes via `session_id`, Codex resumes via `thread_id`
- **Append-only mailbox** — simple, auditable human-agent communication
- **Mailbox bridge + skill** — Feishu replies append into the mailbox, and the runner resumes the same session without duplicating human text into prompts
