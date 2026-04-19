// basic-agent/src/loaders/system-prompt.ts
// Resolves AGENTS.md layering: composes the per-run wake-up input with the
// durable AGENTS.md baseline into a derived AGENTS.md in the thread's cwd
// BEFORE codex starts the thread. Codex auto-discovers AGENTS.md via its
// root-down merge at run start (assumption A14).
//
// Load-bearing design choice: we never write the overlay into <agentRoot>/
// directly (that would clobber the baseline AGENTS.md). Instead we create a
// per-run subdirectory `<agentRoot>/.runs/<runId>/` and use it as the thread's
// workingDirectory. Codex then merges the baseline (at agentRoot) with the
// overlay (at the per-run dir) via root-down discovery. See
// Memory/knowledge/conceptual/conceptual--bootstrap--architecture.md §2
// and assumption A14.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ComposeOpts {
  agentRoot: string;
  runId: string;
  wakeUpPrompt: string;
}

export interface ComposeResult {
  workingDirectory: string;
  derivedAgentsMdPath: string;
}

// Defensive ceiling — expected wake-up prompts are tiny (KBs at most), but
// codex's project_doc_max_bytes is 32 KiB total across the merge. We warn +
// truncate well under that so the baseline always fits.
const WAKEUP_SOFT_LIMIT_BYTES = 60_000;

export async function composeSystemPrompt(
  opts: ComposeOpts,
): Promise<ComposeResult> {
  const { agentRoot, runId, wakeUpPrompt } = opts;
  const workingDirectory = path.join(agentRoot, ".runs", runId);
  await fs.mkdir(workingDirectory, { recursive: true });

  let body = wakeUpPrompt;
  const byteLen = Buffer.byteLength(body, "utf8");
  if (byteLen > WAKEUP_SOFT_LIMIT_BYTES) {
    console.error(
      `[basic-agent] warning: wakeUpPrompt is ${byteLen} bytes; truncating to ${WAKEUP_SOFT_LIMIT_BYTES}`,
    );
    // Truncate conservatively by bytes — slice on characters may leave a
    // multi-byte sequence intact since UTF-16 JS string ops are char-indexed.
    const buf = Buffer.from(body, "utf8").subarray(0, WAKEUP_SOFT_LIMIT_BYTES);
    body = buf.toString("utf8");
  }

  const derivedAgentsMdPath = path.join(workingDirectory, "AGENTS.md");
  const content = `# Per-run wake-up guidance\n\n${body}\n`;
  await fs.writeFile(derivedAgentsMdPath, content, "utf8");

  return { workingDirectory, derivedAgentsMdPath };
}
