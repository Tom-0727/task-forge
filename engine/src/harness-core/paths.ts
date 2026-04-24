import fs from "node:fs";
import path from "node:path";
import type { AgentPaths } from "./types.js";

export function resolvePaths(agentDir: string): AgentPaths {
  const abs = path.resolve(agentDir);
  const runtimeDir = path.join(abs, "Runtime");
  const skillsDir = resolveSkillsDir(abs);

  return {
    agentDir: abs,
    runtimeDir,
    identityFile: path.join(runtimeDir, "agent.json"),
    pidFile: path.join(runtimeDir, "pid"),
    stateFile: path.join(runtimeDir, "state"),
    heartbeatFile: path.join(runtimeDir, "last_heartbeat"),
    intervalFile: path.join(runtimeDir, "interval"),
    passiveModeFile: path.join(runtimeDir, "passive_mode"),
    claudeSessionFile: path.join(runtimeDir, "claude_session_id"),
    codexThreadFile: path.join(runtimeDir, "codex_thread_id"),
    metricsFile: path.join(runtimeDir, "metrics.json"),
    eventsFile: path.join(runtimeDir, "events.jsonl"),
    pendingDir: path.join(runtimeDir, "pending_messages"),
    awaitingDir: path.join(runtimeDir, "awaiting_reply"),
    workScheduleFile: path.join(runtimeDir, "work_schedule.json"),
    dueRemindersFile: path.join(runtimeDir, "due_reminders.json"),
    pidsDir: path.join(runtimeDir, "pids"),
    logsDir: path.join(runtimeDir, "logs"),
    mailboxDir: path.join(abs, "mailbox"),
    contactsFile: path.join(abs, "mailbox", "contacts.json"),
    memoryDir: path.join(abs, "Memory"),
    scheduledTasksFile: path.join(abs, "scheduled_tasks.json"),
    todoListDir: path.join(abs, "todo_list"),
    skillsDir,
    skillsTodoPreHeartbeat: path.join(skillsDir, "todo", "scripts", "pre_heartbeat.py"),
  };
}

function resolveSkillsDir(agentDir: string): string {
  const claudeDir = path.join(agentDir, ".claude", "skills");
  if (fs.existsSync(claudeDir)) return claudeDir;
  return path.join(agentDir, ".agents", "skills");
}
