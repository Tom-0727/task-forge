---
name: software-project-flow
description: On-demand workflow for software project development. Use when the task is to build or substantially rework a software system/module/tool. Enforces a PRD → Design → Implementation sequence with human approval between phases.
---

# software-project-flow

This skill is **on-demand**. It is NOT the default mode. Use it only when the current task needs a software-project lifecycle gate.

---

## When to use this skill

Use it when the current task is clearly software project development:

- building a new system, service, module, library, or non-trivial tool;
- a substantial rework that changes architecture or module boundaries;
- work whose outcome will be maintained long-term and whose design decisions benefit from being recorded.

Do NOT use it for:

- one-off answers, chats, status syncs, routine reports;
- small bug fixes, ad-hoc scripts, short research tasks;
- operations, data queries, information gathering;
- any task that can be completed with a couple of small edits.

When in doubt, ask the human before activating.

## How to activate

This skill has **no state file and no init command** — activation is behavioral. You are "in" the skill whenever the current task falls under the scope above and you are working on one of the three artifacts listed below.

The current phase is inferred from which artifact files exist and whether they are complete:

- PRD file missing or thin → you are in **phase prd**.
- PRD approved, architecture/assumptions missing or incomplete → you are in **phase design**.
- Both approved → you are in **implementation**; this skill is no longer gating you.

Approval is tracked via mailbox — see "Phase transitions" below.

## How to exit

You exit simply by moving into implementation work after design is approved. There is nothing to tear down.

---

## Phase semantics

- `prd` — you may only produce / refine the PRD artifact. The PRD stays product-scoped (target users, problem statement, success criteria, non-goals, hard constraints) and must NOT contain architecture or technology choices.
- `design` — the PRD is locked. You may produce / refine the architecture and assumptions artifacts. You may NOT edit the PRD or write business implementation code.
- `implementation` — both approved. Normal work rules apply; this skill is done.

Runtime, language, and package manager are fixed by the harness (uv + Python for Claude, Node.js for Codex) — treat them as given context, not as decisions to record in either artifact. Only record technology choices the agent actually has freedom over.

## The three artifacts

All output of this skill lives in exactly three files under `Memory/knowledge/conceptual/`:

- `conceptual--project--prd.md` — product spec, owned by phase `prd`
- `conceptual--project--architecture.md` — technical design (module boundaries, data flow, key interfaces, technology choices with rationale), owned by phase `design`
- `conceptual--project--assumptions.md` — every load-bearing assumption extracted from PRD + architecture, each entry tracking `status` (`unverified` / `verified`), `verification` method, `evidence`, and `verified_at`, owned by phase `design`

Each file uses the standard knowledge-note frontmatter (`name`, `description`, `kind: conceptual`). Keep them small and single-purpose.

## Scope discipline while this skill is active

While in phase `prd` or `design`, the files you may create or modify are limited to:

- the three artifacts above;
- the mailbox (via the mailbox-operate skill).

Do not change implementation files, runtime code, tests, deployment config, or unrelated knowledge notes during `prd` or `design`.

## Phase transitions

Phase advances are not self-declared. For each advance:

1. When the artifact(s) for the current phase look complete, send `mailbox-operate send --await-reply` to the human referencing the artifact file(s) and asking for approval to advance.
2. When the reply arrives and is unambiguous approval, proceed to the next phase's work.
3. Without a fresh approval message, do NOT begin the next phase's work — even if the current artifact "looks done".

Approval is tracked by the mailbox record. Before advancing, read the relevant mailbox thread and verify the approving message is fresh and unambiguous.

## Resets

If the human explicitly instructs you to re-do the PRD or re-open design, delete / archive the relevant artifact(s) and start over from that phase. Never reset on your own judgment.
