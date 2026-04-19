// basic-agent/src/entry/scheduled.ts
// Scheduler-invoked wake-up entry (cron / launchd / Task Scheduler). Identical
// argv contract as `one-shot.ts`; the only observable difference is the
// origin="scheduled" tag that `runWakeUp` logs to stderr. Invoked from a
// pre-built dist (cron hot path must NOT pay a tsc cost — run-once.sh carries
// the compile-then-run pattern for manual use instead).
import { runWakeUp } from "./wake-up.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error("usage: scheduled <wake-up prompt>");
  process.exit(2);
}

const code = await runWakeUp({ prompt, origin: "scheduled" });
process.exit(code);
