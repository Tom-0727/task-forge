---
name: advanced-episode-flow
description: Default workflow for non-trivial iterative heartbeats. Use when advancing the assigned goal, continuing a task, handling a non-trivial human request, or doing work that needs an episode record and evaluator. Skip only for quick human responses, acknowledgements, status syncs, or other simple mailbox interactions.
---

# advanced-episode-flow

This skill is the default mode for normal iterative work. It is skipped only when the heartbeat's useful action is a quick human response that does not need durable episode tracking.

Use this skill for:

- advancing the assigned long-running goal;
- continuing an open thread from prior episodes;
- handling a human request that requires investigation, execution, or judgment;
- any work whose result should be reviewable, evaluated, or learned from later.

Do NOT use this skill for:

- acknowledging, answering, or clarifying a simple human message;
- short status reports;
- mailbox-only coordination that does not change project state;
- any response where creating an episode and invoking planner/evaluator would add more overhead than value.

When the current task is software project development, use `software-project-flow` inside this skill if its scope rules apply.

## Protocol

Each advanced heartbeat runs exactly one episode composed of three phases: plan -> execute -> evaluate. Do not skip phases, and do not carry an episode across heartbeats.

Provider subagent names:

- Codex: planner `episode_planner`, evaluator `episode_evaluator`
- Claude: planner `episode-planner`, evaluator `episode-evaluator`

### Phase 1 - Plan

Plan runs in two steps: a lightweight Situation Sync by the main agent, then a handoff to the episode planner subagent.

Situation Sync:

1. Treat the heartbeat wake-up prompt as authoritative about fresh mailbox state. If it lists newly-arrived messages, run `uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --summary` once to see them all, then `uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --from <contact>` only for any message whose full text is needed. If the wake-up prompt reports no new messages, skip the mailbox entirely.
2. From working memory, recall the prior episode's outcome in one line (completed / failed + brief reason) and any open threads, constraints, or unresolved questions that files alone cannot convey.

Handoff to the episode planner:

Spawn the provider's episode planner subagent with a short handoff brief: pointers and scarce facts only, not a dump. The brief must contain:

- a 1-3 line summary per newly-arrived mailbox message, each with a pointer such as `mailbox/human.jsonl` and the mailbox id; omit this if the wake-up prompt reported no new messages;
- a one-line status of the prior episode plus its file path;
- any open threads, constraints, or in-flight commitments held in session memory that files cannot express;
- an explicit note that these are the fresh inputs for this heartbeat and older mailbox entries were handled in prior heartbeats.

Do not paste full message bodies, entire prior episodes, or the main agent's own analysis into the brief.

The planner returns:

```json
{
  "episode_path": "<path>",
  "execution_guidance": "<briefing>"
}
```

Treat `execution_guidance` as the primary input for Phase 2.

### Phase 2 - Execute

Follow the planner's `execution_guidance` and carry out the work toward the episode objective.

Append only decision-relevant observations and key evidence to the episode body. Keep the file concise.

### Phase 3 - Evaluate

Spawn the provider's episode evaluator subagent. The invocation prompt must include both:

1. `episode_path`
2. A detailed description of what was actually done: actions taken, artifacts produced, evidence collected, and ambiguities noticed.

The evaluator returns:

```json
{
  "verdict": "PASS | FAIL",
  "reasons": ["..."],
  "required_fixes": ["..."],
  "observations": ["..."]
}
```

On PASS:

- set `status: completed`;
- write a concise Outcome / Reflection section;
- end the heartbeat.

On FAIL:

- address each item in `required_fixes`;
- increment `eval_rounds`;
- re-invoke the evaluator with an updated detailed description;
- stop after 3 evaluation rounds.

On 3 rounds still FAIL, or on an execution-blocking obstacle that cannot be worked around:

- set `status: failed`;
- briefly record why in Outcome;
- send a mailbox message to `human` reporting the blocker.

Regardless of verdict, if `observations` is non-empty, decide whether any deserves immediate follow-up such as `skill-creator` or a new knowledge note.

## Exit

An episode lives only inside a single heartbeat. Remaining work becomes starting context for the next advanced heartbeat's planner.
