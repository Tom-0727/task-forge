import fs from "node:fs";
import type { AgentPaths, WorkSchedule } from "./types.js";

export function loadWorkSchedule(paths: AgentPaths): WorkSchedule | null {
  if (!fs.existsSync(paths.workScheduleFile)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(paths.workScheduleFile, "utf8"));
    if (!data || typeof data !== "object") return null;
    if (!Array.isArray(data.windows) || data.windows.length === 0) return null;
    return data as WorkSchedule;
  } catch {
    return null;
  }
}

function parseHHMM(hhmm: string): [number, number] {
  const parts = (hhmm || "00:00").trim().split(":");
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
}

interface TzNow {
  isoWeekday: number;
  hour: number;
  minute: number;
  second: number;
}

function nowInTz(tz: string): TzNow {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(new Date())) {
    parts[type] = value;
  }
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    isoWeekday: weekdayMap[parts.weekday] || 1,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

export function isInWorkWindow(s: WorkSchedule): boolean {
  const now = nowInTz(s.timezone);
  const cur = now.hour * 60 + now.minute;
  for (const w of s.windows) {
    if (!(w.days || []).includes(now.isoWeekday)) continue;
    const [sh, sm] = parseHHMM(w.start);
    const [eh, em] = parseHHMM(w.end);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (cur >= start && cur < end) return true;
  }
  return false;
}

export function secondsUntilNextWindow(s: WorkSchedule): number {
  const now = nowInTz(s.timezone);
  const cur = now.hour * 60 + now.minute;
  let best: number | null = null;
  for (let off = 0; off < 8; off++) {
    const day = ((now.isoWeekday - 1 + off) % 7) + 1;
    for (const w of s.windows) {
      if (!(w.days || []).includes(day)) continue;
      const [sh, sm] = parseHHMM(w.start);
      const start = sh * 60 + sm;
      if (off === 0 && start <= cur) continue;
      const minutesAway = off * 1440 + (start - cur);
      const secondsAway = minutesAway * 60 - now.second;
      if (best === null || secondsAway < best) best = secondsAway;
    }
  }
  return Math.max(best ?? 3600, 60);
}
