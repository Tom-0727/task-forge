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
  count_since_last: number;
  total_compacts: number;
  total_heartbeats_between_compacts: number;
  avg_heartbeats_between: number;
  last_compact_at: string | null;
  heartbeat_count_at_last_compact: number;
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
      count_since_last: 0,
      total_compacts: 0,
      total_heartbeats_between_compacts: 0,
      avg_heartbeats_between: 0,
      last_compact_at: null,
      heartbeat_count_at_last_compact: 0,
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
    const pc: Partial<CompactMetrics> = parsed.compact ?? {};
    return {
      schema_version: 1,
      heartbeat: { ...base.heartbeat, ...(parsed.heartbeat ?? {}) },
      compact: {
        count_since_last: pc.count_since_last ?? base.compact.count_since_last,
        total_compacts: pc.total_compacts ?? base.compact.total_compacts,
        total_heartbeats_between_compacts:
          pc.total_heartbeats_between_compacts ?? base.compact.total_heartbeats_between_compacts,
        avg_heartbeats_between: pc.avg_heartbeats_between ?? base.compact.avg_heartbeats_between,
        last_compact_at: pc.last_compact_at ?? base.compact.last_compact_at,
        heartbeat_count_at_last_compact:
          pc.heartbeat_count_at_last_compact ?? base.compact.heartbeat_count_at_last_compact,
      },
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

function finalizeCompactDerived(m: Metrics): void {
  const c = m.compact;
  c.count_since_last = Math.max(0, m.heartbeat.count - c.heartbeat_count_at_last_compact);
  c.total_heartbeats_between_compacts = c.heartbeat_count_at_last_compact;
  c.avg_heartbeats_between =
    c.total_compacts > 0 ? c.heartbeat_count_at_last_compact / c.total_compacts : 0;
}

export function writeMetrics(paths: AgentPaths, m: Metrics): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  finalizeCompactDerived(m);
  m.last_updated = utcnow();
  fs.writeFileSync(paths.metricsFile, JSON.stringify(m, null, 2), "utf8");
}

export interface HeartbeatSample {
  durationSeconds: number;
  tokens: TurnTokens;
}

export function recordHeartbeat(paths: AgentPaths, sample: HeartbeatSample): Metrics {
  const m = readMetrics(paths);

  const hb = m.heartbeat;
  hb.count += 1;
  hb.last_duration_seconds = sample.durationSeconds;
  hb.total_duration_seconds += sample.durationSeconds;
  hb.avg_duration_seconds = hb.total_duration_seconds / hb.count;

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

export interface CompactObservation {
  total: number;
  lastAt: string | null;
  // Timestamp of the heartbeat that just ran. Runtime callers must invoke
  // syncCompactState before appending heartbeat_end to events.jsonl; this ts
  // accounts for that still-unlogged current heartbeat when it is after lastAt.
  currentHeartbeatTs?: string | null;
}

function countHeartbeatEndsAfter(eventsFile: string, lastAt: string): number {
  let content: string;
  try {
    content = fs.readFileSync(eventsFile, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of content.split("\n")) {
    if (!line || line.indexOf('"heartbeat_end"') === -1) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.kind === "heartbeat_end" && typeof ev.ts === "string" && ev.ts > lastAt) {
        count += 1;
      }
    } catch {
      // ignore malformed line
    }
  }
  return count;
}

export function syncCompactState(paths: AgentPaths, obs: CompactObservation): Metrics {
  const m = readMetrics(paths);
  const c = m.compact;
  c.total_compacts = obs.total;
  if (obs.lastAt) {
    c.last_compact_at = obs.lastAt;
    const after = countHeartbeatEndsAfter(paths.eventsFile, obs.lastAt);
    const currentIsAfter = obs.currentHeartbeatTs && obs.currentHeartbeatTs > obs.lastAt ? 1 : 0;
    const heartbeatsSince = after + currentIsAfter;
    c.heartbeat_count_at_last_compact = Math.max(0, m.heartbeat.count - heartbeatsSince);
  }
  writeMetrics(paths, m);
  return m;
}

