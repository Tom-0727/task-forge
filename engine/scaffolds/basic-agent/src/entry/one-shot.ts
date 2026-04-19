// basic-agent/src/entry/one-shot.ts
// Canonical manual wake-up entry. Reads a prompt from argv and delegates to
// the shared `runWakeUp` pipeline with origin="one-shot". All of the actual
// runtime logic lives in `./wake-up.ts` — this file only handles argv parsing
// and process-exit plumbing.
import { runWakeUp } from "./wake-up.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error("usage: one-shot <wake-up prompt>");
  process.exit(2);
}

const code = await runWakeUp({ prompt, origin: "one-shot" });
process.exit(code);
