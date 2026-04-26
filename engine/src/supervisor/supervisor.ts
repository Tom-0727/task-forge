import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolvePaths,
  loadIdentity,
  checkAndWritePid,
  cleanupPid,
  writeState,
  createLogger,
} from "../harness-core/index.js";

const BACKOFF_SEQ = [10, 30, 120, 600];
const MAX_CRASHES = 10;

function parseArgs(argv: string[]): { agentDir: string } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent-dir" && argv[i + 1]) {
      return { agentDir: argv[i + 1] };
    }
  }
  throw new Error("supervisor: missing --agent-dir");
}

function engineRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..");
}

function runEngineEnsure(log: ReturnType<typeof createLogger>): boolean {
  const script = path.join(engineRoot(), "bin", "engine-ensure.sh");
  const result = spawnSync(script, [], { stdio: "inherit" });
  if (result.status !== 0) {
    log.error(`engine-ensure.sh failed with status ${result.status}`);
    return false;
  }
  return true;
}

function runtimeEntrypoint(provider: string): string {
  const dist = path.join(engineRoot(), "dist");
  if (provider === "claude") return path.join(dist, "claude", "runtime.js");
  if (provider === "codex") return path.join(dist, "codex", "runtime.js");
  throw new Error(`unknown provider: ${provider}`);
}

async function main(): Promise<void> {
  const { agentDir } = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(agentDir);
  const log = createLogger(paths, "supervisor");

  checkAndWritePid(paths, "supervisor");

  let shuttingDown = false;
  let child: ReturnType<typeof spawn> | null = null;
  let finalState: "stopped" | "engine_build_failed" | "crashed" = "stopped";
  let exitCode = 0;

  const forward = (sig: NodeJS.Signals) => {
    shuttingDown = true;
    log.info(`received ${sig}, forwarding to child`);
    if (child && !child.killed) child.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  try {
    const identity = loadIdentity(paths);
    log.info(`supervisor starting for ${identity.agent_name} (${identity.provider})`);

    if (!runEngineEnsure(log)) {
      finalState = "engine_build_failed";
      exitCode = 1;
      return;
    }

    const entry = runtimeEntrypoint(identity.provider);
    let crashCount = 0;

    while (!shuttingDown) {
      log.info(`spawning runtime: node ${entry}`);
      child = spawn(process.execPath, [entry, "--agent-dir", paths.agentDir], {
        stdio: "inherit",
        env: { ...process.env, AGENT_DIR: paths.agentDir },
      });

      const exitInfo: { code: number | null; signal: NodeJS.Signals | null } =
        await new Promise((resolve) => {
          child!.on("exit", (code, signal) => resolve({ code, signal }));
        });
      child = null;

      if (shuttingDown) {
        log.info("shutdown requested; exiting");
        break;
      }

      if (exitInfo.code === 0) {
        log.info("runtime exited cleanly");
        break;
      }

      crashCount += 1;
      log.warn(
        `runtime exited with code=${exitInfo.code} signal=${exitInfo.signal} crashCount=${crashCount}`
      );

      if (crashCount >= MAX_CRASHES) {
        log.error(`runtime crashed ${MAX_CRASHES} times; giving up`);
        finalState = "crashed";
        exitCode = 1;
        return;
      }

      const waitSec = BACKOFF_SEQ[Math.min(crashCount - 1, BACKOFF_SEQ.length - 1)];
      log.info(`backing off ${waitSec}s before restart`);
      await sleepInterruptible(waitSec * 1000, () => shuttingDown);
    }
  } catch (err) {
    log.error(`supervisor error: ${(err as Error).message}`);
    finalState = "crashed";
    exitCode = 1;
  } finally {
    writeState(paths, finalState);
    cleanupPid(paths, "supervisor");
    log.info(`supervisor stopped state=${finalState}`);
    if (exitCode !== 0) process.exitCode = exitCode;
  }
}

async function sleepInterruptible(ms: number, shouldStop: () => boolean): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (shouldStop()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

main();
