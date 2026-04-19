import fs from "node:fs";
import path from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  resolvePaths,
  loadIdentity,
  type AgentPaths,
  type AgentIdentity,
} from "../harness-core/index.js";
import { utcnow } from "../harness-core/time.js";
import {
  appendMessage,
  mailboxContainsField,
  messagesAfterId,
  readMessages,
  writePendingMessage,
  type MailboxEntry,
} from "../shared/mailbox-io.js";

interface BridgeState {
  chat_id: string;
  last_outbound_mailbox_id: string;
  recent_inbound_feishu_message_ids: string[];
}

interface BridgeEnv {
  appId: string;
  appSecret: string;
  configuredChatId: string;
  inboundAckEmoji: string;
  outboundTaskPrefix: boolean;
  pollIntervalMs: number;
  wsReconnectMs: number;
  allowedUserIds: Set<string>;
}

function parseArgs(argv: string[]): { agentDir: string } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent-dir" && argv[i + 1]) return { agentDir: argv[i + 1] };
  }
  throw new Error("bridge: missing --agent-dir");
}

function loadEnvFile(file: string, target: Record<string, string>): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in target)) target[key] = value;
  }
}

function loadBridgeEnv(agentDir: string): BridgeEnv {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  loadEnvFile(path.join(agentDir, ".env"), env);
  loadEnvFile(path.join(agentDir, "mailbox_bridge.env"), env);

  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("FEISHU_APP_ID / FEISHU_APP_SECRET must be set");

  const taskPrefixRaw = (env.FEISHU_OUTBOUND_TASK_PREFIX ?? "1").trim().toLowerCase();
  const outboundTaskPrefix = !["0", "false", "no", "off"].includes(taskPrefixRaw);

  const pollSec = Math.max(1, parseInt(env.FEISHU_MAILBOX_POLL_INTERVAL ?? "1", 10) || 1);
  const wsSec = Math.max(1, parseInt(env.FEISHU_WS_RECONNECT_SECONDS ?? "5", 10) || 5);

  const allowed = new Set<string>();
  for (const v of (env.ALLOWED_USER_IDS ?? "").split(",")) {
    const t = v.trim();
    if (t) allowed.add(t);
  }

  return {
    appId,
    appSecret,
    configuredChatId: (env.FEISHU_CHAT_ID ?? "").trim(),
    inboundAckEmoji: (env.FEISHU_INBOUND_ACK_EMOJI ?? "OK").trim(),
    outboundTaskPrefix,
    pollIntervalMs: pollSec * 1000,
    wsReconnectMs: wsSec * 1000,
    allowedUserIds: allowed,
  };
}

function log(msg: string): void {
  process.stdout.write(`[${utcnow()}] [mailbox-feishu-bridge] ${msg}\n`);
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function pidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidStatus(file: string): { state: string; pid: string } {
  const raw = readText(file);
  if (!raw) return { state: "stopped", pid: "" };
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid)) return { state: "stale", pid: raw };
  return { state: pidRunning(pid) ? "running" : "stale", pid: String(pid) };
}

function formatAge(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "unknown";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function formatTs(ts: string): string {
  const t = (ts ?? "").trim();
  if (!t) return "unknown";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.replace("T", " ").replace("Z", "").trim();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shortId(value: string, keep = 12): string {
  const v = (value ?? "").trim();
  if (!v) return "none";
  return v.length <= keep ? v : `${v.slice(0, keep)}...`;
}

function readJsonFile(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function defaultState(): BridgeState {
  return { chat_id: "", last_outbound_mailbox_id: "", recent_inbound_feishu_message_ids: [] };
}

class StateStore {
  constructor(private readonly paths: AgentPaths, private readonly file: string) {}
  private locked = Promise.resolve();

  private read(): BridgeState {
    if (!fs.existsSync(this.file)) return defaultState();
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!data || typeof data !== "object") return defaultState();
      const s = data as Partial<BridgeState>;
      return {
        chat_id: typeof s.chat_id === "string" ? s.chat_id : "",
        last_outbound_mailbox_id:
          typeof s.last_outbound_mailbox_id === "string" ? s.last_outbound_mailbox_id : "",
        recent_inbound_feishu_message_ids: Array.isArray(s.recent_inbound_feishu_message_ids)
          ? s.recent_inbound_feishu_message_ids.filter((v): v is string => typeof v === "string")
          : [],
      };
    } catch {
      return defaultState();
    }
  }

  async load(): Promise<BridgeState> {
    await this.locked;
    return this.read();
  }

  async update(patch: Partial<BridgeState>): Promise<BridgeState> {
    const pending = this.locked.then(async () => {
      const current = this.read();
      const merged: BridgeState = { ...current };
      if (patch.chat_id) merged.chat_id = patch.chat_id;
      const curLast = current.last_outbound_mailbox_id || "";
      const newLast = patch.last_outbound_mailbox_id || "";
      merged.last_outbound_mailbox_id = curLast > newLast ? curLast : newLast;
      const seen = new Set(current.recent_inbound_feishu_message_ids);
      const combined = [...current.recent_inbound_feishu_message_ids];
      for (const v of patch.recent_inbound_feishu_message_ids ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          combined.push(v);
        }
      }
      merged.recent_inbound_feishu_message_ids = combined.slice(-200);
      fs.mkdirSync(this.paths.runtimeDir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(merged, null, 2) + "\n", "utf8");
      return merged;
    });
    this.locked = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function tailMailbox(mailbox: string, limit: number): MailboxEntry[] {
  if (limit <= 0) return [];
  const all = readMessages(mailbox);
  return all.slice(-limit);
}

function formatHistoryEntry(entry: MailboxEntry): string {
  const ts = formatTs(String(entry.ts ?? "unknown"));
  const role = String(entry.from ?? "unknown");
  const taskId = String(entry.task_id ?? "").trim();
  const message = String(entry.message ?? "").trim() || "(empty)";
  const prefix = taskId ? `${ts} ${role} ${taskId}` : `${ts} ${role}`;
  return `${prefix}: ${message}`;
}

function buildStatusText(paths: AgentPaths, identity: AgentIdentity): string {
  const runner = pidStatus(path.join(paths.pidsDir, "runtime"));
  const bridge = pidStatus(path.join(paths.pidsDir, "bridge"));
  const runtimeState = readText(paths.stateFile) || "unknown";
  const heartbeat = readText(paths.heartbeatFile);
  const heartbeatLine = heartbeat ? `${formatTs(heartbeat)} (${formatAge(heartbeat)} ago)` : "none";

  let session = "none";
  if (identity.provider === "codex" && fs.existsSync(paths.codexThreadFile)) {
    session = shortId(readText(paths.codexThreadFile));
  } else if (identity.provider === "claude" && fs.existsSync(paths.claudeSessionFile)) {
    session = shortId(readText(paths.claudeSessionFile));
  }

  let awaiting = false;
  try {
    awaiting = fs.readdirSync(paths.awaitingDir).length > 0;
  } catch {
    awaiting = false;
  }

  const pending = readJsonFile(path.join(paths.pendingDir, "human.json"));
  const pendingId = pending && typeof pending.mailbox_id === "string" ? pending.mailbox_id : "none";

  return [
    identity.agent_name,
    `provider: ${identity.provider}`,
    `runner: ${runner.state}${runner.pid ? ` pid=${runner.pid}` : ""}`,
    `bridge: ${bridge.state}${bridge.pid ? ` pid=${bridge.pid}` : ""}`,
    `state: ${runtimeState}`,
    `last heartbeat: ${heartbeatLine}`,
    `awaiting_reply: ${awaiting ? "yes" : "no"}`,
    `session: ${session}`,
    `pending_messages: ${pendingId}`,
  ].join("\n");
}

function helpText(agentName: string): string {
  return [
    `${agentName} bridge commands`,
    "/help",
    "/status",
    "/history [N]",
    "Use //text to send a literal message starting with / to the agent.",
  ].join("\n");
}

function historyText(mailbox: string, limit: number): string {
  const capped = Math.max(1, Math.min(limit, 20));
  const entries = tailMailbox(mailbox, capped);
  if (entries.length === 0) return "No mailbox history found.";
  return `Recent mailbox history (${entries.length}):\n${entries.map(formatHistoryEntry).join("\n")}`;
}

function appendCommandAudit(paths: AgentPaths, payload: Record<string, unknown>): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  const file = path.join(paths.runtimeDir, "bridge_commands.jsonl");
  const entry = { ts: utcnow(), ...payload };
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

async function sendText(client: Lark.Client, chatId: string, text: string): Promise<void> {
  const resp = await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
  if (resp.code && resp.code !== 0) {
    throw new Error(`[send_text] error ${resp.code}: ${resp.msg}`);
  }
}

async function sendReaction(client: Lark.Client, messageId: string, emojiType: string): Promise<void> {
  const resp = await client.im.v1.messageReaction.create({
    path: { message_id: messageId },
    data: { reaction_type: { emoji_type: emojiType } },
  });
  if (resp.code && resp.code !== 0) {
    throw new Error(`[send_reaction] error ${resp.code}: ${resp.msg}`);
  }
}

function formatOutbound(agentName: string, entry: MailboxEntry, withTaskPrefix: boolean): string {
  const message = String(entry.message ?? "").trim();
  const taskId = String(entry.task_id ?? "").trim();
  if (withTaskPrefix && taskId) return `[${agentName} | ${taskId}]\n${message}`;
  return `${agentName}\n${message}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function outboundLoop(
  client: Lark.Client,
  identity: AgentIdentity,
  paths: AgentPaths,
  env: BridgeEnv,
  store: StateStore,
  mailbox: string,
  shouldStop: () => boolean
): Promise<void> {
  while (!shouldStop()) {
    try {
      const state = await store.load();
      const chatId = env.configuredChatId || state.chat_id;
      if (!chatId) {
        await sleep(env.pollIntervalMs);
        continue;
      }
      const lastId = state.last_outbound_mailbox_id || null;
      const pending = messagesAfterId(mailbox, lastId, identity.agent_name);
      for (const entry of pending) {
        const text = formatOutbound(identity.agent_name, entry, env.outboundTaskPrefix);
        await sendText(client, chatId, text);
        await store.update({ last_outbound_mailbox_id: String(entry.id) });
        log(`Forwarded mailbox message ${entry.id} to Feishu`);
      }
    } catch (err) {
      log(`Outbound sync error: ${(err as Error).message}`);
    }
    await sleep(env.pollIntervalMs);
  }
}

function parseCommand(text: string): { command: string; arg: string } {
  const idx = text.indexOf(" ");
  if (idx < 0) return { command: text.toLowerCase(), arg: "" };
  return { command: text.slice(0, idx).toLowerCase(), arg: text.slice(idx + 1).trim() };
}

async function main(): Promise<void> {
  const { agentDir } = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(agentDir);
  const identity = loadIdentity(paths);
  const env = loadBridgeEnv(paths.agentDir);

  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  const mailbox = path.join(paths.mailboxDir, "human.jsonl");
  const stateFile = path.join(paths.runtimeDir, "bridge-state.json");
  const store = new StateStore(paths, stateFile);

  const client = new Lark.Client({ appId: env.appId, appSecret: env.appSecret });

  const tryAck = async (messageId: string) => {
    if (!env.inboundAckEmoji) return;
    try {
      await sendReaction(client, messageId, env.inboundAckEmoji);
    } catch (err) {
      log(`Failed inbound ack ${env.inboundAckEmoji} for ${messageId}: ${(err as Error).message}`);
    }
  };

  const handleCommand = async (
    text: string,
    senderId: string,
    chatId: string
  ): Promise<string> => {
    const { command, arg } = parseCommand(text);
    if (command === "/help") return helpText(identity.agent_name);
    if (command === "/status") return buildStatusText(paths, identity);
    if (command === "/history") {
      const n = arg ? parseInt(arg, 10) : 5;
      return historyText(mailbox, Number.isFinite(n) ? n : 5);
    }
    return `Unknown command: ${command}\nUse /help to see available commands.\nUse //text to send a literal message starting with / to the agent.`;
  };

  const onReceive = async (data: {
    message: {
      message_id: string;
      message_type: string;
      chat_id: string;
      content: string;
    };
    sender: { sender_id: { open_id: string } };
  }): Promise<void> => {
    const msg = data.message;
    const senderId = data.sender?.sender_id?.open_id ?? "";
    if (msg.message_type !== "text") return;
    if (env.allowedUserIds.size > 0 && !env.allowedUserIds.has(senderId)) return;

    let text = "";
    try {
      text = String(JSON.parse(msg.content).text ?? "").trim();
    } catch {
      return;
    }
    if (!text) return;

    if (env.configuredChatId && msg.chat_id !== env.configuredChatId) {
      log(`Ignoring inbound from unconfigured chat ${msg.chat_id}`);
      return;
    }

    const state = await store.load();
    if (state.recent_inbound_feishu_message_ids.includes(msg.message_id)) return;
    if (mailboxContainsField(mailbox, "feishu_message_id", msg.message_id)) return;

    await tryAck(msg.message_id);

    let literalText = text;
    if (text.startsWith("//")) {
      literalText = text.slice(1);
    } else if (text.startsWith("/")) {
      const response = await handleCommand(text, senderId, msg.chat_id);
      await store.update({
        chat_id: env.configuredChatId ? "" : msg.chat_id,
        recent_inbound_feishu_message_ids: [msg.message_id],
      });
      appendCommandAudit(paths, {
        sender_id: senderId,
        chat_id: msg.chat_id,
        command: text,
        handled: true,
        result_summary: (response.split("\n")[0] || "").slice(0, 200),
      });
      try {
        await sendText(client, msg.chat_id, response);
        log(`Handled bridge command ${text} from ${senderId}`);
      } catch (err) {
        log(`Command reply failed: ${(err as Error).message}`);
      }
      return;
    }

    const entry = appendMessage(
      mailbox,
      "human",
      identity.agent_name,
      "task.human.reply",
      literalText,
      {
        source: "feishu",
        feishu_chat_id: msg.chat_id,
        feishu_message_id: msg.message_id,
        feishu_sender_id: senderId,
      }
    );

    await store.update({
      chat_id: env.configuredChatId ? "" : msg.chat_id,
      recent_inbound_feishu_message_ids: [msg.message_id],
    });
    writePendingMessage(paths.runtimeDir, "human", entry.id, "feishu");
    log(`Recorded inbound Feishu message ${msg.message_id} as mailbox ${entry.id}`);
  };

  let stopped = false;
  const shutdown = (sig: NodeJS.Signals) => {
    log(`${sig} received; shutting down`);
    stopped = true;
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  void outboundLoop(client, identity, paths, env, store, mailbox, () => stopped);

  log(`Starting bridge for ${identity.agent_name}`);
  while (!stopped) {
    try {
      const wsClient = new Lark.WSClient({
        appId: env.appId,
        appSecret: env.appSecret,
        loggerLevel: Lark.LoggerLevel.info,
      });
      await wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data: unknown) => {
            await onReceive(data as Parameters<typeof onReceive>[0]);
          },
        }),
      });
      log(`WebSocket closed. Reconnecting in ${env.wsReconnectMs / 1000}s.`);
    } catch (err) {
      log(`WebSocket error: ${(err as Error).message}. Reconnecting in ${env.wsReconnectMs / 1000}s.`);
    }
    if (stopped) break;
    await sleep(env.wsReconnectMs);
  }
}

main().catch((err) => {
  process.stderr.write(`[bridge] fatal: ${(err as Error).stack || err}\n`);
  process.exit(1);
});
