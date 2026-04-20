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
- 用中文回答