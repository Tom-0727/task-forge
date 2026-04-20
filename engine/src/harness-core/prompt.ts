import type { AgentIdentity, AgentPaths } from "./types.js";
import { renderDueRemindersSection, renderTodayTodosSection } from "./todo.js";

export interface BuildPromptOpts {
  firstHeartbeat: boolean;
  mailboxStatus: string;
}

export function buildPrompt(
  paths: AgentPaths,
  identity: AgentIdentity,
  opts: BuildPromptOpts
): string {
  const due = renderDueRemindersSection(paths);
  const todos = renderTodayTodosSection(paths);
  const rulesFile = identity.provider === "claude" ? "CLAUDE.md" : "AGENTS.md";
  const skillsDirHint = identity.provider === "claude" ? ".claude/skills" : ".agents/skills";

  const body = opts.mailboxStatus
    ? mailboxBody(opts.mailboxStatus, skillsDirHint)
    : opts.firstHeartbeat
      ? firstHeartbeatBody(identity.agent_name, rulesFile, skillsDirHint)
      : normalHeartbeatBody(identity.agent_name, rulesFile);

  const segments = [due, todos, body.trim(), `Working directory: ${paths.agentDir}`];
  return segments.filter((s) => s && s.length > 0).join("\n\n");
}

function mailboxBody(mailboxStatus: string, skillsDir: string): string {
  return [
    "New mailbox messages have arrived.",
    "",
    mailboxStatus,
    "",
    `1. Run: uv run python ${skillsDir}/mailbox-operate/scripts/read_mailbox.py --summary`,
    `2. Read messages from contacts with unread messages using read_mailbox.py --from <contact>`,
    ...workflowRoutingLines(),
    `To reply, use ${skillsDir}/mailbox-operate/scripts/send_mailbox.py --to <contact> --message "..."`,
  ].join("\n");
}

function firstHeartbeatBody(agentName: string, rulesFile: string, skillsDir: string): string {
  return [
    `You are ${agentName}. This is your first heartbeat.`,
    "",
    `Read ${rulesFile} to understand your behavioral rules.`,
    `Read your mailbox: uv run python ${skillsDir}/mailbox-operate/scripts/read_mailbox.py`,
    "If you need to pause for a reply, use send_mailbox.py with --await-reply.",
    ...workflowRoutingLines(),
    "Then begin working on your assigned task.",
  ].join("\n");
}

function normalHeartbeatBody(agentName: string, rulesFile: string): string {
  return [
    `Heartbeat wakeup for ${agentName}. No new mailbox messages.`,
    "",
    `Continue your current work per ${rulesFile}. Do not run read_mailbox.py — the wake-up signal is authoritative about fresh mailbox state.`,
    ...workflowRoutingLines(),
  ].join("\n");
}

function workflowRoutingLines(): string[] {
  return [
    "",
    "Workflow routing for this heartbeat:",
    "- Quick human response: only acknowledge or directly answer a simple human message, send a short status report, ask one clarifying question, or do mailbox-only coordination that does not change project state. Reply and end without creating an episode or invoking planner/executor/evaluator.",
    "- Normal iterative work: use `advanced-episode-flow` when advancing the assigned goal, continuing prior work, handling a non-trivial human request, researching, changing files, producing artifacts, or making decisions that should be evaluated or remembered.",
    "- When in doubt, use `advanced-episode-flow`.",
  ];
}
