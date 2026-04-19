import type { AgentIdentity, AgentPaths, HeartbeatDecision } from "./types.js";
import { loadWorkSchedule, isInWorkWindow, secondsUntilNextWindow } from "./schedule.js";
import {
  hasAnyAwaiting,
  hasAnyPending,
  clearAwaitingForPending,
  collectSnapshot,
  buildMailboxStatus,
} from "./mailbox.js";
import { isPassiveMode, readInterval } from "./state.js";
import { runPreHeartbeatHook } from "./todo.js";
import { buildPrompt } from "./prompt.js";

export function decidePreInvoke(
  paths: AgentPaths,
  identity: AgentIdentity,
  firstHeartbeat: boolean
): HeartbeatDecision {
  const schedule = loadWorkSchedule(paths);
  if (schedule && !isInWorkWindow(schedule)) {
    return {
      action: "skip_long_sleep",
      reason: "off_hours",
      sleepSeconds: secondsUntilNextWindow(schedule),
      stateUpdate: "off_hours",
    };
  }

  clearAwaitingForPending(paths);

  const intervalMin = readInterval(paths, identity.runtime.default_interval_minutes);

  if (hasAnyAwaiting(paths) && !hasAnyPending(paths)) {
    return {
      action: "skip_short_sleep",
      reason: "awaiting",
      sleepMinutes: intervalMin,
      stateUpdate: "running",
    };
  }

  if (isPassiveMode(paths) && !hasAnyPending(paths)) {
    return {
      action: "skip_short_sleep",
      reason: "passive",
      sleepMinutes: intervalMin,
      stateUpdate: "running",
    };
  }

  runPreHeartbeatHook(paths);

  const mailboxStatus = buildMailboxStatus(paths);
  const pendingSnapshot = collectSnapshot(paths);
  const prompt = buildPrompt(paths, identity, { firstHeartbeat, mailboxStatus });

  return {
    action: "invoke",
    prompt,
    pendingSnapshot,
    stateUpdate: "running",
  };
}
