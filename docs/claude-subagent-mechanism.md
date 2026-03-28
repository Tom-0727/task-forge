结论：不是主要写在 skill 里。对 Claude Agent SDK 来说，想让主 Agent 主动把独立任务交给 subagent，核心做法是：给主 Agent 开 Agent 工具，然后定义 subagent（官方推荐在 SDK 里直接用 agents 参数程序化定义），再把触发条件写进 subagent 的 description。Claude 会根据这个 description 自动决定是否委派。官方现在也把 “Claude SDK” 叫做 Claude Agent SDK 了。 

最直接的做法是这样：主 query() 里加 allowed_tools=["Agent", ...]，再传 agents={...}，每个 AgentDefinition 至少有 description 和 prompt，可选 tools、model。description 决定“什么时候该用它”，prompt 决定“它怎么做事”。如果你想让它更积极地自动委派，官方在 Claude Code 的 subagent 文档里明确建议在 description 里写类似 “use proactively” 这类提示。 

一个最小 Python 形态大概是：
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async for msg in query(
    prompt="Review the auth module and fix obvious security issues",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash", "Agent"],
        agents={
            "security-reviewer": AgentDefinition(
                description="Security reviewer. Use proactively for auth, permission, secret, vulnerability, and risky code changes.",
                prompt="You are a security review specialist. Find vulnerabilities, explain impact, and suggest or apply safe fixes.",
                tools=["Read", "Grep", "Glob", "Bash"],
                model="sonnet",
            )
        },
    ),
):
    print(msg)
这里真正让它“自己调用 subagent”的关键只有两个：一是主 Agent 必须有 Agent 工具；二是 subagent 的 description 要写得足够清楚。官方还说明了：如果它不主动委派，优先检查这两点。 

如果你不用程序化定义，也可以把 subagent 写成文件，放在 .claude/agents/ 里；Claude Code 文档说 subagent 本体就是 Markdown + YAML frontmatter，推荐用 /agents 管理。SDK 文档也承认这种文件式定义，但对 SDK 应用来说，官方推荐的仍然是程序化 agents 参数。 

skill 是另一套机制。官方对 SDK 明确写了：Skills 必须是 filesystem artifact，放在 .claude/skills/<name>/SKILL.md，SDK 没有程序化注册 skill 的 API。skill 更像“按需加载的能力/流程模板”，不是定义 subagent 的主入口。 

但 skill 和 subagent 可以配合，两种方式最常见：第一，skill 里用 context: fork，让这个 skill 在一个隔离的 subagent 上执行；第二，subagent 定义里加 skills 字段，把某些 skills 预加载进 subagent 的上下文。也就是说，skill 可以“借 subagent 跑”，subagent 也可以“带着 skill 知识跑”，但二者不是一回事。 

所以你可以直接这么理解：
你要的是“主 Agent 自己判断，并把独立任务甩给一个专门 Agent 去做”，优先用 subagent。在 SDK 里最正统的方式是 allowed_tools 里开 Agent + agents={...}。
只有当你想把某个固定流程封成可复用模板时，才更像是用 skill；如果这个流程还想隔离上下文，再给 skill 加 context: fork。 

再补一个容易踩坑的点：subagent 自己不能再继续生成 subagent；官方文档明确说不要在 subagent 的 tools 里放 Agent。 

如果你愿意，我下一条可以直接给你一份“适合你现在这种 orchestrator / researcher 架构”的 Claude Agent SDK subagent 模板。