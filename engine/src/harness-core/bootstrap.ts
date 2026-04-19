import fs from "node:fs";
import type { AgentPaths, BootstrapPhase } from "./types.js";

export function readBootstrapPhase(paths: AgentPaths): BootstrapPhase {
  if (!fs.existsSync(paths.bootstrapStateFile)) return "done";
  try {
    const data = JSON.parse(fs.readFileSync(paths.bootstrapStateFile, "utf8"));
    if (!data || typeof data !== "object") return "done";
    const phase = (data as { phase?: unknown }).phase;
    if (phase === "prd" || phase === "design" || phase === "done") return phase;
    return "done";
  } catch {
    return "done";
  }
}

export function buildBootstrapNotice(phase: BootstrapPhase): string {
  if (phase === "done") return "";
  return [
    `BOOTSTRAP ACTIVE — phase: ${phase}`,
    "You are NOT allowed to do business implementation work this heartbeat. " +
      "Before any other action, use the `bootstrap-sdlc` skill and obey its " +
      "Protocol section in full. Only the files permitted there may be " +
      "written this heartbeat.",
  ].join("\n");
}
