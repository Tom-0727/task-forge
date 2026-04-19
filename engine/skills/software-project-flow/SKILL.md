---
name: software-project-flow
description: On-demand workflow for software project development. Use when the task is to build or substantially rework a software system/module/tool. Enforces a PRD → Design → Implementation sequence with human approval between phases.
---

# software-project-flow

Paths below use `{skills-dir}` — resolve via the agent's rules file (CLAUDE.md → `.claude/skills`; AGENTS.md → `.agents/skills`).

This skill is **on-demand**. It is NOT the default mode. Most heartbeats do not need it.

Three sections follow, one per audience — read the one that applies to you: **Protocol** (main agent), **Planning Mode** (episode planner), **Evaluation Criteria** (episode evaluator).

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
- any task that finishes within a single heartbeat or a couple of small edits.

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

## Protocol (read by the main agent)

### Phase semantics

- `prd` — you may only produce / refine the PRD artifact. The PRD stays product-scoped (target users, problem statement, success criteria, non-goals, hard constraints) and must NOT contain architecture or technology choices.
- `design` — the PRD is locked. You may produce / refine the architecture and assumptions artifacts. You may NOT edit the PRD or write business implementation code.
- `implementation` — both approved. Normal work rules apply; this skill is done.

Runtime, language, and package manager are fixed by the harness (uv + Python for Claude, Node.js for Codex) — treat them as given context, not as decisions to record in either artifact. Only record technology choices the agent actually has freedom over.

### The three artifacts

All output of this skill lives in exactly three files under `Memory/knowledge/conceptual/`:

- `conceptual--project--prd.md` — product spec, owned by phase `prd`
- `conceptual--project--architecture.md` — technical design (module boundaries, data flow, key interfaces, technology choices with rationale), owned by phase `design`
- `conceptual--project--assumptions.md` — every load-bearing assumption extracted from PRD + architecture, each entry tracking `status` (`unverified` / `verified`), `verification` method, `evidence`, and `verified_at`, owned by phase `design`

Each file uses the standard knowledge-note frontmatter (`name`, `description`, `kind: conceptual`). Keep them small and single-purpose.

### Scope discipline while this skill is active

While in phase `prd` or `design`, the files you may create or modify are limited to:

- the three artifacts above;
- the current episode file under `Memory/episodes/YYYY/MM/`;
- the mailbox (via the mailbox-operate skill).

Any other write is out of scope and will be rejected by the evaluator.

### Phase transitions (require human approval)

Phase advances are not self-declared. For each advance:

1. When the artifact(s) for the current phase look complete, send `mailbox-operate send --await-reply` to the human referencing the artifact file(s) and asking for approval to advance.
2. When the reply arrives and is unambiguous approval, record the approving `mailbox_id` in the episode file (Outcome section) and proceed to the next phase's work.
3. Without a fresh approval message, do NOT begin the next phase's work — even if the current artifact "looks done".

### Resets

If the human explicitly instructs you to re-do the PRD or re-open design, delete / archive the relevant artifact(s) and start over from that phase. Never reset on your own judgment.

---

## Planning Mode (read by the episode planner)

Your job is to plan one phase-advancing episode, not implementation work — but only when the main agent has delegated a planning call while this skill is active.

### How to know this skill is active

Inspect `Memory/knowledge/conceptual/`:

- no `conceptual--project--prd.md` (or it is obviously a skeleton / stub) → phase `prd`
- PRD is substantive but `conceptual--project--architecture.md` / `conceptual--project--assumptions.md` are missing, empty, or skeletal → phase `design`
- both approved (per recent episodes / mailbox) and the current task is implementation → this skill is done, plan normally.

If in doubt, ask the handoff brief which phase the main agent thinks it is in, and cross-check.

### Context to load

1. Read whichever of the three artifacts already exist.
2. Read `Runtime/goal` to anchor the PRD scope.
3. Read the most recent 2–3 episodes to know what was already drafted or verified.

### Objective selection — phase = prd

- If no PRD file exists: objective is "draft the initial PRD skeleton with target users, problem statement, success criteria, non-goals, hard constraints".
- If PRD exists but a section is weak or missing: objective is to refine exactly that section, with a clear done criterion.
- If the PRD looks solid and complete: objective is "send the PRD to the human via mailbox-send --await-reply and request approval".
- If the mailbox brief reports a fresh human approval message: objective is "begin phase design — draft the architecture skeleton".

### Objective selection — phase = design

- If architecture file is empty or very thin: objective is "draft the architecture skeleton: module boundaries, data flow, key interfaces, technology choices with rationale".
- If architecture exists but assumptions file is missing or empty: objective is "extract every load-bearing assumption from the PRD and architecture into the assumptions file, each with `status: unverified`".
- If there are any `status: unverified` assumptions: objective is to verify one high-risk assumption via a concrete method — read docs, grep, run a tiny script, or fetch an authoritative URL — and record the evidence in the assumptions file. One per episode.
- If all assumptions are verified and architecture is solid: objective is "send architecture + assumptions to the human via mailbox-send --await-reply and request design approval".
- If the mailbox brief reports a fresh human approval message: objective is "begin implementation" — and this skill no longer gates the work.

### Episode scaffolding

Create the episode file normally under `Memory/episodes/YYYY/MM/`. In the Context Snapshot, always include:

- `software_project_phase: <current phase>`
- the artifact path(s) relevant to this episode

In `execution_guidance`, always include these constraints:

- "software-project-flow is active (phase=<phase>). You may only touch the three project artifacts and the current episode file. Use the `software-project-flow` skill (Protocol section) for the full rules."
- the specific artifact path to edit
- for assumption-verification episodes: name the single assumption to verify and the verification method

### Planner rules

- Never plan a phase advance unless a fresh human approval message is in the mailbox brief.
- If nothing productive can be planned, the correct objective is "confirm the outstanding await-reply is still pending and end the heartbeat" — a deliberately small no-op episode.

---

## Evaluation Criteria (read by the episode evaluator)

Apply these in addition to the normal evaluation protocol, only when the episode was carried out under this skill (its execution_guidance or Context Snapshot names `software_project_phase`).

### Scope policing (both phases)

- The episode MUST NOT have written any file outside the allowlist stated in the Protocol section. Any other writes are an automatic FAIL with a required fix to revert them.
- The episode MUST NOT have declared a phase advance unless the episode description names the specific mailbox_id of the human approval message. Open the mailbox file and verify the approval exists and is recent. If not, FAIL.

### phase = prd specific

- If the episode claims to have drafted or refined the PRD: confirm the PRD file exists at the canonical path (`Memory/knowledge/conceptual/conceptual--project--prd.md`), has the standard knowledge frontmatter, and the sections mentioned in the description actually appear in the file.
- The PRD file must NOT contain architecture details or implementation choices. If it does, FAIL with a required fix to remove them.
- The architecture and assumptions files should not yet exist. If the episode created them, FAIL.

### phase = design specific

- If the episode claims to have drafted architecture: spot-check that module boundaries, data flow, and key interfaces are actually present — not just headings with empty sections.
- If the episode claims to have verified an assumption: open the assumptions file and confirm the assumption's entry has non-empty `verification`, non-empty `evidence` (a file path, URL, or literal command output), and `verified_at` set. Empty or vague evidence is FAIL. Independently re-run the evidence check when cheap.
- If the description says the assumption was verified but the file was not updated with evidence, FAIL.
- For design-approval-request episodes: verify the mailbox actually contains a recent `--await-reply` message to the human that references the architecture and assumptions files. If not, FAIL.

### Required-fix style in this mode

Fixes here must be especially concrete: cite exact line ranges, file paths, and the exact value or command to use — not generic instructions.
