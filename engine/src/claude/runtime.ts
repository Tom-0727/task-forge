import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  resolvePaths,
  loadIdentity,
  checkAndWritePid,
  cleanupPid,
  createLogger,
  writeState,
  writeHeartbeat,
  writeInterval,
  readInterval,
  decidePreInvoke,
  hasAnyPending,
  sleepWithWakeup,
  appendEvent,
  buildPrompt,
  runPreHeartbeat,
  runPostHeartbeat,
  readCompactRequest,
  hasCompactRequest,
  clearCompactRequest,
  writeManualCompactStatus,
  syncCompactState,
  utcnow,
  type AgentIdentity,
  type AgentPaths,
  type CompactObservation,
  type TurnTokens,
} from "../harness-core/index.js";
import { query, type Options as ClaudeAgentOptions, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

function scanClaudeCompactLog(sessionId: string): CompactObservation {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return { total: 0, lastAt: null };
  let file: string | null = null;
  for (const proj of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, proj, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      file = candidate;
      break;
    }
  }
  if (!file) return { total: 0, lastAt: null };
  let total = 0;
  let lastAt: string | null = null;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split("\n")) {
    if (!line || line.indexOf('"compact_boundary"') === -1) continue;
    try {
      const ev = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        timestamp?: string;
      };
      if (ev.type === "system" && ev.subtype === "compact_boundary") {
        total += 1;
        if (typeof ev.timestamp === "string") lastAt = ev.timestamp;
      }
    } catch {
      /* ignore malformed line */
    }
  }
  return { total, lastAt };
}

function parseArgs(argv: string[]): { agentDir: string } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent-dir" && argv[i + 1]) return { agentDir: argv[i + 1] };
  }
  throw new Error("runtime: missing --agent-dir");
}

function loadSessionId(paths: AgentPaths): string | null {
  if (!fs.existsSync(paths.claudeSessionFile)) return null;
  const sid = fs.readFileSync(paths.claudeSessionFile, "utf8").trim();
  return sid || null;
}

function saveSessionId(paths: AgentPaths, sid: string): void {
  fs.writeFileSync(paths.claudeSessionFile, sid, "utf8");
}

function resolveClaudeExecutable(): string | undefined {
  try {
    const p = execSync("command -v claude", { encoding: "utf8" }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  return undefined;
}

function pushStderr(lines: string[], data: string): void {
  for (const line of data.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  if (lines.length > 20) lines.splice(0, lines.length - 20);
}

function stderrSummary(lines: string[]): string {
  return lines.length ? ` stderr: ${lines.slice(-6).join(" | ")}` : "";
}

function parseAgentFile(filePath: string): AgentDefinition {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.startsWith("---\n")) {
    throw new Error(`subagent ${filePath}: missing '---' frontmatter opener`);
  }
  const closeIdx = raw.indexOf("\n---\n", 4);
  if (closeIdx === -1) {
    throw new Error(`subagent ${filePath}: missing '---' frontmatter closer`);
  }
  const fmLines = raw.slice(4, closeIdx).split("\n");
  const prompt = raw.slice(closeIdx + 5).trimStart();

  let description: string | undefined;
  let model: string | undefined;
  let tools: string[] | undefined;
  let currentListKey: "tools" | null = null;

  for (const line of fmLines) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (currentListKey && listItem) {
      if (currentListKey === "tools") {
        (tools ??= []).push(listItem[1].trim());
      }
      continue;
    }
    currentListKey = null;
    const scalar = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!scalar) continue;
    const key = scalar[1];
    const value = scalar[2].trim();
    if (value === "") {
      if (key === "tools") currentListKey = "tools";
      continue;
    }
    if (key === "description") description = value;
    else if (key === "model") model = value;
  }

  if (!description) {
    throw new Error(`subagent ${filePath}: frontmatter missing 'description'`);
  }
  if (!prompt) {
    throw new Error(`subagent ${filePath}: body (system prompt) is empty`);
  }
  const def: AgentDefinition = { description, prompt };
  if (tools && tools.length > 0) def.tools = tools;
  if (model) def.model = model;
  return def;
}

function loadProjectAgents(agentDir: string): Record<string, AgentDefinition> {
  const dir = path.join(agentDir, ".claude", "agents");
  if (!fs.existsSync(dir)) return {};
  const out: Record<string, AgentDefinition> = {};
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.slice(0, -3);
    out[name] = parseAgentFile(path.join(dir, entry));
  }
  return out;
}

let shuttingDown = false;

async function compactClaudeSession(
  paths: AgentPaths,
  sessionId: string,
  log: ReturnType<typeof createLogger>
): Promise<{ sessionId: string }> {
  const claudeBin = resolveClaudeExecutable();
  const stderrLines: string[] = [];
  const options: ClaudeAgentOptions = {
    cwd: paths.agentDir,
    resume: sessionId,
    tools: [],
    allowedTools: [],
    maxTurns: 1,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    stderr: (data) => pushStderr(stderrLines, data),
    ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
  };

  let boundarySeen = false;
  let resultSubtype: string | null = null;
  let newSessionId = sessionId;

  try {
    for await (const message of query({ prompt: "/compact", options })) {
      const kind = (message as { type?: string }).type;
      if (kind === "system") {
        const sys = message as {
          subtype?: string;
          session_id?: string;
          compact_result?: string;
          compact_error?: string;
        };
        if (sys.session_id) newSessionId = sys.session_id;
        if (sys.subtype === "compact_boundary") {
          boundarySeen = true;
        } else if (sys.subtype === "status" && sys.compact_result === "failed") {
          throw new Error(`claude compact failed: ${sys.compact_error ?? "unknown"}`);
        }
      } else if (kind === "result") {
        const result = message as { subtype?: string; session_id?: string };
        resultSubtype = result.subtype ?? null;
        if (result.session_id) newSessionId = result.session_id;
      }
    }
  } catch (err) {
    throw new Error(`${(err as Error).message}${stderrSummary(stderrLines)}`);
  }

  if (!boundarySeen || resultSubtype !== "success") {
    throw new Error(
      `claude compact failed: boundary=${boundarySeen}, result=${resultSubtype ?? "none"}${stderrSummary(stderrLines)}`
    );
  }

  saveSessionId(paths, newSessionId);
  log.info(`manual compact session_id=${newSessionId}`);
  return { sessionId: newSessionId };
}

async function processCompactRequest(
  paths: AgentPaths,
  log: ReturnType<typeof createLogger>
): Promise<boolean> {
  const req = readCompactRequest(paths);
  if (!req) {
    if (hasCompactRequest(paths)) {
      clearCompactRequest(paths);
      log.warn("dropped invalid compact request file");
      return true;
    }
    return false;
  }

  const requestId = req.id;
  const startedAt = utcnow();
  let sessionId: string | null = null;
  writeManualCompactStatus(paths, {
    state: "running",
    request_id: requestId,
    provider: "claude",
    requested_at: req.requested_at,
    started_at: startedAt,
  });
  appendEvent(paths, "manual_compact_started", {
    request_id: requestId,
    requested_at: req.requested_at,
  });

  try {
    if (req.provider !== "claude") {
      throw new Error(`unsupported compact provider: ${req.provider}`);
    }

    sessionId = loadSessionId(paths);
    if (!sessionId) {
      throw new Error("no claude session to compact");
    }

    const before = scanClaudeCompactLog(sessionId);
    log.info(`manual compact starting for session ${sessionId}`);
    const completed = await compactClaudeSession(paths, sessionId, log);
    sessionId = completed.sessionId;

    let obs = scanClaudeCompactLog(sessionId);
    for (let i = 0; i < 5 && obs.total <= before.total; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      obs = scanClaudeCompactLog(sessionId);
    }
    const synced = syncCompactState(paths, obs);
    writeManualCompactStatus(paths, {
      state: "succeeded",
      request_id: requestId,
      provider: "claude",
      requested_at: req.requested_at,
      started_at: startedAt,
      finished_at: utcnow(),
      session_id: sessionId,
      total_compacts: synced.compact.total_compacts,
      last_compact_at: synced.compact.last_compact_at,
    });
    appendEvent(paths, "manual_compact_succeeded", {
      request_id: requestId,
      session_id: sessionId,
      total_compacts: synced.compact.total_compacts,
      last_compact_at: synced.compact.last_compact_at,
    });
    log.info(`manual compact finished for session ${sessionId}`);
  } catch (err) {
    const message = (err as Error).message;
    writeManualCompactStatus(paths, {
      state: "failed",
      request_id: requestId,
      provider: "claude",
      requested_at: req.requested_at,
      started_at: startedAt,
      finished_at: utcnow(),
      error: message,
      session_id: sessionId ?? undefined,
    });
    appendEvent(paths, "manual_compact_failed", {
      request_id: requestId,
      session_id: sessionId,
      message,
    });
    log.error(`manual compact failed: ${message}`);
  } finally {
    clearCompactRequest(paths, requestId);
  }

  return true;
}

async function invokeAgent(
  paths: AgentPaths,
  identity: AgentIdentity,
  prompt: string,
  log: ReturnType<typeof createLogger>
): Promise<TurnTokens> {
  const sessionId = loadSessionId(paths);

  const claudeBin = resolveClaudeExecutable();
  const projectAgents = loadProjectAgents(paths.agentDir);
  const options: ClaudeAgentOptions = {
    cwd: paths.agentDir,
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"],
    maxTurns: identity.runtime.default_max_turns,
    permissionMode: "bypassPermissions",
    agents: projectAgents,
    ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
    ...(sessionId ? { resume: sessionId } : {}),
  };
  log.info(`loaded project subagents: ${Object.keys(projectAgents).sort().join(",") || "(none)"}`);

  log.info(sessionId ? `resuming session ${sessionId}` : "starting new session");

  let newSessionId: string | null = null;
  let tokens: TurnTokens = {};

  for await (const message of query({ prompt, options })) {
    const kind = (message as { type?: string }).type;

    if (kind === "assistant") {
      const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; text?: string; name?: string; id?: string; input?: unknown };
        if (b.type === "text" && typeof b.text === "string") {
          log.info(`agent: ${b.text.slice(0, 200)}`);
          appendEvent(paths, "agent_text", { text: b.text });
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          log.info(`tool: ${b.name}`);
          appendEvent(paths, "tool_use", { name: b.name, id: b.id, input: b.input });
        }
      }
    } else if (kind === "user") {
      const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type === "tool_result") {
          appendEvent(paths, "tool_result", {
            tool_use_id: b.tool_use_id,
            is_error: b.is_error ?? false,
          });
        }
      }
    } else if (kind === "result") {
      const r = message as {
        session_id?: string;
        subtype?: string;
        num_turns?: number;
        total_cost_usd?: number;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      if (r.session_id) newSessionId = r.session_id;
      const u = r.usage ?? {};
      const inputT = u.input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheCreate = u.cache_creation_input_tokens ?? 0;
      tokens = {
        input_tokens: inputT,
        output_tokens: u.output_tokens ?? 0,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
        estimated_context_tokens: inputT + cacheRead + cacheCreate,
      };
      if (r.subtype === "success") {
        log.info(
          `heartbeat ok. turns=${r.num_turns ?? 0} cost=${(r.total_cost_usd ?? 0).toFixed(4)} ctx=${tokens.estimated_context_tokens}`
        );
      } else {
        log.warn(`heartbeat ended: ${r.subtype}`);
      }
    }
  }

  if (newSessionId) saveSessionId(paths, newSessionId);
  return tokens;
}

async function main(): Promise<void> {
  const { agentDir } = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(agentDir);
  const identity = loadIdentity(paths);
  const log = createLogger(paths, "runtime");

  checkAndWritePid(paths, "runtime");

  process.on("SIGINT", () => {
    log.info("SIGINT received");
    shuttingDown = true;
  });
  process.on("SIGTERM", () => {
    log.info("SIGTERM received");
    shuttingDown = true;
  });

  writeInterval(paths, readInterval(paths, identity.runtime.default_interval_minutes));

  log.info(`starting ${identity.agent_name} on claude runtime`);
  let firstHeartbeat = loadSessionId(paths) === null;

  try {
    while (!shuttingDown) {
      if (await processCompactRequest(paths, log)) {
        if (hasAnyPending(paths)) {
          log.info("pending messages after compact; continuing immediately");
          continue;
        }
        const interval = readInterval(paths, identity.runtime.default_interval_minutes);
        log.info(`sleeping ${interval}m`);
        await sleepWithWakeup(paths, interval * 60, () => shuttingDown);
        continue;
      }

      const decision = decidePreInvoke(paths, identity, firstHeartbeat);
      writeHeartbeat(paths);
      writeState(paths, decision.stateUpdate);

      if (decision.action === "skip_long_sleep") {
        log.info(
          `off hours; sleeping ${Math.floor((decision.sleepSeconds ?? 3600) / 60)}m until next window`
        );
        await sleepWithWakeup(paths, decision.sleepSeconds ?? 3600, () => shuttingDown);
        continue;
      }
      if (decision.action === "skip_short_sleep") {
        log.info(`skipping heartbeat (${decision.reason}); sleeping ${decision.sleepMinutes}m`);
        await sleepWithWakeup(paths, (decision.sleepMinutes ?? 20) * 60, () => shuttingDown);
        continue;
      }

      const mailboxStatus = decision.mailboxStatus ?? "";
      const pre = runPreHeartbeat(paths, identity, { firstHeartbeat, mailboxStatus }, log);
      const prompt = buildPrompt(paths, identity, {
        firstHeartbeat,
        mailboxStatus,
        preSections: pre.promptSections,
      });

      appendEvent(paths, "heartbeat_start", {});
      const startedAt = Date.now();
      let invokeOk = true;
      let tokens: TurnTokens = {};
      try {
        tokens = await invokeAgent(paths, identity, prompt, log);
      } catch (err) {
        invokeOk = false;
        const msg = (err as Error).message;
        log.error(`invoke error: ${msg}`);
        appendEvent(paths, "error", { phase: "invoke", message: msg });
      }
      const durationSeconds = (Date.now() - startedAt) / 1000;
      runPostHeartbeat(
        paths,
        identity,
        {
          durationSeconds,
          invokeOk,
          tokens,
          pendingSnapshot: decision.pendingSnapshot ?? {},
          observeCompact: () => {
            const sid = loadSessionId(paths);
            return sid ? scanClaudeCompactLog(sid) : null;
          },
        },
        log
      );
      firstHeartbeat = false;

      if (hasAnyPending(paths)) {
        log.info("more pending messages; continuing immediately");
        continue;
      }

      const interval = readInterval(paths, identity.runtime.default_interval_minutes);
      log.info(`sleeping ${interval}m`);
      await sleepWithWakeup(paths, interval * 60, () => shuttingDown);
    }
  } finally {
    cleanupPid(paths, "runtime");
    log.info("runtime stopped");
  }
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).stack || err}`);
  process.exit(1);
});
