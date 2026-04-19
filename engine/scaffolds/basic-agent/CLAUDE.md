# basic-agent — Root CLAUDE.md (Decision Layer)

This is the scaffold for building a vertical-scenario agent on top of the `@openai/codex-sdk` runtime. When adapting it, fork or copy `basic-agent/`; do not turn the scaffold itself into a business-specific agent unless explicitly asked.

## Two-Layer Customization Mental Model

Customize only these two layers unless the task explicitly requires changing the runtime contract.

1. Wake-up input prompt = System Prompt layer.
   - Put durable baseline behavior in `AGENTS.md`.
   - Put trigger-specific behavior in the wake-up input prompt.
   - `src/entry/one-shot.ts` receives the wake-up prompt; `src/loaders/system-prompt.ts` composes it with `AGENTS.md`. Do not put business-specific behavior in runtime code.

2. Skills = capability extension layer.
   - To add a capability, create `.agents/skills/<skill-name>/SKILL.md`.
   - Codex auto-discovers skills placed under `.agents/skills/`; do not add runtime registration code for skills.

## Decision Rules

- Do not edit `src/runtime/` or `src/trajectory/` unless you are intentionally changing the runtime contract. Those are stable.
- Use OS scheduling. Prefer cron on Linux. Do not add a scheduler daemon. Keep every scheduler path invoking the same one-shot entry with identical `WakeUpArgs`.
- Trajectories are JSONL — one file per run, one codex event per line, verbatim pass-through.
- `basic-agent/` is not a vertical agent. Fork or clone it to make one.

## Where to look next

- `src/CLAUDE.md` — execution layer for TypeScript code inside `src/`.
- `scripts/CLAUDE.md` — execution layer for shell entries.
- `AGENTS.md` — the default durable per-agent system prompt (replace it in your fork).
