# LifeLong Running Agent Harness

## 0. Intro

LifeLong Running Agent Harness is a framework for deploying, running, and managing long-running Agents.

This project is intended to be operated on a real host, with local credentials, runtime state, logs, and per-Agent workspaces. For the first deployment, it is strongly recommended to use a coding agent to help inspect the host environment, create the target workdir, prepare platform configuration, and verify the runtime logs after startup.

## 1. Project Overview

This repository provides a Harness for long-running Agents. It separates the shared runtime from each Agent's durable workspace:

- `engine/` is the shared runtime. It owns the supervisor, provider runners, lifecycle scripts, shared skills, templates, and build output.
- `platform/` is the control plane UI/API. It creates, lists, starts, stops, and inspects Agents from one dashboard.
- `<workdir>/` is the independent workspace for one Agent. It stores that Agent's identity, rules, Memory, Mailbox, and Runtime state.

The Harness supports both Codex and Claude providers. Agents can be created and controlled from the Platform, or deployed directly from the command line with one command.

## 2. Two Ways To Use It

### Option A: Manage Agents With Platform (Recommended)

Use the Platform when you need one dashboard for multiple Agents, centralized status, Mailbox messages, and start/stop controls.

The Platform is only the control console. Starting the Platform does not mean any Agent has started running. Each Agent still runs through the shared `engine/` runtime and must be created and started separately.

### Option B: Deploy Directly With CLI

Use the CLI when you are developing the Harness itself or need to quickly launch a single test Agent.

The CLI path uses `./deploy-agent` to scaffold a workdir, seed the first mailbox instruction, and launch the shared engine supervisor for that Agent.

## 3. Core Directories And Runtime Relationship

```text
long-run-agent-harness/
  engine/                  # Shared Agent runtime and lifecycle scripts
  platform/                # Central control console UI/API
  deploy-agent             # CLI entrypoint for creating Agent workdirs
```

`platform/` is responsible for creating, viewing, starting, and stopping Agents. It stores its registry under `~/.agent-platform/registry.json` and calls the shared engine lifecycle scripts when an Agent is started or stopped.

`engine/` is the actual execution layer. It starts the supervisor, launches the provider runtime, manages heartbeats, and writes Runtime state.

`<workdir>/` is the persistent Agent workspace:

```text
<workdir>/
  Runtime/
    agent.json             # Agent identity and runtime config
    state                  # Current runtime state
    last_heartbeat         # Last heartbeat timestamp
    pids/                  # Supervisor/runtime pid files
    logs/
      start.log            # Startup logs
      supervisor.log       # Supervisor logs
      runtime.log          # Provider runtime logs
    pending_messages/      # Mailbox wake-up signals
    awaiting_reply/        # Awaiting-human markers
  AGENTS.md | CLAUDE.md    # Per-Agent behavior rules
  mailbox/                 # Append-only mailbox files
  Memory/                  # Knowledge and episode records
  .agents/ | .claude/      # Provider-specific skills and subagents
```

## 4. Quick Start

### Platform Path

1. Prepare the Platform Python environment:

```bash
cd /path/to/long-run-agent-harness
(cd platform && uv sync)
```

2. Create `platform/.env` with a Platform password:

```bash
cat > platform/.env <<'EOF'
PLATFORM_PASSWORD=change-me
EOF
```

3. Start the Platform:

```bash
bash platform/platformctl.sh start
```

4. Open the Platform UI:

```text
http://127.0.0.1:9000
```

5. Create an Agent in the web UI, then start that Agent from the Platform.

### CLI Path

```bash
./deploy-agent \
  --goal "检查自己的所有机制是否正常" \
  --first-instruction "先检查当前 workspace 的关键机制是否正常，并把发现的问题按优先级写进 mailbox" \
  --agent-name "SelfCheck" \
  --provider codex \
  --interaction none \
  --interval 8 \
  --workdir ~/agents/self-check
```

`--provider` accepts `codex` or `claude`.

`--interaction` accepts `platform`, `web-ui`, `feishu`, or `none`. `--interaction feishu` additionally requires `--feishu-app-id`, `--feishu-app-secret`, and `--feishu-chat-id`.

Tip: the first time an Agent starts, the Harness automatically runs `engine/bin/engine-ensure.sh` to install engine dependencies and build `engine/dist/` when needed. You normally do not need to run this manually.

## 5. Common Operations And Troubleshooting

Create an Agent:

- Platform: use the web UI.
- CLI: run `./deploy-agent ...`.

Start or stop an Agent:

- Platform: use the Agent controls in the web UI.
- CLI:

```bash
engine/bin/start.sh --agent-dir /abs/path/to/workdir
engine/bin/stop.sh --agent-dir /abs/path/to/workdir
```

Check Runtime status:

```bash
engine/bin/status.sh --agent-dir /abs/path/to/workdir
```

Restart the Platform:

```bash
bash platform/platformctl.sh restart
```

When something fails, check these logs first:

1. Platform foreground output or `platform/Runtime/platform.log` for Platform-level API/UI errors.
2. `<workdir>/Runtime/logs/start.log` for startup and engine bootstrap failures.
3. `<workdir>/Runtime/logs/runtime.log` for heartbeat, provider, mailbox, and execution failures.

## Requirements

- Node.js 18+ for the shared engine runtime.
- Python 3.11+ and `uv` for the Platform.
- Codex authentication for Codex Agents.
- Claude CLI credentials for Claude Agents.
