import fs from "node:fs";
import type { AgentPaths, Provider } from "./types.js";
import { utcnow } from "./time.js";

export type ManualCompactState = "pending" | "running" | "succeeded" | "failed";

export interface CompactRequest {
  id: string;
  provider: Provider;
  requested_at: string;
  requested_by?: string;
}

export interface ManualCompactStatus {
  state: ManualCompactState;
  request_id: string;
  provider: Provider;
  requested_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  thread_id?: string;
  session_id?: string;
  total_compacts?: number;
  last_compact_at?: string | null;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function hasCompactRequest(paths: AgentPaths): boolean {
  return fs.existsSync(paths.compactRequestFile);
}

export function readCompactRequest(paths: AgentPaths): CompactRequest | null {
  const req = readJson<Partial<CompactRequest>>(paths.compactRequestFile);
  if (!req || typeof req.id !== "string" || typeof req.provider !== "string") return null;
  return {
    id: req.id,
    provider: req.provider as Provider,
    requested_at: typeof req.requested_at === "string" ? req.requested_at : utcnow(),
    requested_by: typeof req.requested_by === "string" ? req.requested_by : undefined,
  };
}

export function clearCompactRequest(paths: AgentPaths, requestId?: string): void {
  if (requestId) {
    const current = readCompactRequest(paths);
    if (current && current.id !== requestId) return;
  }
  try {
    fs.unlinkSync(paths.compactRequestFile);
  } catch {
    /* already gone */
  }
}

export function readManualCompactStatus(paths: AgentPaths): ManualCompactStatus | null {
  return readJson<ManualCompactStatus>(paths.compactStatusFile);
}

export function writeManualCompactStatus(paths: AgentPaths, status: ManualCompactStatus): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  writeJsonAtomic(paths.compactStatusFile, status);
}
