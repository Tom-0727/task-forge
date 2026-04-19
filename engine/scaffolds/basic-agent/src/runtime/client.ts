// basic-agent/src/runtime/client.ts
// Factory for the codex-sdk client and thread handle.
//
// IMPORTANT: `skipGitRepoCheck: true` is LOAD-BEARING. Without it, CodexExec
// refuses to start with "Not inside a trusted directory and
// --skip-git-repo-check was not specified" whenever basic-agent/ is not a git
// repo. Empirically discovered in ep.20260419T112500Z probe-stream run. Do
// NOT remove without making basic-agent/ a git repo.
import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";

export function createClient(): Codex {
  // Codex() reads auth from the host's codex login; no API key needs to be
  // injected here (server-side codex auth, per mail.20260419T093100Z.001).
  return new Codex();
}

export function startBasicThread(
  codex: Codex,
  opts: Omit<ThreadOptions, "skipGitRepoCheck"> = {},
): Thread {
  return codex.startThread({ skipGitRepoCheck: true, ...opts });
}
