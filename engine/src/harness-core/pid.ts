import fs from "node:fs";
import path from "node:path";
import type { AgentPaths } from "./types.js";

export type ProcessName = "runtime" | "supervisor" | "bridge" | "web-ui";

function pidPath(paths: AgentPaths, name: ProcessName): string {
  return path.join(paths.pidsDir, name);
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function checkAndWritePid(paths: AgentPaths, name: ProcessName): void {
  fs.mkdirSync(paths.pidsDir, { recursive: true });
  const file = pidPath(paths, name);

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8").trim();
    const oldPid = parseInt(raw, 10);
    if (Number.isFinite(oldPid) && isRunning(oldPid)) {
      throw new Error(`${name} already running (pid ${oldPid})`);
    }
    fs.unlinkSync(file);
  }

  fs.writeFileSync(file, String(process.pid), "utf8");

  if (name === "supervisor") {
    fs.writeFileSync(paths.pidFile, String(process.pid), "utf8");
  }
}

export function cleanupPid(paths: AgentPaths, name: ProcessName): void {
  try {
    fs.unlinkSync(pidPath(paths, name));
  } catch {
    /* ignore */
  }
  if (name === "supervisor") {
    try {
      fs.unlinkSync(paths.pidFile);
    } catch {
      /* ignore */
    }
  }
}
