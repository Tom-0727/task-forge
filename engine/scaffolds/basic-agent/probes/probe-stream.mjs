// probe-stream.mjs — covers A3.iii (stream deterministic termination), A12
// (event payload JSON-serializability), A13 (consumer-side stream termination).
//
// Success:
// - for-await loop exits naturally (no hang)
// - totalEvents > 0
// - serializeFailures == 0
// - a turn.completed or turn.failed event is observed before termination
import { Codex } from "@openai/codex-sdk";

const SAFETY_TIMEOUT_MS = 120_000;

const codex = new Codex();
const thread = codex.startThread();
const events = [];
let serializeFailures = 0;
let firstSerializeError = null;
let sawTurnCompleted = false;
let sawTurnFailed = false;

const safety = setTimeout(() => {
  console.error(JSON.stringify({ probe: "probe-stream", verdict: "timeout", message: "for-await loop did not exit within SAFETY_TIMEOUT_MS" }));
  process.exit(2);
}, SAFETY_TIMEOUT_MS);

try {
  const turn = await thread.runStreamed("Reply with exactly the single word: ok");
  for await (const event of turn.events) {
    let line = null;
    try {
      line = JSON.stringify(event);
    } catch (e) {
      serializeFailures++;
      if (!firstSerializeError) firstSerializeError = String(e);
    }
    const type = event?.type ?? "unknown";
    events.push({ ok: line !== null, type, bytes: line?.length ?? 0 });
    if (type === "turn.completed") sawTurnCompleted = true;
    if (type === "turn.failed") sawTurnFailed = true;
  }
  clearTimeout(safety);
  const summary = {
    probe: "probe-stream",
    verdict: serializeFailures === 0 && (sawTurnCompleted || sawTurnFailed) && events.length > 0 ? "pass" : "partial",
    totalEvents: events.length,
    serializeFailures,
    firstSerializeError,
    sawTurnCompleted,
    sawTurnFailed,
    typeSequence: events.map((e) => e.type),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (e) {
  clearTimeout(safety);
  console.error(JSON.stringify({ probe: "probe-stream", verdict: "error", error: String(e), stack: e?.stack }, null, 2));
  process.exit(1);
}
