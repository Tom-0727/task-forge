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
  decidePreInvoke,
  clearUnchangedPending,
  hasAnyPending,
  sleepWithWakeup,
  type AgentIdentity,
  type AgentPaths,
} from "../harness-core/index.js";
import { Codex, type ThreadOptions, type ThreadEvent } from "@openai/codex-sdk";

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

async function invokeAgent(
  paths: AgentPaths,
  identity: AgentIdentity,
  prompt: string,
  log: ReturnType<typeof createLogger>
): Promise<void> {
  const threadId = loadThreadId(paths);
  const codex = new Codex({});

  const threadOptions: ThreadOptions = {
    workingDirectory: paths.agentDir,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    networkAccessEnabled: true,
    webSearchEnabled: true,
  };

  const thread = threadId
    ? codex.resumeThread(threadId, threadOptions)
    : codex.startThread(threadOptions);

  log.info(threadId ? `resuming thread ${threadId}` : "starting new thread");

  const { events } = await thread.runStreamed(prompt);

  for await (const event of events as AsyncGenerator<ThreadEvent>) {
    if (event.type === "thread.started") {
      saveThreadId(paths, event.thread_id);
    } else if (event.type === "item.completed") {
      const item = event.item;
      if (item.type === "agent_message") {
        log.info(`agent: ${item.text.slice(0, 200)}`);
      } else if (item.type === "command_execution") {
        log.info(`cmd: ${item.command.slice(0, 160)} exit=${item.exit_code ?? "?"}`);
      } else if (item.type === "mcp_tool_call") {
        log.info(`tool: ${item.server}:${item.tool}`);
      } else if (item.type === "file_change") {
        log.info(`file_change: ${item.changes.length} files status=${item.status}`);
      } else if (item.type === "error") {
        log.warn(`item error: ${item.message}`);
      }
    } else if (event.type === "turn.completed") {
      const u = event.usage;
      log.info(
        `heartbeat ok. tokens in=${u.input_tokens} out=${u.output_tokens} cached=${u.cached_input_tokens}`
      );
    } else if (event.type === "turn.failed") {
      log.warn(`heartbeat failed: ${event.error.message}`);
    } else if (event.type === "error") {
      log.error(`stream error: ${event.message}`);
    }
  }
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

  log.info(`starting ${identity.agent_name} on codex runtime`);
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

      try {
        await invokeAgent(paths, identity, decision.prompt!, log);
      } catch (err) {
        log.error(`invoke error: ${(err as Error).message}`);
      } finally {
        clearUnchangedPending(paths, decision.pendingSnapshot ?? {});
      }
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
