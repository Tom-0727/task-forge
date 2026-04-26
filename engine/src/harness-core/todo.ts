import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentPaths, ScheduledTask, TodoItem } from "./types.js";

function safeJsonList(file: string): unknown[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function renderDueRemindersSection(paths: AgentPaths): string {
  const dueIds = safeJsonList(paths.dueRemindersFile) as string[];
  if (dueIds.length === 0) return "";
  const tasks = safeJsonList(paths.scheduledTasksFile) as ScheduledTask[];
  const byId = new Map<string, ScheduledTask>();
  for (const t of tasks) {
    if (t && typeof t === "object" && (t as ScheduledTask).id) {
      byId.set(t.id, t);
    }
  }
  const lines = ["Due reminders this minute:"];
  for (const id of dueIds) {
    const task = byId.get(id);
    if (!task) {
      lines.push(`  - ${id} (scheduled task record missing)`);
      continue;
    }
    lines.push(`  - ${task.title || ""} [${id}]`);
    const desc = (task.description || "").trim();
    if (desc) lines.push(`      ${desc}`);
    for (const sub of task.subtasks || []) {
      const text = (sub?.text || "").trim();
      if (text) lines.push(`      • ${text}`);
    }
  }
  return lines.join("\n");
}

export function renderTodayTodosSection(paths: AgentPaths, today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const dayFile = path.join(paths.todoListDir, `${y}${m}`, `${d}.json`);
  const items = safeJsonList(dayFile) as TodoItem[];
  if (items.length === 0) return "";

  const dateLabel = `${y}-${m}-${d}`;
  const lines = [`Today's Todos (${dateLabel}):`];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const mark = item.done ? "x" : " ";
    lines.push(`  - [${mark}] ${item.title || ""} [${item.id || ""}]`);
    const desc = (item.description || "").trim();
    if (desc) lines.push(`      ${desc}`);
    for (const sub of item.subtasks || []) {
      const subMark = sub?.done ? "x" : " ";
      const text = (sub?.text || "").trim();
      if (text) lines.push(`      • [${subMark}] ${text}`);
    }
  }
  return lines.join("\n");
}

export function runPreHeartbeatHook(paths: AgentPaths): void {
  if (!fs.existsSync(paths.skillsTodoPreHeartbeat)) return;
  try {
    spawnSync(
      "uv",
      ["run", "python", paths.skillsTodoPreHeartbeat, "--agent-workdir", paths.agentDir],
      {
        stdio: "ignore",
        timeout: 15000,
        env: { ...process.env, AGENT_DIR: paths.agentDir },
      }
    );
  } catch {
    /* hook failure must not take heartbeat down */
  }
}
