// basic-agent/src/runtime/run.ts
// runStreamed orchestration: drive a single turn, yield every event verbatim.
// Callers (the one-shot entry) pipe the yielded events to the trajectory
// recorder and observe the terminal signal via for-await exit.
import type { Thread } from "@openai/codex-sdk";
import type { ThreadEvent } from "../trajectory/schema.js";

export async function* driveTurn(
  thread: Thread,
  input: string,
): AsyncGenerator<ThreadEvent> {
  const turn = await thread.runStreamed(input);
  for await (const evt of turn.events) {
    yield evt;
  }
}
