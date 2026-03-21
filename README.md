# task-forge

Scaffold tool for creating autonomous Agent workspaces. One command creates a complete workspace with behavioral rules, memory structure, communication mailbox, and a heartbeat launcher script.

Based on the design spec in [DESIGNS.md](./DESIGNS.md).

## Quick Start

```bash
./create-agent <target-directory> <agent-name>
```

Example:

```bash
./create-agent ~/agents/researcher ResearchBot
cd ~/agents/researcher
./run.sh --runtime claude
```

## What Gets Created

```
<target-dir>/
  AGENTS.md          # Behavioral rules (always loaded by the agent)
  TOOLS.md           # External tool documentation
  MAILBOX.jsonl      # Human-agent communication (append-only)
  run.sh             # Heartbeat launcher script
  Memory/
    knowledge/       # Distilled long-term knowledge
      factual/
      conceptual/
      heuristic/
      metacognitive/
    episodes/        # Bounded execution records
  skills/            # Reusable executable capabilities
  Runtime/           # Scheduler state
```

## run.sh Options

```
./run.sh --runtime codex|claude [--interval N]
```

- `--runtime` (required): Which runtime to use — `codex` or `claude`
- `--interval` (optional): Heartbeat interval in minutes (default: 20)

## Requirements

- bash
- sed (macOS built-in)
- `codex` or `claude` CLI installed and configured

## Design

- **Pure bash, zero dependencies** — only needs bash + sed + codex/claude CLI
- **Templates as separate files** — easier to maintain than heredocs embedded in script
- **Heartbeat in run.sh, not in the agent** — agent does work, shell handles scheduling
- **Append-only mailbox** — simple, auditable human-agent communication
