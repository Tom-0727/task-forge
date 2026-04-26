# Engine Architecture

This document is the compact architecture map for coding agents working on the harness. Keep detailed contracts in source and tests; keep this file focused on ownership, flow, core modules, and file locations.

## 1. Ownership Model

- `engine/` is the shared runtime. It owns TypeScript source, lifecycle scripts, shared skills, templates, provider runners, bridge, and web UI.
- `platform/` is the control plane. It creates, lists, starts, stops, and inspects agents through registry data and engine lifecycle scripts.
- `deploy-agent` scaffolds a workdir, writes identity/rules/memory/mailbox files, links skills, and optionally starts the engine in the background.
- `<workdir>/` is durable per-agent state. It stores identity, Memory, mailbox, rules, provider skill/subagent directories, Runtime state, logs, pids, and wake-up markers.
- Runtime code and dependencies do not belong in workdirs. Engine dependencies live under `engine/node_modules`; compiled output lives under `engine/dist`.

## 2. Repository Layout

```text
repo-root/
  engine/
    bin/                 lifecycle scripts and migration helpers
    src/
      harness-core/      provider-neutral runtime logic
      claude/            Claude provider runtime
      codex/             Codex provider runtime and app-server client
      supervisor/        child runtime supervisor
      bridge/            Feishu mailbox bridge
      web-ui/            per-agent web UI server
      shared/            shared IO helpers used by skills/runtime
    skills/              shared skills mounted into workdirs
    templates/           workdir rules/readme/subagent templates
    scaffolds/           standalone examples/probes, not the main runtime path
  platform/              dashboard/API and registry integration
  deploy-agent           CLI scaffolder
  docs/
```

## 3. Workdir Layout

```text
<workdir>/
  AGENTS.md | CLAUDE.md          provider-native agent rules
  Runtime/
    agent.json                   identity and runtime config
    state                        running | off_hours | stopped | engine_build_failed | crashed
    last_heartbeat
    interval
    passive_mode                 presence means passive mode enabled
    claude_session_id            Claude continuation state
    codex_thread_id              Codex continuation state
    metrics.json                 heartbeat/token/compact metrics
    events.jsonl                 runtime event stream
    pending_messages/*.json      wake-up markers from mailbox/bridge/UI
    awaiting_reply/<contact>     waiting-for-human markers
    work_schedule.json
    due_reminders.json
    pids/{supervisor,runtime,bridge,web-ui}
    logs/{start,supervisor,runtime,bridge,web-ui}.log
  mailbox/
    human.jsonl
    agent.<name>.jsonl
    contacts.json
  Memory/
  todo_list/
  .agents/skills/ | .claude/skills/
  .codex/agents/ | .claude/agents/
```

`Runtime/agent.json` is the source of truth for identity. Its core fields are `schema_version`, `agent_name`, `provider`, `created_at`, `engine_version_at_create`, `interaction`, and `runtime`. Runtime provider must be `claude` or `codex`; stored interaction mode must be `web-ui`, `feishu`, or `none`. The CLI accepts `platform` only as a deploy-time alias.

## 4. Startup Flow

1. `deploy-agent` or `platform/` calls `engine/bin/start.sh --agent-dir <workdir>`.
2. `start.sh` runs `engine/bin/engine-ensure.sh`, which installs engine deps and rebuilds `engine/dist` when stale.
3. `start.sh` reads `Runtime/agent.json`, creates runtime dirs, and starts optional sidecars:
   - Feishu bridge: `engine/src/bridge/feishu.ts`
   - Web UI: `engine/src/web-ui/server.ts`
4. `start.sh` execs `engine/dist/supervisor/supervisor.js`.
5. The supervisor reads identity, writes its pid, selects the provider runtime, restarts crashes with backoff, and writes final state on exit.
6. The provider runtime runs the heartbeat loop until stopped.

Stop/status entrypoints are `engine/bin/stop.sh` and `engine/bin/status.sh`.

## 5. Heartbeat Loop

Both provider runtimes share this shape:

1. Resolve paths and load `Runtime/agent.json`.
2. Write pid, interval, heartbeat timestamp, state, events, and metrics.
3. Ask `decidePreInvoke` whether to invoke the provider or sleep.
4. If invoking, build a prompt, call the provider, then clear only unchanged pending markers from the pre-invoke snapshot.
5. If new pending messages remain, run again immediately; otherwise sleep for the configured interval with one-second pending wake-up polling.

`decidePreInvoke` uses this order:

1. Work schedule outside window: `off_hours`, long sleep until next window.
2. Clear awaiting markers for contacts that now have pending messages.
3. Awaiting reply and no pending: short sleep.
4. Passive mode and no pending: short sleep.
5. Run the todo pre-heartbeat hook.
6. Build mailbox status, pending snapshot, and prompt; invoke provider.

## 6. Core Module Map

| Module | Path | Responsibility |
|---|---|---|
| Types | `engine/src/harness-core/types.ts` | Shared runtime types and state names |
| Paths | `engine/src/harness-core/paths.ts` | Canonical path resolution for a workdir |
| Identity | `engine/src/harness-core/identity.ts` | Load/write `Runtime/agent.json`; no legacy fallback |
| State | `engine/src/harness-core/state.ts` | State, heartbeat, interval, passive-mode files |
| PID | `engine/src/harness-core/pid.ts` | Process pid guards and cleanup |
| Mailbox | `engine/src/harness-core/mailbox.ts` | Pending/awaiting markers and mailbox prompt status |
| Schedule | `engine/src/harness-core/schedule.ts` | Work-window parsing and next-window sleep |
| Todo | `engine/src/harness-core/todo.ts` | Due reminders, today todos, pre-heartbeat hook |
| Prompt | `engine/src/harness-core/prompt.ts` | Provider-neutral heartbeat prompt composition |
| Decide | `engine/src/harness-core/decide.ts` | Pre-invoke decision tree |
| Sleep | `engine/src/harness-core/sleep.ts` | Sleep with pending-message wake-up |
| Logger | `engine/src/harness-core/logger.ts` | Runtime log file plus stdout |
| Events | `engine/src/harness-core/events.ts` | Append/read `Runtime/events.jsonl` |
| Metrics | `engine/src/harness-core/metrics.ts` | Heartbeat, token, and compact metrics |
| Time | `engine/src/harness-core/time.ts` | UTC timestamp helpers |

## 7. Provider Runtimes

- Claude runtime: `engine/src/claude/runtime.ts`
  - Uses `@anthropic-ai/claude-agent-sdk`.
  - Runs in `cwd=<workdir>`.
  - Resumes with `Runtime/claude_session_id`.
  - Loads project subagents from `<workdir>/.claude/agents`.
- Codex runtime: `engine/src/codex/runtime.ts`
  - Uses `engine/src/codex/app-server-client.ts`.
  - Runs turns in `cwd=<workdir>` with Codex app-server semantics.
  - Resumes with `Runtime/codex_thread_id`.
  - Restarts the app server after invoke errors.

Provider-specific code should stay inside the provider runtime or provider client. Shared behavior belongs in `harness-core`.

## 8. Skills And Templates

- Shared skills live in `engine/skills`.
- Default skill sets are declared in `engine/skills/default.json`.
- `deploy-agent` links default skills into `.claude/skills` or `.agents/skills` based on provider.
- Skill scripts should accept `--agent-workdir <path>` and may fall back to `AGENT_DIR`.
- Workdir rules, README files, and provider subagent definitions are rendered from `engine/templates`.

After changing shared skills for already deployed agents, run:

```bash
engine/bin/refresh-skills.sh --agent-dir <workdir>
```

## 9. Platform Coupling

- Platform registry is under `~/.agent-platform/registry.json`.
- `platform/registry.py` imports agents by reading `Runtime/agent.json`.
- Platform start/stop operations should call engine lifecycle scripts, not provider runtimes directly.
- Platform UI/API may read Runtime state, logs, mailbox, metrics, and events, but should not duplicate heartbeat decision logic.

## 10. Migration And Forbidden Patterns

- Legacy workdirs are migrated by `engine/bin/migrate-workdir.sh`, backed by `engine/bin/_migrate_workdir.py`.
- Do not add compatibility fallback paths in runtime code. Migration is the compatibility boundary.
- Do not install per-agent dependencies inside workdirs.
- Do not commit `engine/dist` or `engine/node_modules`.
- Do not introduce Python runtime logic under `engine/src`; the engine runtime layer is TypeScript.
- Do not add provider-specific behavior to `harness-core` unless it is expressed as a provider-neutral interface.
