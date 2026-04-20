// probe-skills.mjs — covers A10 (codex auto-discovery of .agents/skills/).
// Runs from basic-agent/ so cwd contains .agents/skills/sample-discovered-skill/SKILL.md.
// Success: the agent surfaces the skill name in its reply without programmatic registration.
import { Codex } from "@openai/codex-sdk";

const SAFETY_TIMEOUT_MS = 120_000;

const codex = new Codex();
const thread = codex.startThread();

const safety = setTimeout(() => {
  console.error(JSON.stringify({ probe: "probe-skills", verdict: "timeout" }));
  process.exit(2);
}, SAFETY_TIMEOUT_MS);

try {
  const turn = await thread.runStreamed(
    "List every skill currently available to you. For each, print its name on a separate line. If a skill named 'sample-discovered-skill' is available, print the literal token SAMPLE-SKILL-SENTINEL-SEEN right after its name."
  );
  const agentTextChunks = [];
  const eventTypes = [];
  for await (const event of turn.events) {
    eventTypes.push(event?.type ?? "unknown");
    if (event?.type === "item.completed" && event?.item?.type === "agent_message") {
      agentTextChunks.push(event.item.text);
    }
  }
  clearTimeout(safety);
  const combined = agentTextChunks.join("\n");
  const sentinelSeen = combined.includes("SAMPLE-SKILL-SENTINEL-SEEN");
  const nameSeen = /sample-discovered-skill/i.test(combined);
  const summary = {
    probe: "probe-skills",
    verdict: sentinelSeen ? "pass" : nameSeen ? "name-only" : "fail",
    sentinelSeen,
    nameSeen,
    eventTypes,
    agentText: combined,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (e) {
  clearTimeout(safety);
  console.error(JSON.stringify({ probe: "probe-skills", verdict: "error", error: String(e), stack: e?.stack }, null, 2));
  process.exit(1);
}
