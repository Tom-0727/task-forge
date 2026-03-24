# task-forge

Scaffold tool for creating autonomous Agent workspaces. One command creates a complete workspace with behavioral rules, memory structure, communication mailbox, and a heartbeat launcher.

Based on the design spec in [DESIGNS.md](./DESIGNS.md).

## Quick Start

Simplest startup (recommended): one command creates workspace, installs deps, seeds goal, and starts runtime.

```bash
./bootstrap-runtime \
  --goal "Research OpenAI Agents SDK examples" \
  --provider codex \
  --interaction web-ui \
  --interval 20 \
  --workdir ~/agents/researcher
```

Then open `http://127.0.0.1:8080`.

Manual setup (if you want full step-by-step control):

```bash
./create-agent <target-directory> <agent-name>
```

Example:

```bash
./create-agent ~/agents/researcher ResearchBot
cd ~/agents/researcher
uv venv
uv pip install --python .venv/bin/python -r requirements.txt
./start-claude.sh
```

Or start the Codex runtime:

```bash
cd ~/agents/researcher
npm install
./start-codex.sh
```

## What Gets Created

```
<target-dir>/
  AGENTS.md          # Behavioral rules (always loaded by the agent)
  .agents/skills/    # Codex project skills
  .claude/skills/    # Claude project skills
  skills/            # Shared skill implementations
  run.py             # Claude heartbeat launcher
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

If `mailbox_bridge.env` exists, `start-claude.sh` and `start-codex.sh` will start the Feishu bridge automatically.

To enable the bridge in a generated workspace:

```bash
cp mailbox_bridge.env.example mailbox_bridge.env
./start-claude.sh
```

To run the simple Web UI in a generated workspace:

```bash
uv run --python .venv/bin/python ./web_ui_server.py --host 127.0.0.1 --port 8080
```

## Bootstrap Runtime

`bootstrap-runtime` now requires an explicit interaction mode:

```bash
./bootstrap-runtime \
  --goal "Goal text" \
  --provider codex \
  --interaction feishu|web-ui \
  --interval 20 \
  --workdir /abs/path/to/runtime
```

Rules:

- `--interaction feishu`: requires `--feishu-app-id`, `--feishu-app-secret`, `--feishu-chat-id`
- `--interaction web-ui`: must not include Feishu arguments
- Feishu and Web UI are mutually exclusive in one runtime launch

## Runtime Launchers

```
./start-claude.sh [run.py options...]
./start-codex.sh [run_codex.mjs options...]
./status-agent.sh
./stop-agent.sh
```

Claude runner options:

- `--interval` (optional): Heartbeat interval in minutes (default: 20)
- `--max-turns` (optional): Max agent turns per heartbeat (default: 50)
- `--max-budget` (optional): Max USD budget per heartbeat (default: 5.0)

Codex runner options:

- `--interval` (optional): Heartbeat interval in minutes (default: 20)
- `--model` (optional): Codex model override
- `--reasoning-effort` (optional): `minimal|low|medium|high|xhigh` (default: `medium`)
- `--sandbox` (optional): `read-only|workspace-write|danger-full-access` (default: `danger-full-access`)
- `--approval-policy` (optional): `never|on-request|on-failure|untrusted` (default: `never`)
- `--network-access` (optional): `true|false` (default: `true`)
- `--web-search-mode` (optional): `disabled|cached|live`

The Codex runtime persists the active thread ID in `Runtime/codex_thread_id`, relies on Codex's own thread storage under `~/.codex/sessions`, and writes the streamed event trace to `Runtime/codex_events.jsonl`.

## Requirements

- Node.js 18+
- Python 3.10+ and `uv` for the Claude runtime and optional Feishu bridge
- `uv pip install --python .venv/bin/python -r requirements.txt` for the Claude runtime and bridge
- `npm install`
- `claude` CLI installed and configured for the Claude runtime
- Codex authentication available for the Codex runtime, either via ChatGPT sign-in or API key sign-in

## Design

- **Separate Claude and Codex runtime entrypoints** — one workspace, two launch paths
- **One-command startup scripts** — launch runtime and optional bridge together
- **Codex runtime on the official Codex SDK** — same auth model as Codex CLI, resumable threads, streamed events
- **Dual-compatible project skills** — Codex loads `.agents/skills`, Claude loads `.claude/skills`, both share the same implementation script
- **Templates as separate files** — easier to maintain than embedded strings
- **Heartbeat in provider-specific runners, not in the agent** — agent does work, launcher handles scheduling
- **Session resumption across heartbeats** — Claude resumes via `session_id`, Codex resumes via `thread_id`
- **Append-only mailbox** — simple, auditable human-agent communication
- **Mailbox bridge + skill** — Feishu replies append into the mailbox, and the runner resumes the same session without duplicating human text into prompts
