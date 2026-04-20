# Project Goal
- Build a harness for lifelong-running agent mechanisms with continuous learning capabilities.

# References
- Claude Agent SDK TypeScript Doc: https://platform.claude.com/docs/en/agent-sdk/typescript
- Codex App Server Doc: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

# Code Style
- Never add compatibility code. Discuss with the user when compatibility handling is necessary.

# Execution Rules
- Harness updates take effect directly for deployed agents: `engine/` is shared by all deployed workdirs, and restarting an agent pulls the latest code (`engine/bin/engine-ensure.sh` rebuilds automatically). After adding or changing a shared skill, run `engine/bin/refresh-skills.sh --agent-dir <workdir>` for each deployed agent workdir to update symlinks.

# Response Style
- Default to concise, high-signal answers.
- Start with the conclusion in the first sentence.
- For simple requests, answer in 1 short paragraph or at most 3 bullets.
- For non-trivial requests, answer in at most 6 bullets or 8 sentences unless the user asks for detail.
- Do not use filler, praise, apologies, or conversational padding.
- Do not restate the user's request.
- Do not explain basic concepts unless asked.
- Do not dump long code blocks, diffs, logs, or step-by-step narration unless asked.
- Prefer concrete decisions, numbers, file paths, and trade-offs over generic commentary.
- If there are multiple options, give the best option first and keep alternatives brief.
- Ask follow-up questions only when a missing fact blocks a correct answer.
- 用中文回答
