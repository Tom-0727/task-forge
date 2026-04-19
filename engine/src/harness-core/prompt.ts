import type { AgentIdentity, AgentPaths } from "./types.js";
import { readBootstrapPhase, buildBootstrapNotice } from "./bootstrap.js";
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
  const bootstrap = buildBootstrapNotice(readBootstrapPhase(paths));
  const due = renderDueRemindersSection(paths);
  const todos = renderTodayTodosSection(paths);
  const rulesFile = identity.provider === "claude" ? "CLAUDE.md" : "AGENTS.md";
  const skillsDirHint = identity.provider === "claude" ? ".claude/skills" : ".agents/skills";

  const body = opts.mailboxStatus
    ? mailboxBody(opts.mailboxStatus, skillsDirHint)
    : opts.firstHeartbeat
      ? firstHeartbeatBody(identity.agent_name, rulesFile, skillsDirHint)
      : normalHeartbeatBody(identity.agent_name, rulesFile);

  const segments = [bootstrap, due, todos, body.trim(), `Working directory: ${paths.agentDir}`];
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
    "3. Address the messages and continue your current work.",
    `4. To reply, use ${skillsDir}/mailbox-operate/scripts/send_mailbox.py --to <contact> --message "..."`,
  ].join("\n");
}

function firstHeartbeatBody(agentName: string, rulesFile: string, skillsDir: string): string {
  return [
    `You are ${agentName}. This is your first heartbeat.`,
    "",
    `Read ${rulesFile} to understand your behavioral rules, including the Bootstrap Protocol that gates your first phases of work.`,
    `Read your mailbox: uv run python ${skillsDir}/mailbox-operate/scripts/read_mailbox.py`,
    "If you need to pause for a reply, use send_mailbox.py with --await-reply.",
    "Then begin working on your assigned task.",
  ].join("\n");
}

function normalHeartbeatBody(agentName: string, rulesFile: string): string {
  return [
    `Heartbeat wakeup for ${agentName}. No new mailbox messages.`,
    "",
    `Continue your current work per ${rulesFile}. Do not run read_mailbox.py — the wake-up signal is authoritative about fresh mailbox state.`,
  ].join("\n");
}
