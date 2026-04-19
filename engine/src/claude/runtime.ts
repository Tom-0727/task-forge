import fs from "node:fs";
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
  readCompactInterval,
  decidePreInvoke,
  clearUnchangedPending,
  hasAnyPending,
  sleepWithWakeup,
  appendEvent,
  recordHeartbeat,
  recordCompactSuccess,
  updateCompactThreshold,
  type AgentIdentity,
  type AgentPaths,
  type TurnTokens,
} from "../harness-core/index.js";
import { query, type Options as ClaudeAgentOptions, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

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

async function invokeCompact(
  paths: AgentPaths,
  log: ReturnType<typeof createLogger>
): Promise<boolean> {
  const sessionId = loadSessionId(paths);
  if (!sessionId) {
    log.info("compact skipped: no session yet");
    return false;
  }

  const claudeBin = resolveClaudeExecutable();
  const options: ClaudeAgentOptions = {
    cwd: paths.agentDir,
    allowedTools: [],
    maxTurns: 1,
    permissionMode: "bypassPermissions",
    ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
    resume: sessionId,
    includePartialMessages: false,
  };

  log.info(`compact: resuming session ${sessionId}`);

  let boundarySeen = false;
  let newSessionId: string | null = null;
  let ended: "success" | "error" | null = null;

  for await (const message of query({ prompt: "/compact", options })) {
    const kind = (message as { type?: string }).type;
    const subtype = (message as { subtype?: string }).subtype;

    if (kind === "system" && subtype === "compact_boundary") {
      boundarySeen = true;
      log.info("compact: boundary reached");
    } else if (kind === "result") {
      const r = message as { session_id?: string; subtype?: string };
      if (r.session_id) newSessionId = r.session_id;
      ended = r.subtype === "success" ? "success" : "error";
    }
  }

  if (newSessionId) saveSessionId(paths, newSessionId);
  if (boundarySeen && ended === "success") {
    log.info("compact ok");
    return true;
  }
  log.warn(`compact failed: boundary=${boundarySeen} ended=${ended ?? "none"}`);
  return false;
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

      const threshold = readCompactInterval(
        paths,
        identity.runtime.default_compact_every_n_heartbeats
      );
      updateCompactThreshold(paths, threshold);

      appendEvent(paths, "heartbeat_start", {});
      const startedAt = Date.now();
      let invokeOk = true;
      let tokens: TurnTokens = {};
      try {
        tokens = await invokeAgent(paths, identity, decision.prompt!, log);
      } catch (err) {
        invokeOk = false;
        const msg = (err as Error).message;
        log.error(`invoke error: ${msg}`);
        appendEvent(paths, "error", { phase: "invoke", message: msg });
      } finally {
        clearUnchangedPending(paths, decision.pendingSnapshot ?? {});
      }
      const durationSeconds = (Date.now() - startedAt) / 1000;
      const m = invokeOk
        ? recordHeartbeat(paths, { durationSeconds, tokens, compactThreshold: threshold })
        : null;
      appendEvent(paths, "heartbeat_end", {
        duration_seconds: durationSeconds,
        ok: invokeOk,
        heartbeat_count: m ? m.heartbeat.count : undefined,
        compact_count_since_last: m ? m.compact.count_since_last : undefined,
        estimated_context_tokens: m ? m.tokens.estimated_context_tokens : undefined,
      });
      firstHeartbeat = false;

      if (invokeOk && m && threshold > 0 && m.compact.count_since_last >= threshold) {
        log.info(
          `compact threshold reached (${m.compact.count_since_last}/${threshold}); compacting`
        );
        appendEvent(paths, "compact_start", {
          count_since_last: m.compact.count_since_last,
          threshold,
        });
        try {
          const ok = await invokeCompact(paths, log);
          if (ok) {
            const post = recordCompactSuccess(paths);
            appendEvent(paths, "compact_end", {
              ok: true,
              total_compacts: post.compact.total_compacts,
              avg_heartbeats_between: post.compact.avg_heartbeats_between,
            });
          } else {
            appendEvent(paths, "compact_end", { ok: false });
          }
        } catch (err) {
          const msg = (err as Error).message;
          log.error(`compact error: ${msg}`);
          appendEvent(paths, "error", { phase: "compact", message: msg });
        }
      }

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
