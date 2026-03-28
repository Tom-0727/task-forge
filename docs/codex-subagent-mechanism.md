结论：如果你说的是 @openai/codex-sdk，我查到的官方资料里，没有像 Claude Agent SDK 那样单独暴露一个 subagent() 或 agents={...} 的一等编程接口。Codex SDK本质上是包了一层 codex CLI；SDK 支持把 config 对象转成 CLI 的 --config 覆盖项，所以 subagent 更像是 Codex 运行时能力，不是独立的 SDK API。 

机制上，Codex 的 subagent 是：主 agent 按你的要求去 spawn 专门 agent 并行工作，然后等待并汇总结果。官方文档明确写了：Codex 只会在你明确要求时才生成 subagent，不会像有些框架那样默认主动多 agent 化；它会负责 spawn、路由后续指令、等待结果、关闭线程。官方给的典型 prompt 也是 “one agent per point, wait for all, then summarize”。 

配置上，Codex 内建了 default、worker、explorer 三类 agent；你也可以自己定义 custom agent。官方推荐把 custom agent 写成独立 TOML，放在 ~/.codex/agents/ 或项目里的 .codex/agents/。每个 agent 至少要有 name、description、developer_instructions；可选继承/覆盖 model、model_reasoning_effort、sandbox_mode、mcp_servers、skills.config。全局并发和递归深度则放在 [agents]，比如 agents.max_threads 默认是 6，agents.max_depth 默认是 1。 

所以它和 skill 不是一回事。官方把 AGENTS.md、skills、MCP、subagents 明确分成四层：AGENTS.md 管长期项目规则，skills 是可复用工作流，subagents 是任务委派。skills 放在 .agents/skills/.../SKILL.md，可以显式调用，也可以靠 description 隐式匹配；而 subagent 是靠 .codex/agents/*.toml 和 [agents] 来定义与调度。两者可以配合，因为 custom agent 文件里可以带 skills.config，但 subagent 不是定义在 skill 里面。 

再往底层一点，官方配置参考里已经把 multi-agent 的工具面暴露出来了：features.multi_agent 对应的协作工具包括 spawn_agent、send_input、resume_agent、wait_agent、close_agent，而且现在是 stable 且默认开启。这也说明 Codex 的 subagent 更像“Codex 内部可调用的多 agent 工具链”。 

如果你要的是“代码里显式编排一个 orchestrator + 多个 worker”，官方更直接推荐的路线其实是：把 Codex 跑成 codex mcp-server，然后让 OpenAI Agents SDK 去做上层多 agent orchestration、handoff 和 trace；Codex 在这里更像一个强执行器。 

最实用的理解就是：Codex SDK = 控制一个 Codex 运行时；subagent = 这个运行时内部的并行委派能力；skills = 可复用流程包，不是 subagent 定义入口。

我下一条可以直接给你一份“Codex SDK + .codex/agents/*.toml + prompt 触发 subagent”的最小可运行模板。