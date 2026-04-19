import fs from "node:fs";
import type { AgentIdentity, AgentPaths } from "./types.js";

export function loadIdentity(paths: AgentPaths): AgentIdentity {
  const raw = fs.readFileSync(paths.identityFile, "utf8");
  const data = JSON.parse(raw) as AgentIdentity;
  if (data.schema_version !== 1) {
    throw new Error(`unsupported agent.json schema_version: ${data.schema_version}`);
  }
  if (!data.agent_name || !data.provider || !data.interaction || !data.runtime) {
    throw new Error(`agent.json missing required fields at ${paths.identityFile}`);
  }
  return data;
}

export function writeIdentity(paths: AgentPaths, id: AgentIdentity): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(
    paths.identityFile,
    JSON.stringify(id, null, 2) + "\n",
    "utf8"
  );
}
