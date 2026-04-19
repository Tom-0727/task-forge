# Engine Architecture (B2)

This document is the execution contract for refactoring the harness into a shim-based engine with a unified TypeScript runtime layer. It is written for coding agents implementing M0 through M6. No justification prose — only contracts, schemas, and rules.

## 1. Scope rules

- Repository root `/home/ubuntu/agents/long-run-agent-harness` is the engine root. `git pull` is the only upgrade action.
- `workdir` = an individual agent's directory. Contains identity + state + mailbox + memory only. No code, no deps.
- `engine/` (repo-relative) = source, build artifacts, shared skills, shared templates, shared bin scripts.
- Python is retained for skill scripts and `platform/`. Node/TS is the only language for the runtime layer (engine/).
- No backwards-compat code. Old workdirs either keep running under the legacy `providers/` path until M6, or are migrated in M5. Nothing in between.

## 2. Directory layout

```
repo-root/
  engine/
    package.json              single TS project, npm
    package-lock.json
    tsconfig.json
    node_modules/             gitignored, created by engine-ensure.sh
    dist/                     gitignored, created by engine-ensure.sh (tsc -p .)
    src/
      harness-core/
        types.ts
        paths.ts
        identity.ts
        state.ts
        pid.ts
        mailbox.ts
        schedule.ts
        todo.ts
        prompt.ts
        decide.ts
        logger.ts
        index.ts
      shared/
        mailbox-io.ts
      supervisor/
        supervisor.ts
      claude/
        runtime.ts
      codex/
        runtime.ts
      bridge/
        feishu.ts
      web-ui/
        server.ts
    bin/
      engine-ensure.sh        idempotent; installs deps + builds dist if stale
      start.sh                entry; dispatches to runtime + optional bridge/web-ui
      stop.sh
      status.sh
      migrate-workdir.sh
      refresh-skills.sh
    skills/                   shared skills, not templated
      mailbox-operate/
        SKILL.md
        scripts/*.py
      todo/
        SKILL.md
        scripts/*.py
      software-project-flow/
        SKILL.md
      default.json            { "claude": [...], "codex": [...] }
    templates/
      CLAUDE.md.tmpl
      AGENTS.md.tmpl
      MAILBOX.jsonl.tmpl
      memory-knowledge-README.md.tmpl
      memory-episodes-README.md.tmpl
      mailbox-README.md.tmpl
      tool-notes-README.md.tmpl
  platform/                   unchanged except registry.import_agent
  deploy-agent                rewritten (shell)
  docs/
  README.md
  CLAUDE.md
```

Deleted in M6: `providers/`, `shared/`, `update-runtime`, all `.tmpl` outside `engine/templates/`.

## 3. workdir layout (post-shim)

```
<agent-workdir>/
  start.sh                    shim, one line: exec <engine>/bin/start.sh --agent-dir ...
  stop.sh                     shim
  status.sh                   shim
  CLAUDE.md | AGENTS.md       rendered once at deploy, never overwritten
  mailbox/
    human.jsonl
    agent.<name>.jsonl
    contacts.json
  Memory/
    knowledge/
    episodes/
  tool-notes/
  scheduled_tasks.json
  todo_list/
  mailbox_bridge.env          only if interaction=feishu
  Runtime/
    agent.json                identity (immutable section + mutable runtime section)
    pid
    state                     "running" | "off_hours" | "stopped" | "engine_build_failed" | "crashed"
    last_heartbeat
    interval
    claude_session_id | codex_thread_id
    passive_mode              presence = enabled
    work_schedule.json
    pending_messages/*.json
    awaiting_reply/<contact>  presence = awaiting
    due_reminders.json
    codex_events.jsonl        codex only
    pids/
      runtime
      bridge
      web-ui
      supervisor
    logs/
      runtime.log
      bridge.log
      web-ui.log
      supervisor.log
  .claude/skills/ | .agents/skills/
    mailbox-operate -> <engine>/skills/mailbox-operate                 symlink
    todo -> <engine>/skills/todo                                       symlink
    software-project-flow -> <engine>/skills/software-project-flow     symlink
    <private-skill>/                                                    real directory
```

Forbidden in workdir after M6: `run_*.py`, `run_*.mjs`, `mailbox_io.*`, `web_ui_server.*`, `mailbox_feishu_bridge.*`, `.venv/`, `node_modules/`, `package.json`, `requirements.txt`, `Runtime/runtime_provider`, `Runtime/agent_name`, `Runtime/interaction_mode`, `Runtime/goal`.

## 4. Runtime/agent.json schema

```json
{
  "schema_version": 1,
  "agent_name": "ResearchBot",
  "provider": "claude",
  "created_at": "2026-04-19T10:00:00Z",
  "engine_version_at_create": "0.5.2",
  "interaction": {
    "mode": "web-ui",
    "web_ui_port": 8888,
    "feishu": {
      "app_id_env": "FEISHU_APP_ID",
      "chat_id": "oc_xxx"
    }
  },
  "runtime": {
    "default_interval_minutes": 20,
    "default_max_turns": 50,
    "default_max_budget_usd": 5.0
  }
}
```

Immutable: `schema_version`, `agent_name`, `provider`, `created_at`, `engine_version_at_create`.
Mutable by platform: `interaction.web_ui_port`, `runtime.*`.
`interaction.mode` ∈ `{"web-ui", "feishu", "none"}`. `feishu` subobject required iff `mode == "feishu"`.

## 5. harness-core module contracts

TypeScript, strict. All functions pure except where state is noted.

### types.ts

```ts
export interface AgentIdentity { /* matches Runtime/agent.json */ }
export interface AgentPaths {
  agentDir: string;
  runtimeDir: string;
  pidFile: string; stateFile: string; heartbeatFile: string;
  intervalFile: string; passiveModeFile: string;
  sessionIdFile: string; threadIdFile: string;
  pendingDir: string; awaitingDir: string;
  workScheduleFile: string;
  dueRemindersFile: string; codexEventsFile: string;
  pidsDir: string; logsDir: string;
  mailboxDir: string; memoryDir: string;
  skillsDir: string;                   // .claude/skills or .agents/skills
  skillsTodoPreHeartbeat: string;
}
export interface WorkSchedule { timezone: string; windows: Array<{ days: number[]; start: string; end: string; }>; }
export interface PendingMessage { mailbox_id: string; [k: string]: unknown; }
export interface TodoItem { id: string; title: string; description?: string; done?: boolean; subtasks?: Array<{text: string; done?: boolean}>; }
export interface ScheduledTask { id: string; title: string; description?: string; subtasks?: Array<{text: string}>; }
export type HeartbeatAction = "invoke" | "skip_short_sleep" | "skip_long_sleep";
export interface HeartbeatDecision {
  action: HeartbeatAction;
  reason?: "off_hours" | "awaiting" | "passive";
  prompt?: string;
  pendingSnapshot?: Record<string, string>;
  sleepMinutes?: number;
  sleepSeconds?: number;
  stateUpdate: "running" | "off_hours";
}
```

### paths.ts

```ts
export function resolvePaths(agentDir: string): AgentPaths;
```

Skill dir resolution: if `<agentDir>/.claude/skills` exists use that; else `<agentDir>/.agents/skills`.

### identity.ts

```ts
export function loadIdentity(paths: AgentPaths): AgentIdentity;
export function writeIdentity(paths: AgentPaths, id: AgentIdentity): void;
```

Missing or malformed `agent.json` → throw. No legacy-file fallback.

### state.ts

```ts
export function writeState(p: AgentPaths, s: "running" | "off_hours" | "stopped" | "engine_build_failed" | "crashed"): void;
export function writeHeartbeat(p: AgentPaths): void;
export function readInterval(p: AgentPaths, fallback: number): number;
export function writeInterval(p: AgentPaths, min: number): void;
export function isPassiveMode(p: AgentPaths): boolean;
```

### pid.ts

```ts
export function checkAndWritePid(p: AgentPaths, processName: "runtime" | "supervisor" | "bridge" | "web-ui"): void;
export function cleanupPid(p: AgentPaths, processName: string): void;
```

Dual-PID semantics: supervisor holds `Runtime/pids/supervisor` and `Runtime/pid` (legacy single-pid contract for platform). Runtime child holds only `Runtime/pids/runtime`. On supervisor exit: cleanup both `pid` and `pids/supervisor` and write `state=stopped`.

### mailbox.ts

```ts
export function hasAnyPending(p: AgentPaths): boolean;
export function hasAnyAwaiting(p: AgentPaths): boolean;
export function loadPendingMessages(p: AgentPaths): Record<string, PendingMessage>;
export function collectSnapshot(p: AgentPaths): Record<string, string>;
export function clearUnchangedPending(p: AgentPaths, snapshot: Record<string, string>): void;
export function clearAwaitingForPending(p: AgentPaths): void;
export function buildMailboxStatus(p: AgentPaths): string;
```

### schedule.ts

```ts
export function loadWorkSchedule(p: AgentPaths): WorkSchedule | null;
export function isInWorkWindow(s: WorkSchedule, now?: Date): boolean;
export function secondsUntilNextWindow(s: WorkSchedule, now?: Date): number;
```

Minimum return from `secondsUntilNextWindow` is 60.

### todo.ts

```ts
export function renderDueRemindersSection(p: AgentPaths): string;
export function renderTodayTodosSection(p: AgentPaths, today?: Date): string;
export function runPreHeartbeatHook(p: AgentPaths): void; // subprocess skills/todo/scripts/pre_heartbeat.py
```

Hook spawns `uv run python <hook> --agent-workdir <agentDir>`, timeout 15s, stdio ignored, env `AGENT_DIR=<agentDir>`. Never throws.

### prompt.ts

```ts
export function buildPrompt(
  p: AgentPaths,
  id: AgentIdentity,
  opts: { firstHeartbeat: boolean; mailboxStatus: string }
): string;
```

Composition order (join with `\n\n`, drop empty segments):

1. due reminders section
2. today's todos section
3. body (mailbox-prompt | first-heartbeat-prompt | heartbeat-prompt)
4. `Working directory: <agentDir>`

Body templates live in prompt.ts as string constants. Placeholders are agent name, provider-specific skill invocation lines.

### decide.ts

```ts
export function decidePreInvoke(
  p: AgentPaths,
  id: AgentIdentity,
  firstHeartbeat: boolean
): HeartbeatDecision;
```

Decision order:

1. Load schedule. If present and not in window → `skip_long_sleep` with `secondsUntilNextWindow`, `stateUpdate: "off_hours"`.
2. `clearAwaitingForPending(p)`.
3. If `hasAnyAwaiting && !hasAnyPending` → `skip_short_sleep`, `reason: "awaiting"`, `sleepMinutes = readInterval`.
4. If `isPassiveMode && !hasAnyPending` → `skip_short_sleep`, `reason: "passive"`, `sleepMinutes = readInterval`.
5. `runPreHeartbeatHook(p)`.
6. Build mailbox status, pending snapshot, prompt. Return `invoke` with `stateUpdate: "running"`.

### logger.ts

```ts
export interface Logger { info(msg: string): void; warn(msg: string): void; error(msg: string): void; }
export function createLogger(paths: AgentPaths, processName: string): Logger;
```

Each call writes `[<UTC ISO>] <msg>\n` to `Runtime/logs/<processName>.log` and stdout.

## 6. Supervisor contract

File: `engine/src/supervisor/supervisor.ts`. Invoked by `engine/bin/start.sh`.

CLI: `supervisor --agent-dir <path>`. Reads `Runtime/agent.json` to pick the runtime module (`claude/runtime.js` or `codex/runtime.js`).

State machine:

- Call `engine-ensure.sh` before first spawn. On non-zero exit: write `state=engine_build_failed`, log, exit 1.
- Spawn runtime as child, inherit env with `AGENT_DIR=<agentDir>`.
- Wait for child exit.
- Exit codes:
  - `0` → clean shutdown. Supervisor writes `state=stopped`, cleanup pids, exit 0.
  - `42` → reserved, NOT used in this version (hot reload deferred). Treat as crash for now.
  - any other → crash. Exponential backoff (10s, 30s, 120s, 600s, 600s...). After 10 consecutive crashes write `state=crashed` and exit 1.
- Traps SIGTERM/SIGINT, forwards to child, waits up to 30s, then SIGKILL.

Restart semantics: engine upgrades take effect on `stop.sh` + `start.sh` cycle. No in-process hot reload.

## 7. Runtime main-loop contract

Both `claude/runtime.ts` and `codex/runtime.ts` implement this skeleton:

```
init:
  paths = resolvePaths(argv.agentDir)
  id = loadIdentity(paths)
  logger = createLogger(paths, "runtime")
  checkAndWritePid(paths, "runtime")
  install SIGTERM/SIGINT handlers → graceful exit 0
  firstHeartbeat = (session/thread id file absent)

loop:
  decision = decidePreInvoke(paths, id, firstHeartbeat)
  writeHeartbeat(paths); writeState(paths, decision.stateUpdate)
  switch decision.action:
    skip_long_sleep:
      sleep(decision.sleepSeconds) with pending-wakeup poll
      continue
    skip_short_sleep:
      sleep(decision.sleepMinutes * 60) with pending-wakeup poll
      continue
    invoke:
      try: callProviderSDK(decision.prompt, id)
      finally: clearUnchangedPending(paths, decision.pendingSnapshot)
      firstHeartbeat = false
      if hasAnyPending: continue immediately
      sleep(readInterval(paths) * 60) with pending-wakeup poll
```

`callProviderSDK` is the only provider-specific function. Shape:

```ts
async function callProviderSDK(prompt: string, id: AgentIdentity): Promise<void>;
```

### Claude SDK invocation

- Package: `@anthropic-ai/claude-agent-sdk`.
- Options: `cwd=agentDir`, `allowedTools=["Read","Write","Edit","Bash","Glob","Grep","WebSearch","WebFetch","Agent"]`, `maxTurns=id.runtime.default_max_turns`, `maxBudgetUsd=id.runtime.default_max_budget_usd`, `permissionMode="bypassPermissions"`, `resume=<session_id if present>`.
- On `ResultMessage.session_id`: write to `Runtime/claude_session_id`.

### Codex SDK invocation

- Package: `@openai/codex-sdk`.
- Thread options: `workingDirectory=agentDir`, `skipGitRepoCheck=true`, `sandboxMode="danger-full-access"`, `approvalPolicy="never"`, `modelReasoningEffort="medium"`, `networkAccessEnabled=true`. Arg overrides from `--model`, `--reasoning-effort`, `--sandbox`, `--approval-policy`, `--network-access`, `--web-search-mode` respected.
- On `thread.started`: write thread_id to `Runtime/codex_thread_id`.
- Append every SDK event to `Runtime/codex_events.jsonl`.

## 8. Pending-wakeup sleep

```ts
export async function sleepWithWakeup(paths: AgentPaths, seconds: number, shouldStop: () => boolean): Promise<void>;
```

Polls `hasAnyPending(paths)` every second. Returns early when pending or `shouldStop()` is true.

## 9. engine-ensure.sh contract

```
inputs:  <engine-root> (inferred from script path)
checks:
  1. node_modules exists and package-lock.json not newer than node_modules/.package-lock.json marker
     → if stale: run `npm ci`
  2. dist/ exists and every src/**/*.ts has mtime <= dist/.build-stamp
     → if stale: run `npx tsc -p .` then `touch dist/.build-stamp`
exit:
  0 on success (including no-op)
  non-zero on any failure (do NOT overwrite existing dist/ or node_modules on failure)
```

Locking: use `flock /tmp/harness-engine-ensure.lock` to serialize concurrent ensures across agents.

## 10. start.sh / stop.sh / status.sh contract

### engine/bin/start.sh

```
args: --agent-dir <path>
steps:
  1. engine-ensure.sh (exit 1 if fails; write state=engine_build_failed)
  2. mkdir -p $AGENT_DIR/Runtime/{pids,logs}
  3. read provider, interaction from Runtime/agent.json (via jq or node one-liner)
  4. if interaction.mode=feishu and mailbox_bridge.env exists: fork bridge
       node <engine>/dist/bridge/feishu.js --agent-dir $AGENT_DIR
       stdout/err → Runtime/logs/bridge.log; pid → Runtime/pids/bridge
  5. if interaction.mode=web-ui: fork web-ui
       node <engine>/dist/web-ui/server.js --agent-dir $AGENT_DIR --port <port>
       stdout/err → Runtime/logs/web-ui.log; pid → Runtime/pids/web-ui
  6. fork supervisor (foreground? see below)
       node <engine>/dist/supervisor/supervisor.js --agent-dir $AGENT_DIR
       stdout/err → Runtime/logs/supervisor.log; pid → Runtime/pids/supervisor
  7. when supervisor exits, kill bridge + web-ui, exit with supervisor's exit code
```

Foreground vs background: start.sh runs supervisor in foreground (blocks). `deploy-agent` nohups the whole `start.sh` invocation if needed, same pattern as today.

### engine/bin/stop.sh

```
args: --agent-dir <path>
for each pidfile in Runtime/pids/*:
  send SIGTERM, wait up to 30s, SIGKILL if still alive
remove pidfiles; write state=stopped
```

### engine/bin/status.sh

Reads `Runtime/state`, `Runtime/last_heartbeat`, `Runtime/pids/*`, prints a compact table.

## 11. Workdir shim contract

```
start.sh:
  #!/bin/bash
  exec <engine>/bin/start.sh --agent-dir "$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

stop.sh:
  #!/bin/bash
  exec <engine>/bin/stop.sh --agent-dir "$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

status.sh:
  #!/bin/bash
  exec <engine>/bin/status.sh --agent-dir "$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
```

`<engine>` is replaced with the absolute engine path at deploy-time (hardcoded, no env resolution).

## 12. Skill mounting rules

### Default set

`engine/skills/default.json`:

```json
{
  "claude": ["mailbox-operate", "todo", "software-project-flow"],
  "codex":  ["mailbox-operate", "todo", "software-project-flow"]
}
```

### deploy-agent behavior

For provider `P`, for each name `N` in `default.json[P]`:

- target: `<workdir>/.claude/skills/N` (claude) or `<workdir>/.agents/skills/N` (codex)
- action: `ln -sfn <engine>/skills/N <target>`
- if `<target>` already exists as real directory: leave untouched (private skill protection)

### refresh-skills.sh

Input: none. Reads `~/.agent-platform/registry.json`, iterates each workdir, applies the same link logic as deploy-agent. Additionally removes dangling symlinks under `.claude/skills` or `.agents/skills` that point nowhere.

### Skill scripts (engine/skills/*/scripts/*.py)

Uniform rule: accept agent dir via `--agent-workdir <path>`; if absent, fall back to `$AGENT_DIR` env var; if neither, exit 2 with error message. No `{{AGENT_NAME}}`, no `{{RULES_FILENAME}}` substitutions — any per-agent info comes from reading `Runtime/agent.json`.

## 13. deploy-agent contract

Shell script, ≤300 lines. Steps:

1. Parse CLI (goal, first-instruction, agent-name, provider, interaction, web-ui-port, feishu-*, interval, workdir, work-schedule).
2. Validate: `--interaction feishu` requires feishu args; `--interaction web-ui` forbids them; workdir is absolute.
3. Create workdir skeleton: `mailbox/`, `Memory/knowledge/`, `Memory/episodes/`, `tool-notes/`, `Runtime/`, `Runtime/pids/`, `Runtime/logs/`, `todo_list/`, `.claude/skills/` or `.agents/skills/`.
4. Write `Runtime/agent.json` (immutable + mutable fields).
5. Render `CLAUDE.md` or `AGENTS.md` from `engine/templates/*.md.tmpl` (substitute AGENT_NAME, GOAL, CREATED_AT). Render README files for `Memory/knowledge/`, `Memory/episodes/`, `mailbox/`, `tool-notes/`.
6. Seed first instruction to `mailbox/human.jsonl`.
7. Create `mailbox/contacts.json` with `human` entry.
8. For feishu: write `mailbox_bridge.env` from CLI args.
9. Create skill symlinks per §12.
10. Write `start.sh`, `stop.sh`, `status.sh` shims (§11).
11. Call `python <repo>/platform/registry.py register ...` (or inline registry write) to register in `~/.agent-platform/registry.json`.
12. `exec <workdir>/start.sh` in background (nohup + disown), print PID and log path.

No venv creation, no npm install inside workdir.

## 14. Migration contract (migrate-workdir.sh)

Shell script, M5/M6 deliverable.

```
usage: migrate-workdir.sh [--apply] <workdir>
default: dry-run prints every file that will be created, deleted, replaced
```

Preconditions: `Runtime/pid` absent OR pid is not running. Otherwise abort with clear error.

Steps:

1. Infer identity:
   - `agent_name` from `Runtime/agent_name` or basename(workdir)
   - `provider` from `Runtime/runtime_provider` (must be "claude" or "codex")
   - `interaction` from `Runtime/interaction_mode` or registry entry
   - `web_ui_port`, `feishu_*` from registry if available
   - `created_at` from registry, else now
2. Write `Runtime/agent.json`.
3. For each shared skill in `default.json[provider]`: compare `<workdir>/.claude/skills/N` against `<engine>/skills/N` via content hash. If identical → delete real dir, create symlink. If different → leave as real dir, log warning "preserved as private-overlay".
4. Delete: `run_*.py`, `run_*.mjs`, `mailbox_io.*`, `web_ui_server.*`, `mailbox_feishu_bridge.*`, `package.json`, `requirements.txt`, `.venv/`, `node_modules/`, `start-claude.sh`, `start-codex.sh`, `Runtime/runtime_provider`, `Runtime/agent_name`, `Runtime/interaction_mode`, `Runtime/goal`.
5. Write new `start.sh`, `stop.sh`, `status.sh` shims.
6. Print post-migration start command.

Dry-run exits 0 without touching anything. `--apply` runs the actions.

## 15. Platform coupling changes

Only `platform/registry.py` changes. `platform/platform_server.py` and `platform/usage.py` unchanged.

### registry.py.import_agent — new behavior

Read `Runtime/agent.json` only. If missing → return None (no fallback to legacy files). The old four-file path (`runtime_provider`, `agent_name`, `interaction_mode`, `goal`) is removed in M3.

### registry.py.register_agent — unchanged signature

But `deploy-agent` now calls it directly with all fields; no longer depends on `Runtime/*` side-effect files.

## 16. Non-goals and forbidden patterns

- No hot reload. Engine updates require `stop.sh` + `start.sh`.
- No `dist/` in git. `engine-ensure.sh` rebuilds on demand.
- No compatibility shims. Old workdirs use old code path until migrated; no "try new, fallback to old" logic anywhere.
- No Python harness-core. TS only for engine runtime layer.
- No per-agent dependency install. All agents share `engine/node_modules`.
- No TypeScript runtime (tsx/ts-node). Always compile to `dist/` then run with `node`.
- No emoji in committed files.
- No `{{...}}` placeholders outside `engine/templates/*.tmpl`.

## 17. Milestones

| M  | Scope                                                                 | Verification                                              |
|----|-----------------------------------------------------------------------|-----------------------------------------------------------|
| M0 | This doc, README note, .gitignore entries                             | doc merged                                                |
| M1 | engine skeleton, harness-core, supervisor, claude/runtime.ts, shared/mailbox-io.ts, bin/*, skills/ copied from shared/, templates/ copied from shared/, engine-ensure.sh | new claude agent (shim) runs 3 heartbeats end-to-end      |
| M2 | codex/runtime.ts                                                      | new codex agent (shim) runs 3 heartbeats end-to-end       |
| M3 | deploy-agent rewrite, registry.import_agent reads agent.json, skills symlink flow, skill scripts read AGENT_DIR | new deploy of both providers works; change to engine/src/harness-core/mailbox.ts takes effect on next stop+start of agent with zero file copy |
| M4 | bridge/feishu.ts, web-ui/server.ts, start.sh fork logic              | feishu bridge and web-ui work for new agents              |
| M5 | migrate-workdir.sh with dry-run                                       | dry-run output reviewed for every deployed agent          |
| M6 | Apply migrations, delete providers/, shared/, update-runtime         | `grep -r '{{AGENT_NAME}}'` hits only engine/templates/    |

## 18. Open items that the implementing agent resolves without asking

- Exact tsc target: `ES2022`, module `NodeNext`, strict.
- Package manager: npm (not pnpm, not yarn).
- Node version: match what's on the box; document in engine/package.json `engines` field.
- Shell: bash. Scripts start with `#!/bin/bash` and `set -euo pipefail`.
- JSON reads in shell: prefer `node -e` one-liners over jq to avoid adding a dep.
- Log timestamps: UTC ISO with Z suffix, milliseconds stripped.
