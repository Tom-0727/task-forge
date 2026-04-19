import fs from "node:fs";
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
  type AgentPaths,
  type TurnTokens,
} from "../harness-core/index.js";
import { CodexAppServerClient } from "./app-server-client.js";

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

async function ensureThread(
  client: CodexAppServerClient,
  paths: AgentPaths,
  log: ReturnType<typeof createLogger>
): Promise<string> {
  const existing = loadThreadId(paths);
  if (existing) {
    await client.resumeThread(existing, {
      sandbox: "workspace-write",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });
    log.info(`resumed thread ${existing}`);
    return existing;
  }
  const tid = await client.startThread({
    cwd: paths.agentDir,
    sandbox: "workspace-write",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
  });
  saveThreadId(paths, tid);
  log.info(`started thread ${tid}`);
  return tid;
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
  const u = result.usage ?? {};
  const inputT = u.input_tokens ?? 0;
  const tokens: TurnTokens = {
    input_tokens: inputT,
    output_tokens: u.output_tokens ?? 0,
    cached_input_tokens: u.cached_input_tokens ?? 0,
    estimated_context_tokens: inputT,
  };
  log.info(
    `heartbeat ok. tokens in=${inputT} out=${tokens.output_tokens} cached=${tokens.cached_input_tokens} ctx=${tokens.estimated_context_tokens}`
  );
  return tokens;
}

async function invokeCompact(
  client: CodexAppServerClient,
  threadId: string,
  log: ReturnType<typeof createLogger>
): Promise<boolean> {
  let sawCompactionItem = false;
  await client.compactThread(threadId, {
    onItemCompleted: (n) => {
      const item = n.item as { type?: string };
      if (item.type === "contextCompaction") sawCompactionItem = true;
    },
  });
  log.info(`compact ok (compactionItem=${sawCompactionItem})`);
  return true;
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
  });
  process.on("SIGTERM", () => {
    log.info("SIGTERM received");
    shuttingDown = true;
  });

  writeInterval(paths, readInterval(paths, identity.runtime.default_interval_minutes));

  log.info(`starting ${identity.agent_name} on codex runtime (app-server)`);
  await client.start();

  let firstHeartbeat = loadThreadId(paths) === null;

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

      if (!client.isAlive()) {
        log.warn("app-server not alive; restarting");
        await client.start();
      }

      const threshold = readCompactInterval(
        paths,
        identity.runtime.default_compact_every_n_heartbeats
      );
      updateCompactThreshold(paths, threshold);

      appendEvent(paths, "heartbeat_start", {});
      const startedAt = Date.now();
      let invokeOk = true;
      let threadId: string | null = null;
      let tokens: TurnTokens = {};
      try {
        threadId = await ensureThread(client, paths, log);
        tokens = await invokeAgent(paths, client, threadId, decision.prompt!, log);
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

      if (invokeOk && m && threadId && threshold > 0 && m.compact.count_since_last >= threshold) {
        log.info(
          `compact threshold reached (${m.compact.count_since_last}/${threshold}); compacting`
        );
        appendEvent(paths, "compact_start", {
          count_since_last: m.compact.count_since_last,
          threshold,
        });
        try {
          const ok = await invokeCompact(client, threadId, log);
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
