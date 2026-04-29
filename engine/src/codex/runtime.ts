import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  type AgentPaths,
  type CompactObservation,
  type TurnTokens,
} from "../harness-core/index.js";
import { CodexAppServerClient } from "./app-server-client.js";
import type { ThreadStartOptions } from "./app-server-client.js";

function scanCodexCompactLog(threadId: string): CompactObservation {
  const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(sessionsDir)) return { total: 0, lastAt: null };
  const suffix = `-${threadId}.jsonl`;
  const files: string[] = [];
  for (const y of fs.readdirSync(sessionsDir)) {
    const yd = path.join(sessionsDir, y);
    if (!fs.statSync(yd).isDirectory()) continue;
    for (const m of fs.readdirSync(yd)) {
      const md = path.join(yd, m);
      if (!fs.statSync(md).isDirectory()) continue;
      for (const d of fs.readdirSync(md)) {
        const dd = path.join(md, d);
        if (!fs.statSync(dd).isDirectory()) continue;
        for (const entry of fs.readdirSync(dd)) {
          if (entry.startsWith("rollout-") && entry.endsWith(suffix)) {
            files.push(path.join(dd, entry));
          }
        }
      }
    }
  }
  let total = 0;
  let lastAt: string | null = null;
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    for (const line of content.split("\n")) {
      if (!line || line.indexOf('"context_compacted"') === -1) continue;
      try {
        const ev = JSON.parse(line) as {
          type?: string;
          timestamp?: string;
          payload?: { type?: string };
        };
        if (ev.type === "event_msg" && ev.payload?.type === "context_compacted") {
          total += 1;
          if (typeof ev.timestamp === "string") lastAt = ev.timestamp;
        }
      } catch {
        /* ignore malformed line */
      }
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

function loadThreadId(paths: AgentPaths): string | null {
  if (!fs.existsSync(paths.codexThreadFile)) return null;
  const tid = fs.readFileSync(paths.codexThreadFile, "utf8").trim();
  return tid || null;
}

function saveThreadId(paths: AgentPaths, tid: string): void {
  fs.writeFileSync(paths.codexThreadFile, tid, "utf8");
}

let shuttingDown = false;

function threadOptions(paths: AgentPaths): ThreadStartOptions {
  return {
    cwd: paths.agentDir,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
  };
}

async function ensureThread(
  client: CodexAppServerClient,
  paths: AgentPaths,
  log: ReturnType<typeof createLogger>
): Promise<string> {
  const existing = loadThreadId(paths);
  if (existing) {
    await client.resumeThread(existing, threadOptions(paths));
    log.info(`resumed thread ${existing}`);
    return existing;
  }
  const tid = await client.startThread(threadOptions(paths));
  saveThreadId(paths, tid);
  log.info(`started thread ${tid}`);
  return tid;
}

async function resumeExistingThread(
  client: CodexAppServerClient,
  paths: AgentPaths,
  threadId: string,
  log: ReturnType<typeof createLogger>
): Promise<void> {
  await client.resumeThread(threadId, threadOptions(paths));
  log.info(`resumed thread ${threadId}`);
}

async function processCompactRequest(
  paths: AgentPaths,
  client: CodexAppServerClient,
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
  let threadId: string | null = null;
  writeManualCompactStatus(paths, {
    state: "running",
    request_id: requestId,
    provider: "codex",
    requested_at: req.requested_at,
    started_at: startedAt,
  });
  appendEvent(paths, "manual_compact_started", {
    request_id: requestId,
    requested_at: req.requested_at,
  });

  try {
    if (req.provider !== "codex") {
      throw new Error(`unsupported compact provider: ${req.provider}`);
    }

    threadId = loadThreadId(paths);
    if (!threadId) {
      throw new Error("no codex thread to compact");
    }

    if (!client.isAlive()) {
      log.warn("app-server not alive; restarting before compact");
      await client.start();
    }

    await resumeExistingThread(client, paths, threadId, log);
    const before = scanCodexCompactLog(threadId);
    log.info(`manual compact starting for thread ${threadId}`);
    const completed = await client.compactThread(threadId);
    let obs = scanCodexCompactLog(threadId);
    for (let i = 0; i < 5 && obs.total <= before.total; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      obs = scanCodexCompactLog(threadId);
    }
    const synced = syncCompactState(paths, obs);
    writeManualCompactStatus(paths, {
      state: "succeeded",
      request_id: requestId,
      provider: "codex",
      requested_at: req.requested_at,
      started_at: startedAt,
      finished_at: utcnow(),
      thread_id: threadId,
      total_compacts: synced.compact.total_compacts,
      last_compact_at: synced.compact.last_compact_at,
    });
    appendEvent(paths, "manual_compact_succeeded", {
      request_id: requestId,
      thread_id: threadId,
      turn_id: completed.turnId,
      total_compacts: synced.compact.total_compacts,
      last_compact_at: synced.compact.last_compact_at,
    });
    log.info(`manual compact finished for thread ${threadId}`);
  } catch (err) {
    const message = (err as Error).message;
    writeManualCompactStatus(paths, {
      state: "failed",
      request_id: requestId,
      provider: "codex",
      requested_at: req.requested_at,
      started_at: startedAt,
      finished_at: utcnow(),
      error: message,
      thread_id: threadId ?? undefined,
    });
    appendEvent(paths, "manual_compact_failed", {
      request_id: requestId,
      thread_id: threadId,
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
  client: CodexAppServerClient,
  threadId: string,
  prompt: string,
  log: ReturnType<typeof createLogger>
): Promise<TurnTokens> {
  const result = await client.runTurn(
    { threadId, text: prompt },
    {
      onItemCompleted: (n) => {
        const item = n.item as {
          type?: string;
          text?: string;
          command?: string;
          exit_code?: number;
          server?: string;
          tool?: string;
          message?: string;
        };
        if (item.type === "agentMessage" && typeof item.text === "string") {
          log.info(`agent: ${item.text.slice(0, 200)}`);
          appendEvent(paths, "agent_text", { text: item.text });
        } else if (item.type === "commandExecution") {
          log.info(`cmd: ${String(item.command ?? "").slice(0, 160)} exit=${item.exit_code ?? "?"}`);
          appendEvent(paths, "command_execution", {
            command: item.command,
            exit_code: item.exit_code,
          });
        } else if (item.type === "mcpToolCall") {
          log.info(`tool: ${item.server ?? ""}:${item.tool ?? ""}`);
          appendEvent(paths, "tool_use", { server: item.server, tool: item.tool });
        } else if (item.type === "fileChange") {
          log.info(`file_change`);
          appendEvent(paths, "file_change", n.item);
        }
      },
    }
  );
  const last = result.tokenUsage?.last;
  const total = result.tokenUsage?.total;
  const tokens: TurnTokens = {
    input_tokens: last?.inputTokens ?? 0,
    output_tokens: last?.outputTokens ?? 0,
    cached_input_tokens: last?.cachedInputTokens ?? 0,
    estimated_context_tokens: total?.totalTokens ?? last?.totalTokens ?? 0,
  };
  log.info(
    `heartbeat ok. tokens in=${tokens.input_tokens} out=${tokens.output_tokens} cached=${tokens.cached_input_tokens} ctx=${tokens.estimated_context_tokens}`
  );
  return tokens;
}

async function main(): Promise<void> {
  const { agentDir } = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(agentDir);
  const identity = loadIdentity(paths);
  const log = createLogger(paths, "runtime");

  checkAndWritePid(paths, "runtime");

  const client = new CodexAppServerClient({
    info: (m) => log.info(m),
    warn: (m) => log.warn(m),
    error: (m) => log.error(m),
  });

  process.on("SIGINT", () => {
    log.info("SIGINT received");
    shuttingDown = true;
    void client
      .stop()
      .catch((err) => log.warn(`app-server stop on SIGINT failed: ${(err as Error).message}`));
  });
  process.on("SIGTERM", () => {
    log.info("SIGTERM received");
    shuttingDown = true;
    void client
      .stop()
      .catch((err) => log.warn(`app-server stop on SIGTERM failed: ${(err as Error).message}`));
  });

  writeInterval(paths, readInterval(paths, identity.runtime.default_interval_minutes));

  log.info(`starting ${identity.agent_name} on codex runtime (app-server)`);
  await client.start();

  let firstHeartbeat = loadThreadId(paths) === null;

  try {
    while (!shuttingDown) {
      if (await processCompactRequest(paths, client, log)) {
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

      if (!client.isAlive()) {
        log.warn("app-server not alive; restarting");
        await client.start();
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
      let threadId: string | null = null;
      let tokens: TurnTokens = {};
      try {
        threadId = await ensureThread(client, paths, log);
        tokens = await invokeAgent(paths, client, threadId, prompt, log);
      } catch (err) {
        invokeOk = false;
        const msg = (err as Error).message;
        log.error(`invoke error: ${msg}`);
        appendEvent(paths, "error", { phase: "invoke", message: msg });
        try {
          log.warn("restarting app-server after invoke error");
          await client.restart();
        } catch (restartErr) {
          const restartMsg = (restartErr as Error).message;
          log.error(`app-server restart error: ${restartMsg}`);
          appendEvent(paths, "error", { phase: "restart", message: restartMsg });
        }
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
          observeCompact: () => (threadId ? scanCodexCompactLog(threadId) : null),
        },
        log
      );
      firstHeartbeat = invokeOk ? false : loadThreadId(paths) === null;

      if (hasAnyPending(paths)) {
        log.info("more pending messages; continuing immediately");
        continue;
      }

      const interval = readInterval(paths, identity.runtime.default_interval_minutes);
      log.info(`sleeping ${interval}m`);
      await sleepWithWakeup(paths, interval * 60, () => shuttingDown);
    }
  } finally {
    try {
      await client.stop();
    } catch {
      /* ignore */
    }
    cleanupPid(paths, "runtime");
    log.info("runtime stopped");
  }
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).stack || err}`);
  process.exit(1);
});
