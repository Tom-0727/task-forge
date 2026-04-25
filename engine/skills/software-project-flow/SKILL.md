---
name: software-project-flow
description: On-demand workflow for software project development. Use when the task is to build or substantially rework a software system/module/tool. Drives an Assume → PRD → Plan state machine, each transition gated by human approval over mailbox.
---

# software-project-flow

This skill is **on-demand**. It is NOT the default mode. Use it only when the current task needs a software-project lifecycle gate.

## How this skill works under the heartbeat model

This skill stores no internal state. Each heartbeat, follow exactly two steps:

1. **Derive the current state** purely from what you can observe — the three artifact files under `Memory/knowledge/conceptual/`, and the most recent relevant messages in mailbox.
2. **Take the action for that state.** When an artifact is finished, send a mailbox message via `mailbox-operate send --await-reply` asking the human to approve, then end the tick. The harness skips subsequent heartbeats until a reply arrives, so on the next wake-up the reply is already in mailbox — read it, judge whether it is approval, and proceed accordingly.

Approval is read semantically from the human's reply. Do not encode special keywords or markers in the request, and do not write keyword-matching code. If the reply is rejection or asks for changes, revise the artifact and send a new `--await-reply` request. The harness owns the awaiting-marker file lifecycle; the skill does not touch it.

## States

There are four states. They are derived from files + mailbox each tick; nothing is stored.

### `assume` — assumption verification (the first state)

Derivation: `assumptions.md` is missing, or any of its entries is still `unverified` / `failed`, or the file is complete but no approving human reply for it exists in mailbox yet.

Action this tick:
- Before writing or refining the file, read `references/assumptions.md` for the writing standard (structure of each assumption block, what counts as real evidence, how to handle failure).
- Identify every load-bearing assumption the project depends on — data sources required, functional interfaces / external systems that must be reachable, permissions or quotas that must hold.
- For each one, **actually run a probe** — call the API, query the data, run a small script — and record real evidence. Listing assumptions without running real verification does not count. Throwaway probe scripts are allowed and expected in this state.
- If a critical assumption fails, do NOT advance and do NOT silently work around it. Send a mailbox message describing the failure and its impact, and wait for the human to redirect.
- When all assumptions are `verified` and the file looks complete, send `--await-reply` referencing the file and end the tick.

Transition: a fresh human reply on this artifact reads as approval → next state is `prd`.

### `prd`

Derivation: `assumptions.md` has fresh approval; `prd.md` is missing, incomplete, or has not been approved.

Action this tick:
- Before writing or refining the file, read `references/prd.md` for the format and scope of the four mandatory sections.
- Write or refine `prd.md` to satisfy the four mandatory sections.
- The PRD must stay product-scoped — no technology choices, no module decomposition, no implementation-level design.
- The PRD must not exceed 100 lines. If it does, cut — do not summarise by adding new sections.
- When the four sections are complete and consistent, send `--await-reply` and end the tick.

Transition: a fresh human reply on this artifact reads as approval → next state is `plan`.

### `plan` — implementation plan

Derivation: `prd.md` has fresh approval; `implementation-plan.md` is missing, incomplete, or has not been approved.

Action this tick:
- Before writing or refining the file, read `references/implementation-plan.md` for the format (two sections: module design and execution plan).
- Write or refine `implementation-plan.md` accordingly. Keep it concise.
- When the plan is complete, send `--await-reply` and end the tick.

Transition: a fresh human reply on this artifact reads as approval → next state is `done`.

### `done`

Derivation: all three artifacts exist and each has a fresh approving human reply in mailbox.

Action this tick: this skill no longer constrains behavior. Proceed with normal implementation work.

## The three artifacts

The summary below is just enough to navigate. The full writing standard for each artifact lives under `references/` — read the relevant one before writing the corresponding file.

All output of this skill lives in exactly three files under `Memory/knowledge/conceptual/`:

- `conceptual--project--assumptions.md` — owned by state `assume`. A table of load-bearing assumptions (each with status: `unverified` / `verified` / `failed`) followed by a Detail section with the actual probe commands and observed results. An entry without real evidence does not count as `verified`.
- `conceptual--project--prd.md` — owned by state `prd`. Must contain the following four sections in this order:
  1. **Objective and Background** — what problem this solves, why now (business value).
  2. **User and Scenarios** — who uses it, in which key scenarios.
  3. **Requirement** — what features the system must provide, plus explicit boundaries. The "不做什么" list is mandatory, not optional.
  4. **Criteria** — what counts as done: indicators / test criteria / definition of success.
  The PRD must not contain architecture, module decomposition, or technology choices.
- `conceptual--project--implementation-plan.md` — owned by state `plan`. Two sections: module design (table of modules and responsibilities) and execution plan (numbered steps in order).

Each file uses the standard knowledge-note frontmatter (`name`, `description`, `kind: conceptual`). Keep them small and single-purpose.

Runtime, language, and package manager are fixed by the harness (uv + Python for Claude, Node.js for Codex) — treat them as given context, not as decisions to record. Only record technology choices the agent actually has freedom over.

## Resets

If the human explicitly instructs you to re-do a state, delete / archive the relevant artifact(s) and start over from that state. Never reset on your own judgment.
