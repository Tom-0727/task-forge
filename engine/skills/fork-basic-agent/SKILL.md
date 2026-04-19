---
name: fork-basic-agent
description: Fork the basic-agent scaffold (a codex-sdk-based runtime) into a new directory to build a vertical-scenario agent. Use when the task requires spawning a standalone child agent with its own lifecycle, mailbox, memory, trajectories, and schedule.
---

# fork-basic-agent

`basic-agent` is a scaffold shipped with the harness. It is the recommended starting point whenever you need to stand up a new vertical agent on top of `@openai/codex-sdk`. The scaffold lives at `{engine-root}/scaffolds/basic-agent/` — the helper script below resolves that path for you.

## When to use

Fork the scaffold when ALL of the following hold:

- The task calls for a persistent agent with its own durable identity (AGENTS.md, mailbox, schedule), not a one-shot script.
- The new agent has a different name or different human owner than any existing agent.
- Its capabilities are unrelated to any current agent's wake-up prompt.

Do NOT fork if:

- You only need to add a new capability to an existing agent — add a skill under that agent's `.agents/skills/<name>/` instead.
- The work is a single shell/Python script or a short-lived probe.
- You are unsure whether a new agent is warranted — ask the human first.

Rule of thumb: if you would give this agent a different name or a different human owner, fork.

## How to fork

Run the helper from the skill directory. It copies the scaffold (source only, no `dist/` or `node_modules/`) to `<dest>` and, unless `--no-install` is passed, runs `npm install && npm run build` inside the copy.

```bash
bash {skills-dir}/fork-basic-agent/scripts/fork.sh --dest <absolute-path-to-new-agent>
```

Optional flags:

- `--no-install` — skip `npm install && npm run build`; use when you only need the source tree (e.g. you are going to edit `package.json` before installing).
- `--name <slug>` — write `<slug>` into the forked `package.json`'s `name` field (default: basename of `--dest`).

After forking:

1. Replace `AGENTS.md` with the new agent's business-specific system prompt.
2. Leave `src/runtime/` and `src/trajectory/` alone unless you are intentionally changing the runtime contract.
3. Add capabilities as skills under `.agents/skills/<skill-name>/`; codex auto-discovers them.
4. Wire scheduling via cron (see `scripts/cron.example`) — do not add a scheduler daemon.

`{skills-dir}` resolves via the agent's rules file: CLAUDE.md → `.claude/skills`, AGENTS.md → `.agents/skills`.
