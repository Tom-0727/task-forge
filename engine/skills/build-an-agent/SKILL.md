---
name: build-an-agent
description: Build a dedicated business agent by copying the basic-agent runtime scaffold into a target workdir and customizing AGENTS.md, wake-up prompts, skills, and OS scheduling.
---

# build-an-agent

`basic-agent` is the harness scaffold for a one-shot/scheduled agent on top of `@openai/codex-sdk`. This skill copies that scaffold into a new workdir so it can become a dedicated business agent.

## When to use

Use this skill when the user needs a new agent for a stable business responsibility, fixed workflow, or recurring scheduled job.

Good fits:

- The agent should have its own name, owner, or durable business prompt.
- The behavior belongs in a dedicated `AGENTS.md`, wake-up prompt, and optional `.agents/skills/`.
- The work is broader than adding one capability to an existing agent.

Do not use it for a one-off script, a short-lived probe, or a small capability that can be added to an existing agent.

This skill does not create a new runtime mechanism. It copies the scaffold and prepares a workdir for business-specific customization.

## Build

Run the helper:

```bash
bash {skills-dir}/build-an-agent/scripts/copy.sh --dest <absolute-path-to-new-agent>
```

Useful flags: `--name <slug>`, `--no-install`.

After copying:

1. Replace `AGENTS.md` with the new agent's business-specific system prompt.
2. Leave `src/runtime/` and `src/trajectory/` alone unless you are intentionally changing the runtime contract.
3. Add capabilities as skills under `.agents/skills/<skill-name>/`; codex auto-discovers them.
4. Wire scheduling via cron (see `scripts/cron.example`) — do not add a scheduler daemon.
