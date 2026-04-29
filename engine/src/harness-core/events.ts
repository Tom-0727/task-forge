import fs from "node:fs";
import type { AgentPaths } from "./types.js";
import { utcnow } from "./time.js";

export type EventKind =
  | "heartbeat_start"
  | "heartbeat_end"
  | "agent_text"
  | "tool_use"
  | "tool_result"
  | "command_execution"
  | "file_change"
  | "compact_synced"
  | "manual_compact_started"
  | "manual_compact_succeeded"
  | "manual_compact_failed"
  | "error";

export interface EventRecord {
  ts: string;
  kind: EventKind;
  payload: Record<string, unknown>;
}

export function appendEvent(
  paths: AgentPaths,
  kind: EventKind,
  payload: Record<string, unknown> = {}
): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  const rec: EventRecord = { ts: utcnow(), kind, payload };
  fs.appendFileSync(paths.eventsFile, JSON.stringify(rec) + "\n", "utf8");
}

export function readEventsTail(paths: AgentPaths, limit: number): EventRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(paths.eventsFile, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-Math.max(1, limit));
  const out: EventRecord[] = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as EventRecord);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}
