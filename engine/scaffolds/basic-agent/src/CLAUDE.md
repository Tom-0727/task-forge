# src/ — Execution Layer (TypeScript runtime)

This subtree is the runtime that glues `@openai/codex-sdk` into a wake-up-driven agent. It is stable infrastructure; downstream vertical agents should not normally edit files here.

- Keep relative imports ESM-compatible: every local import must use the compiled `.js` suffix.
- Keep `skipGitRepoCheck: true` concentrated inside `runtime/client.ts`.
- Write per-run AGENTS.md overlays under `.runs/<runId>/`, not over the baseline `AGENTS.md`.
- Read `../CLAUDE.md` and `../../Memory/knowledge/conceptual/conceptual--bootstrap--architecture.md` before changing module boundaries.
