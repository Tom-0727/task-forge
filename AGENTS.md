# 项目目标
- 打造具有持续学习能力，LifeLong Running 的 Agent 机制的 Harness

# References
- Claude Python SDK Doc：https://platform.claude.com/docs/en/agent-sdk/python
- Codex SDK Doc: https://github.com/openai/codex/tree/main/sdk/typescript

# 代码风格
- 永远不要使用兼容代码，必要时请与用户沟通

# 执行规范
- 每当对Harness做了更新，应该检查是否需要同步更新到已部署的 Agents（可以用./update-runtime），然后获得用户批准

# 回复风格
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
