import fs from "node:fs";
import path from "node:path";
import type { AgentPaths, PendingMessage } from "./types.js";

export function hasAnyPending(paths: AgentPaths): boolean {
  try {
    return fs.readdirSync(paths.pendingDir).some((e) => e.endsWith(".json"));
  } catch {
    return false;
  }
}

export function hasAnyAwaiting(paths: AgentPaths): boolean {
  try {
    return fs.readdirSync(paths.awaitingDir).length > 0;
  } catch {
    return false;
  }
}

export function loadPendingMessages(paths: AgentPaths): Record<string, PendingMessage> {
  const out: Record<string, PendingMessage> = {};
  let entries: string[];
  try {
    entries = fs.readdirSync(paths.pendingDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(paths.pendingDir, entry);
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && typeof data === "object") {
        out[entry.replace(/\.json$/, "")] = data as PendingMessage;
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export function collectSnapshot(paths: AgentPaths): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const [contact, data] of Object.entries(loadPendingMessages(paths))) {
    snap[contact] = data.mailbox_id || "";
  }
  return snap;
}

export function clearUnchangedPending(
  paths: AgentPaths,
  snapshot: Record<string, string>
): void {
  for (const [contact, expected] of Object.entries(snapshot)) {
    if (!expected) continue;
    const file = path.join(paths.pendingDir, `${contact}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data?.mailbox_id === expected) {
        fs.unlinkSync(file);
      }
    } catch {
      /* skip */
    }
  }
}

export function clearAwaitingForPending(paths: AgentPaths): string[] {
  const cleared: string[] = [];
  let pendingFiles: string[];
  try {
    pendingFiles = fs.readdirSync(paths.pendingDir).filter((e) => e.endsWith(".json"));
  } catch {
    return cleared;
  }
  for (const f of pendingFiles) {
    const contact = f.replace(/\.json$/, "");
    const awaitingFile = path.join(paths.awaitingDir, contact);
    if (fs.existsSync(awaitingFile)) {
      fs.unlinkSync(awaitingFile);
      cleared.push(contact);
    }
  }
  return cleared;
}

export function buildMailboxStatus(paths: AgentPaths): string {
  const parts: string[] = [];
  const pending = loadPendingMessages(paths);
  const entries = Object.entries(pending);
  if (entries.length > 0) {
    const items = entries.map(([c, d]) => `  - ${c} (mailbox_id: ${d.mailbox_id || "?"})`);
    parts.push("New messages from:\n" + items.join("\n"));
  }
  try {
    const awaiting = fs.readdirSync(paths.awaitingDir);
    if (awaiting.length > 0) {
      parts.push("Currently awaiting reply from: " + awaiting.join(", "));
    }
  } catch {
    /* skip */
  }
  return parts.join("\n");
}
