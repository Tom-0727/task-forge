import fs from "node:fs";
import type { AgentPaths, RuntimeState } from "./types.js";
import { utcnow } from "./time.js";

export function writeState(paths: AgentPaths, s: RuntimeState): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.stateFile, s, "utf8");
}

export function writeHeartbeat(paths: AgentPaths): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.heartbeatFile, utcnow(), "utf8");
}

export function readInterval(paths: AgentPaths, fallback: number): number {
  try {
    const raw = fs.readFileSync(paths.intervalFile, "utf8").trim();
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* fall through */
  }
  return fallback;
}

export function writeInterval(paths: AgentPaths, minutes: number): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.intervalFile, String(minutes), "utf8");
}

export function isPassiveMode(paths: AgentPaths): boolean {
  return fs.existsSync(paths.passiveModeFile);
}

export function readCompactInterval(paths: AgentPaths, fallback: number): number {
  try {
    const raw = fs.readFileSync(paths.compactIntervalFile, "utf8").trim();
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* fall through */
  }
  return fallback;
}

export function writeCompactInterval(paths: AgentPaths, n: number): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.compactIntervalFile, String(n), "utf8");
}
