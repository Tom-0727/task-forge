// basic-agent/src/entry/wake-up.ts
// Shared wake-up pipeline. Both `one-shot.ts` and `scheduled.ts` delegate to
// `runWakeUp` so the invocation surface stays trivial and the pipeline is
// maintained in one place. The only metadata difference between the two
// entries is the `origin` tag logged to stderr.
//
// Side-effect policy: no top-level await here — the module exports a function
// and has no side effects on import. The entry files own the top-level
// `await runWakeUp(...)` + `process.exit(...)` dance.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, startBasicThread } from "../runtime/client.js";
import { driveTurn } from "../runtime/run.js";
import { composeSystemPrompt } from "../loaders/system-prompt.js";
import { enumerateSkills } from "../loaders/skills.js";
import { createRecorder } from "../trajectory/recorder.js";

export type WakeUpOrigin = "one-shot" | "scheduled";

export interface WakeUpArgs {
  prompt: string;
  origin: WakeUpOrigin;
}

function genRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const salt = Math.random().toString(36).slice(2, 8);
  return `${ts}-${salt}`;
}

export async function runWakeUp(args: WakeUpArgs): Promise<number> {
  const { prompt, origin } = args;
  if (!prompt) {
    console.error("[basic-agent] runWakeUp: empty prompt");
    return 2;
  }

  // __dirname at runtime is dist/entry; walk up two levels to reach basic-agent/.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const agentRoot = path.resolve(__dirname, "..", "..");

  const runId = genRunId();
  const trajectoryDir = path.join(agentRoot, "trajectories");
  const recorder = createRecorder(runId, trajectoryDir);

  console.error(`[basic-agent] runId=${runId}`);
  console.error(`[basic-agent] origin=${origin}`);
  console.error(`[basic-agent] trajectory=${recorder.path}`);

  // Compose the derived AGENTS.md overlay into a per-run cwd BEFORE startThread.
  const composed = await composeSystemPrompt({
    agentRoot,
    runId,
    wakeUpPrompt: prompt,
  });
  console.error(`[basic-agent] derivedAgentsMd=${composed.derivedAgentsMdPath}`);
  console.error(`[basic-agent] workingDirectory=${composed.workingDirectory}`);

  // Diagnostic-only skill catalog (codex itself auto-discovers .agents/skills/).
  const skills = await enumerateSkills(agentRoot);
  const skillIds =
    skills.length > 0 ? skills.map((s) => s.id).join(",") : "(none)";
  console.error(`[basic-agent] skills: ${skillIds}`);

  let exitCode = 1;
  let sawCompletion = false;

  try {
    const codex = createClient();
    const thread = startBasicThread(codex, {
      workingDirectory: composed.workingDirectory,
    });
    for await (const evt of driveTurn(thread, prompt)) {
      recorder.write(evt);
      const etype = (evt as { type?: string }).type ?? "unknown";
      console.error(`[basic-agent] event: ${etype}`);
      if (etype === "turn.completed") {
        sawCompletion = true;
        exitCode = 0;
      } else if (etype === "turn.failed" || etype === "thread.error") {
        exitCode = 1;
      }
    }
    if (!sawCompletion && exitCode === 1) {
      console.error("[basic-agent] stream ended without turn.completed");
    }
  } catch (err) {
    console.error(`[basic-agent] error: ${String(err)}`);
    exitCode = 1;
  } finally {
    await recorder.close();
  }

  console.log(
    JSON.stringify({ runId, trajectory: recorder.path, exitCode, origin }),
  );
  return exitCode;
}
