# LifeLong Running Agent Harness

Scaffold tool for creating autonomous Agent workspaces. Each workspace is a thin shim: identity, memory, mailbox, private skills. All runtime code (supervisor, Claude/Codex runners, Feishu bridge, web UI) lives once in `engine/` and is shared across every deployed agent.

## Quick Start

```bash
./deploy-agent \
  --goal "检查自己的所有机制是否正常" \
  --first-instruction "先检查当前 workspace 的关键机制是否正常，并把发现的问题按优先级写进 mailbox" \
  --agent-name "SelfCheck" \
  --provider codex \
  --interaction web-ui \
  --web-ui-port 8888 \
  --interval 8 \
  --workdir ~/agents/self-check
```

`--interaction` accepts `web-ui`, `feishu`, or `none`. `--interaction feishu` additionally requires `--feishu-app-id`, `--feishu-app-secret`, `--feishu-chat-id`.

## Layout

```text
engine/                         # shared runtime, one install per host
  bin/                          # start.sh, stop.sh, engine-ensure.sh, refresh-skills.sh, migrate-workdir.sh, status.sh
  skills/                       # shared skills (symlinked into each workdir)
  skills/default.json           # which shared skills to link per provider
  templates/                    # agent rules / subagents / mailbox scaffolding
  src/                          # TypeScript: harness-core, claude/, codex/, supervisor/, bridge/, web-ui/
  dist/                         # tsc output (gitignored, auto-rebuilt by engine-ensure.sh)
deploy-agent                    # scaffolds a new shim workdir
platform/                       # control plane for registering + running deployed agents
```

A deployed workdir contains only:

```text
<workdir>/
  Runtime/agent.json            # identity (schema_version 1); supervisor state next to it
  Runtime/{state,last_heartbeat,pids/,logs/,pending_messages/,awaiting_reply/,...}
  CLAUDE.md | AGENTS.md         # per-agent rules (editable)
  mailbox/                      # append-only human.jsonl + per-contact jsonls + contacts.json
  Memory/{knowledge,episodes}
  .claude/skills/ | .agents/skills/
    <shared>/                   # symlinks into engine/skills/<name>
    <private>/                  # real dirs; user-owned
  .claude/agents/ | .codex/agents/
    <subagents>                 # rendered from engine/templates/agents/<provider>/
  mailbox_bridge.env            # present only when --interaction feishu
```

## Engine setup

`engine/dist/` and `engine/node_modules/` are gitignored. After `git pull`, the next `engine/bin/start.sh` invocation detects staleness and rebuilds automatically via `engine/bin/engine-ensure.sh`. To prime deps ahead of time:

```bash
engine/bin/engine-ensure.sh
```

## Migrating a legacy workdir

Workspaces created before the engine split shipped copies of `run_claude.py` / `run_codex.mjs` / `mailbox_feishu_bridge.py` / `web_ui_server.py` etc. Convert them in place with:

```bash
engine/bin/migrate-workdir.sh --agent-dir /abs/path/to/workdir             # dry-run
engine/bin/migrate-workdir.sh --agent-dir /abs/path/to/workdir --apply     # commit
```

Stop the agent first. The script writes `Runtime/agent.json`, re-renders subagents, converts shared-skill copies to symlinks, and deletes the legacy runner/bridge/UI files.

## Requirements

- Node.js 18+ (engine runtime, both providers)
- Python 3.10+ and `uv` (platform, skill scripts)
- `claude` CLI credentials for Claude provider
- Codex auth (ChatGPT sign-in or API key) for Codex provider
