# 项目目标
- 打造具有持续学习能力，LifeLong Running 的 Agent 机制的 Harness

# References
- Claude Python SDK Doc：https://platform.claude.com/docs/en/agent-sdk/python
- Codex SDK Doc: https://github.com/openai/codex/tree/main/sdk/typescript

# 代码风格
- 永远不要使用兼容代码，必要时请与用户沟通

# Mailbox 机制
- 每个 agent 的 mailbox/ 目录下，每个联系人对应一个独立的 .jsonl 文件（human.jsonl, agent.<name>.jsonl）
- contacts.json 维护联系人列表，human 默认存在，agent 间建联由 human 通过 platform 前端操作
- 消息 schema 使用 from/to 字段标识收发方
- 发信支持 --to（指定联系人）和 --broadcast（广播所有 agent 联系人），agent 间通信为双写模型
- Runtime/pending_messages/ 目录存放通知文件，任意文件存在即唤醒 agent
- Runtime/awaiting_reply/ 目录标记等待回复状态，仅在无 pending messages 时跳过 heartbeat

# 执行规范
- Harness 更新直接生效：engine/ 被所有已部署 workdir 共享，重启 agent 即拉到最新代码（engine/bin/engine-ensure.sh 自动 rebuild）。新增/改动 shared skill 后，需要对每个 workdir 跑 `engine/bin/refresh-skills.sh --agent-dir <workdir>` 更新符号链接。
- 老版本 workdir 迁移：`engine/bin/migrate-workdir.sh --agent-dir <workdir>` 默认 dry-run，加 `--apply` 才写盘。

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
