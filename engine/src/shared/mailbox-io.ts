import fs from "node:fs";
import path from "node:path";
import { utcnow } from "../harness-core/time.js";

export interface MailboxEntry {
  id: string;
  ts: string;
  from: string;
  to: string;
  task_id: string;
  message: string;
  [k: string]: unknown;
}

export function readMessages(mailboxPath: string): MailboxEntry[] {
  if (!fs.existsSync(mailboxPath)) return [];
  const text = fs.readFileSync(mailboxPath, "utf8");
  const out: MailboxEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const data = JSON.parse(trimmed);
      if (data && typeof data === "object") out.push(data as MailboxEntry);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function loadContacts(contactsPath: string): Record<string, unknown> {
  if (!fs.existsSync(contactsPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(contactsPath, "utf8"));
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function saveContacts(contactsPath: string, contacts: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(contactsPath), { recursive: true });
  const tmp = contactsPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(contacts, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, contactsPath);
}

function validMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("mail.")) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  if (!parts[1].endsWith("Z")) return null;
  if (!/^\d+$/.test(parts[2])) return null;
  return value;
}

function nextMessageId(lines: string[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const prefix = `mail.${stamp}.`;
  let seq = 1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let data: { id?: unknown };
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const id = validMessageId(data.id);
    if (!id) continue;
    if (!id.startsWith(prefix)) break;
    seq = parseInt(id.split(".").pop()!, 10) + 1;
    break;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export function appendMessage(
  mailboxPath: string,
  fromId: string,
  toId: string,
  taskId: string,
  message: string,
  extra?: Record<string, unknown>
): MailboxEntry {
  fs.mkdirSync(path.dirname(mailboxPath), { recursive: true });
  const clean = message.trim();
  if (!clean) throw new Error("message must not be empty");

  const existing = fs.existsSync(mailboxPath) ? fs.readFileSync(mailboxPath, "utf8").split("\n") : [];
  const entry: MailboxEntry = {
    id: nextMessageId(existing),
    ts: utcnow(),
    from: fromId,
    to: toId,
    task_id: taskId,
    message: clean,
    ...(extra ?? {}),
  };
  fs.appendFileSync(mailboxPath, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function messagesAfterId(
  mailboxPath: string,
  lastId: string | null,
  sender?: string | null
): MailboxEntry[] {
  const messages = readMessages(mailboxPath);
  const match = (m: MailboxEntry) => sender == null || m.from === sender;
  if (!lastId) return messages.filter(match);

  const out: MailboxEntry[] = [];
  let found = false;
  for (const m of messages) {
    if (!found) {
      if (m.id === lastId) found = true;
      continue;
    }
    if (match(m)) out.push(m);
  }
  return found ? out : messages.filter(match);
}

export function mailboxContainsField(
  mailboxPath: string,
  field: string,
  expectedValue: string
): boolean {
  const messages = readMessages(mailboxPath);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i][field] === expectedValue) return true;
  }
  return false;
}

export function writePendingMessage(
  runtimeDir: string,
  contact: string,
  mailboxId: string,
  source: string
): void {
  const pendingDir = path.join(runtimeDir, "pending_messages");
  fs.mkdirSync(pendingDir, { recursive: true });
  const file = path.join(pendingDir, `${contact}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ mailbox_id: mailboxId, ts: utcnow(), source }) + "\n",
    "utf8"
  );
}
