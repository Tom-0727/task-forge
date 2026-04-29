import type { AgentPaths } from "./types.js";
import { hasAnyPending } from "./mailbox.js";
import { hasCompactRequest } from "./compact.js";

export async function sleepWithWakeup(
  paths: AgentPaths,
  seconds: number,
  shouldStop: () => boolean
): Promise<void> {
  const total = Math.max(0, Math.floor(seconds));
  for (let slept = 0; slept < total; slept++) {
    if (shouldStop()) return;
    if (hasAnyPending(paths)) return;
    if (hasCompactRequest(paths)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
