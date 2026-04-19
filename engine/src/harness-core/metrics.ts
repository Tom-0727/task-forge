import fs from "node:fs";
import type { AgentPaths } from "./types.js";
import { utcnow } from "./time.js";

export interface TurnTokens {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  estimated_context_tokens?: number;
}

export interface HeartbeatMetrics {
  count: number;
  last_duration_seconds: number;
  avg_duration_seconds: number;
  total_duration_seconds: number;
}

export interface CompactMetrics {
  threshold: number;
  count_since_last: number;
  total_compacts: number;
  total_heartbeats_between_compacts: number;
  avg_heartbeats_between: number;
  last_compact_at: string | null;
}

export interface TokenMetrics {
  last_turn: TurnTokens;
  estimated_context_tokens: number;
  lifetime: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    cached_input_tokens: number;
  };
}

export interface Metrics {
  schema_version: 1;
  heartbeat: HeartbeatMetrics;
  compact: CompactMetrics;
  tokens: TokenMetrics;
  last_updated: string;
}

function defaultMetrics(): Metrics {
  return {
    schema_version: 1,
    heartbeat: {
      count: 0,
      last_duration_seconds: 0,
      avg_duration_seconds: 0,
      total_duration_seconds: 0,
    },
    compact: {
      threshold: 0,
      count_since_last: 0,
      total_compacts: 0,
      total_heartbeats_between_compacts: 0,
      avg_heartbeats_between: 0,
      last_compact_at: null,
    },
    tokens: {
      last_turn: {},
      estimated_context_tokens: 0,
      lifetime: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cached_input_tokens: 0,
      },
    },
    last_updated: utcnow(),
  };
}

export function readMetrics(paths: AgentPaths): Metrics {
  try {
    const raw = fs.readFileSync(paths.metricsFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<Metrics>;
    const base = defaultMetrics();
    return {
      schema_version: 1,
      heartbeat: { ...base.heartbeat, ...(parsed.heartbeat ?? {}) },
      compact: { ...base.compact, ...(parsed.compact ?? {}) },
      tokens: {
        last_turn: { ...(parsed.tokens?.last_turn ?? {}) },
        estimated_context_tokens:
          parsed.tokens?.estimated_context_tokens ?? 0,
        lifetime: { ...base.tokens.lifetime, ...(parsed.tokens?.lifetime ?? {}) },
      },
      last_updated: parsed.last_updated ?? base.last_updated,
    };
  } catch {
    return defaultMetrics();
  }
}

export function writeMetrics(paths: AgentPaths, m: Metrics): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  m.last_updated = utcnow();
  fs.writeFileSync(paths.metricsFile, JSON.stringify(m, null, 2), "utf8");
}

export interface HeartbeatSample {
  durationSeconds: number;
  tokens: TurnTokens;
  compactThreshold: number;
}

export function recordHeartbeat(paths: AgentPaths, sample: HeartbeatSample): Metrics {
  const m = readMetrics(paths);

  const hb = m.heartbeat;
  hb.count += 1;
  hb.last_duration_seconds = sample.durationSeconds;
  hb.total_duration_seconds += sample.durationSeconds;
  hb.avg_duration_seconds = hb.total_duration_seconds / hb.count;

  m.compact.threshold = sample.compactThreshold;
  m.compact.count_since_last += 1;

  const t = sample.tokens;
  m.tokens.last_turn = { ...t };
  if (typeof t.estimated_context_tokens === "number") {
    m.tokens.estimated_context_tokens = t.estimated_context_tokens;
  }
  const lt = m.tokens.lifetime;
  lt.input_tokens += t.input_tokens ?? 0;
  lt.output_tokens += t.output_tokens ?? 0;
  lt.cache_read_input_tokens += t.cache_read_input_tokens ?? 0;
  lt.cache_creation_input_tokens += t.cache_creation_input_tokens ?? 0;
  lt.cached_input_tokens += t.cached_input_tokens ?? 0;

  writeMetrics(paths, m);
  return m;
}

export function recordCompactSuccess(paths: AgentPaths): Metrics {
  const m = readMetrics(paths);
  const c = m.compact;
  c.total_compacts += 1;
  c.total_heartbeats_between_compacts += c.count_since_last;
  c.avg_heartbeats_between =
    c.total_compacts > 0
      ? c.total_heartbeats_between_compacts / c.total_compacts
      : 0;
  c.count_since_last = 0;
  c.last_compact_at = utcnow();
  writeMetrics(paths, m);
  return m;
}

export function updateCompactThreshold(paths: AgentPaths, threshold: number): void {
  const m = readMetrics(paths);
  if (m.compact.threshold === threshold) return;
  m.compact.threshold = threshold;
  writeMetrics(paths, m);
}
