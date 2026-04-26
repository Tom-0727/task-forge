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
- any response where creating an episode and invoking planner/executor/evaluator would add more overhead than value.

## Protocol

Each advanced heartbeat runs exactly one episode composed of three phases: plan -> execute -> evaluate. Do not skip phases, and do not carry an episode across heartbeats. The main agent is the decision-information router: it keeps planner rationale, executor evidence, and evaluator judgment in its own context, while leaving raw execution noise inside the executor subagent.

Provider subagent names:

- Codex: planner `episode_planner`, executor `episode_executor`, evaluator `episode_evaluator`
- Claude: planner `episode-planner`, executor `episode-executor`, evaluator `episode-evaluator`

### Phase 1 - Plan

Plan runs in two steps: a lightweight Situation Sync by the main agent, then a handoff to the episode planner subagent.

Situation Sync:

1. Treat the heartbeat wake-up prompt as authoritative about fresh mailbox state. If it lists newly-arrived messages, run `uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --summary` once to see them all, then `uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --from <contact>` only for any message whose full text is needed. If the wake-up prompt reports no new messages, skip the mailbox entirely.
2. Treat `Due reminders this minute` and `Today's Todos` in the wake-up prompt as current pending work. Select only the relevant reminder/Todo ids for this episode; do not scan todo files unless objective selection depends on missing Todo context.
3. From working memory, recall the prior episode's outcome in one line (completed / failed + brief reason) and any open threads, constraints, or unresolved questions that files alone cannot convey.

Main -> planner handoff:

Spawn the provider's episode planner subagent with a short handoff brief: pointers and scarce facts only, not a dump. The brief should cover:

- a 1-3 line summary per newly-arrived mailbox message, each with a pointer such as `mailbox/human.jsonl` and the mailbox id; omit this if the wake-up prompt reported no new messages;
- relevant due reminders and today's Todos, with ids and one-line reason they matter; omit unrelated items;
- a one-line status of the prior episode plus its file path;
- any open threads, constraints, or in-flight commitments held in session memory that files cannot express;
- an explicit note that these are the fresh inputs for this heartbeat and older mailbox entries were handled in prior heartbeats.

Do not paste full message bodies, entire prior episodes, or the main agent's own analysis into the brief.

Planner -> main return:

The planner should return a compact, structured planning brief rather than a rigid schema. It should cover the episode path, the selected objective, why that objective was selected, any Todo/reminder ids consumed or deferred, key assumptions, execution direction, risks or stop conditions, and evidence the executor should try to produce. Treat the planner's execution guidance as the primary planning input for Phase 2, but keep enough rationale in the main context to judge whether the executor's later deviations are acceptable.

### Phase 2 - Execute

Main -> executor handoff:

Spawn the provider's episode executor subagent. Do not make the executor rediscover the planner's output. Give it an execution packet prepared by the main agent, including:

- `episode_path` and the episode objective;
- the planner's execution guidance and any planner rationale that affects execution choices;
- constraints, commitments, or risk boundaries the main agent accepts;
- the evidence that would make the episode judgeable;
- stop-and-report conditions such as external side effects, irreversible actions, material cost, permissions, or a load-bearing ambiguity.

The executor has the broadest practical execution permissions. It may inspect files, edit files, run tests or commands, use available docs/search tools, and otherwise do the concrete work needed for the episode. Boundaries are prompt-level rather than narrow tool restrictions: if an action is high-risk, irreversible, externally visible, costly, or requires human authorization, the executor stops and reports to the main agent instead of proceeding.

Executor -> main return:

The executor should return a concise execution report, not raw logs. The report should give the main agent enough decision information to route evaluation without absorbing execution noise: what changed, artifacts produced, key decisions made, deviations from the planner, verification performed, evidence pointers, unresolved ambiguity, remaining risk, and blockers. The executor should also append concise Actions Taken and Key Evidence entries to the episode file, but it must not set final `status`.

### Phase 3 - Evaluate

Main -> evaluator handoff:

Spawn the provider's episode evaluator subagent. Give it `episode_path`, the executor's execution report, and any main-agent context needed to evaluate the attempt, such as retry round, evaluator fixes already addressed, accepted constraints, or known ambiguity. The evaluator may inspect files and verify claims directly, but its primary input is the main-routed execution report rather than the executor's raw transcript.

Evaluator -> main return:

The evaluator should return a compact judgment, not a rigid schema. It should clearly state PASS or FAIL, the evidence-backed reasons, any required fixes that an executor can act on, any concrete Todo/Scheduled Task updates the main agent should make after evaluation, and any durable observations worth considering for knowledge or skill promotion.

On PASS:

- set `status: completed`;
- write a concise Outcome / Reflection section;
- mark satisfied Todos done, and create or update Todos only for concrete follow-up work that must survive beyond this heartbeat;
- end the heartbeat.

On FAIL:

- spawn the executor again with a retry packet derived from the evaluator's required fixes, the prior execution report, and any main-agent decisions;
- increment `eval_rounds`;
- re-invoke the evaluator with the updated executor report and retry context;
- stop after 3 evaluation rounds.

On 3 rounds still FAIL, or on an execution-blocking obstacle that cannot be worked around:

- set `status: failed`;
- briefly record why in Outcome;
- create a Todo or Scheduled Task only when there is a concrete future action or time-based retry;
- send a mailbox message to `human` reporting the blocker.

Regardless of verdict, if `observations` is non-empty, decide whether any deserves immediate follow-up such as `skill-creator` or a new knowledge note.

## Exit

An episode lives only inside a single heartbeat. Remaining work becomes starting context for the next advanced heartbeat's planner through concise Todo entries, Scheduled Tasks, knowledge notes, or the episode Outcome; choose the narrowest durable record that fits.
