# Agent 监控平台设计

## 0. 目标

构建一个集中式的 Agent 监控与管理平台，替代当前分散的 CLI 启动方式和各自独立的 web-ui 端口。

核心能力：

- 一览所有运行中/已停止的 Agent，每个 Agent 是一张卡片
- LLM 配额看板（通过 `claude` / `codex` CLI 的 `/status` 每小时抓取一次）
- 从 UI 启动新 Agent（替代命令行 `deploy-agent`）
- 点击 Agent 卡片进入其 Mailbox，直接交互

## 1. 背景与问题

当前状态：

- 用户通过 `deploy-agent` 在命令行创建 Agent，每个 Agent 的 web-ui 各占一个端口
- 多个 Agent 同时运行时，用户需要记住每个端口号
- 缺乏全局视角：不知道哪些 Agent 在运行、哪些已停止、资源消耗多少
- 没有统一的用量统计

## 2. 架构

### 2.1 整体结构

```
Platform Server (单进程，单端口)
├── Frontend (SPA)
│   ├── Dashboard 页 —— Agent 卡片列表 + LLM 配额看板
│   └── Agent 详情页 —— Mailbox 交互界面（复用现有 web_ui_server 的前端逻辑）
├── Backend API
│   ├── /api/agents —— Agent 列表（含实时状态）
│   ├── /api/agents/:name/status —— 单个 Agent 状态
│   ├── /api/agents/:name/history —— 单个 Agent 邮箱历史
│   ├── /api/agents/:name/send —— 向 Agent 发送消息
│   ├── /api/agents/:name/stop —— 停止 Agent
│   ├── /api/agents/create —— 启动新 Agent
│   ├── /api/agents/import —— 导入已有 Agent
│   └── /api/usage —— Claude + Codex 配额快照（后台每小时刷新）
└── Agent Registry (JSON 文件)
    └── 记录所有已注册 Agent 的 workdir、provider、创建时间等
```

### 2.2 与现有架构的关系

平台不替换现有的 Agent 运行机制，而是在其之上增加一层管理：

- 每个 Agent 仍然是独立的 workdir，拥有自己的 `Runtime/`、`mailbox/`、`Memory/`
- 平台通过读取 Agent workdir 下的文件获取状态（和现有 `web_ui_server.py` 逻辑一致）
- 启动 Agent 时，平台调用 `deploy-agent` 脚本
- 平台不启动 Agent 自身的 web-ui，而是由平台统一代理 Mailbox 交互

### 2.3 技术选型

- 后端：Python + Flask（项目已有 Python 生态，且 `uv` 管理依赖）
- 前端：单 HTML 文件 SPA（与现有 `web_ui_server.py` 风格一致，无需构建工具）
- 数据存储：文件系统（JSON 文件作为 Registry，Agent 自身的文件作为数据源）
- 运行方式：`uv run python platform_server.py --port 9000`

## 3. Agent Registry（注册中心）

### 3.1 目的

集中记录所有通过平台管理的 Agent 元信息，支持发现与状态聚合。

### 3.2 存储

```
~/.agent-platform/
  registry.json       # Agent 注册表
```

### 3.3 registry.json 格式

```json
{
  "agents": {
    "security-auditor": {
      "name": "security-auditor",
      "workdir": "/Users/tom/agents/security-auditor",
      "provider": "claude",
      "interaction": "platform",
      "created_at": "2026-03-30T10:00:00Z",
      "goal": "Audit security of auth module",
      "interval": 20,
      "tags": ["security", "auth"]
    }
  }
}
```

### 3.4 Agent 发现机制

两种来源：

1. **通过平台创建**：创建时自动注册
2. **手动导入**：用户提供已有 Agent 的 workdir 路径，平台读取其 `Runtime/` 文件自动填充元信息

### 3.5 状态聚合

Agent 的实时状态不存储在 Registry 中，而是每次请求时从 Agent workdir 实时读取：

- `Runtime/pid` → runner 进程是否存活
- `Runtime/state` → running / stopped
- `Runtime/last_heartbeat` → 最后心跳时间
- `Runtime/awaiting_human` → 是否等待人类回复
- `mailbox/MAILBOX.jsonl` → 最新消息摘要

## 4. Dashboard 页（Agent 列表 + LLM 配额看板）

### 4.1 布局

```
┌──────────────────────────────────────────────────────┐
│  Agent Platform                        [+ New Agent] │
├──────────────────────────────────────────────────────┤
│  LLM Quota            Updated 14:00 · refreshes hourly │
│  ┌─────────────────────┐  ┌─────────────────────┐    │
│  │ Claude              │  │ Codex      gpt-5.4  │    │
│  │ Session  ▓▓▓▓░ 83%  │  │ 5h      ▓▓▓▓▓ 98%  │    │
│  │ Week     ▓▓▓░░ 78%  │  │ Weekly  ▓▓▓▓▓ 98%  │    │
│  └─────────────────────┘  └─────────────────────┘    │
│  Active: 3 / 5 agents                                │
├──────────────────────────────────────────────────────┤
│  Agents                              [Filter] [Sort] │
│  ┌────────────────┐ ┌────────────────┐               │
│  │ ● security-    │ │ ○ data-        │               │
│  │   auditor      │ │   pipeline     │               │
│  │ claude · 20min │ │ codex · 20min  │               │
│  │ Last: 14:20    │ │ Stopped        │               │
│  │ "Found 3 vuln."│ │ "Done."        │               │
│  └────────────────┘ └────────────────┘               │
└──────────────────────────────────────────────────────┘
```

### 4.2 Agent 卡片内容

每张卡片展示：

| 字段 | 来源 |
|------|------|
| Agent 名称 | registry |
| Provider（claude / codex） | registry |
| 状态指示灯（● 运行 / ○ 停止 / ◐ 暂停 / ⊙ 等待人类） | Runtime/ 实时读取 |
| 心跳间隔 | registry |
| 最后心跳时间 | `Runtime/last_heartbeat` |
| 最新消息摘要（截取最后一条 mailbox 消息的前 80 字符） | `mailbox/MAILBOX.jsonl` |
| 标签 | registry |

### 4.3 卡片操作

- **点击卡片** → 进入 Agent 详情页（Mailbox）
- **卡片右上角菜单** → 暂停 / 恢复 / 停止 / 删除（从 Registry 移除，不删文件）

### 4.4 LLM 配额看板

目标：展示 Claude 与 Codex 的**剩余可用额度**，对齐 `claude /status` 与 `codex /status` 的体验。

#### 4.4.1 数据来源

Claude / Codex SDK 均未暴露稳定的 rate-limit / quota 事件。平台改用各自 CLI 的 `/status` 命令作为唯一可靠数据源：

- `tmp/capture_claude_usage_tmux.sh` 启动一个临时 tmux session 运行 `claude`，发送 `/status` 并抓取 Usage 面板文本。
- `tmp/capture_codex_status_tmux.sh` 同理，启动 `codex` 并抓取 `/status` 面板。

两段脚本产出的都是带盒线字符的纯文本快照。

#### 4.4.2 采集方式

`platform/usage.py` 以 subprocess 方式调用上述两个脚本，再对输出做正则解析：

- Claude：抓 `Current session` / `Current week` 段落，解析 `N% used` 和 `Resets …`。
- Codex：去掉 `│` 等盒线字符后，抓 `Model:`、`5h limit: … N% left`、`Weekly limit: … N% left`、`(resets …)`；以 `Spark limit:` 行作为分割点，把默认模型和 Spark 额度分开。

解析结果写入内存缓存 + `platform/.usage_cache.json`，后台常驻线程每小时刷新一次。

```json
{
  "updated_at": "2026-04-12T00:07:00Z",
  "claude": {
    "session_percent_used": 20,
    "session_resets": "1am (Asia/Singapore)",
    "week_percent_used": 23,
    "week_resets": "Apr 13, 1pm (Asia/Singapore)"
  },
  "codex": {
    "model": "gpt-5.4",
    "5h_percent_left": 98,
    "5h_resets": "00:13 on 12 Apr",
    "weekly_percent_left": 98,
    "weekly_resets": "09:00 on 17 Apr",
    "spark": {
      "5h_percent_left": 100,
      "5h_resets": "04:59 on 12 Apr",
      "weekly_percent_left": 100,
      "weekly_resets": "23:59 on 18 Apr"
    }
  }
}
```

前端把 Claude 的 `% used` 换算成“剩余百分比”以统一配色，进度条 <25% 转 warn、<10% 转 danger。

## 5. Agent 详情页（Mailbox）

### 5.1 目的

复用现有 `web_ui_server.py` 的前端交互模式，但嵌入平台而非独立端口。

### 5.2 布局

```
┌──────────────────────────────────────────────────────┐
│  ← Back    security-auditor    ● Running   [Pause]   │
├──────────────────────────────────────────────────────┤
│  Status                                              │
│  Provider: claude  │  Interval: 20min                │
│  Last heartbeat: 2026-03-30 14:20                    │
│  Runner: PID 12345 · running                         │
│  Awaiting Human: OFF  │  Manual Pause: OFF           │
├──────────────────────────────────────────────────────┤
│  Mailbox History                                     │
│  ┌──────────────────────────────────────────────┐    │
│  │  [human] 10:00  Set goal: audit auth module  │    │
│  │  [agent] 10:01  Starting security audit...   │    │
│  │  [agent] 14:20  Found 3 vulnerabilities...   │    │
│  └──────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐    │
│  │  Type message...                             │    │
│  └──────────────────────────────────────────────┘    │
│  [Send]                                              │
└──────────────────────────────────────────────────────┘
```

### 5.3 功能

与现有 `web_ui_server.py` 一致：

- 展示 Agent 状态（进程、心跳、暂停/等待标志）
- 展示 Mailbox 历史（自动轮询刷新）
- 发送人类消息（写入 `MAILBOX.jsonl` + `pending_human.json`）
- 暂停 / 恢复心跳

## 6. 创建 Agent 页面

### 6.1 表单字段

| 字段 | 必填 | 说明 |
|------|------|------|
| Goal | 是 | Agent 的任务目标 |
| Provider | 是 | claude / codex 下拉选择 |
| Workdir | 是 | Agent 工作目录路径（默认 `~/agents/{name}`） |
| Heartbeat Interval | 否 | 默认 20 分钟 |
| Tags | 否 | 自由标签，用于筛选 |
| Feishu 配置 | 否 | 如需飞书交互：App ID、App Secret、Chat ID |

### 6.2 创建流程

1. 用户填写表单，点击 Create
2. 平台后端调用 `deploy-agent` 脚本，`--interaction platform`（新增模式，不启动独立 web-ui）
3. 等待 `deploy-agent` 完成，检查 `Runtime/pid` 确认启动成功
4. 将 Agent 信息写入 `registry.json`
5. 返回成功，前端跳转到 Agent 详情页

### 6.3 `--interaction platform` 模式

新增一种 interaction 模式：

- 不启动 `web_ui_server.py`（由平台统一代理）
- 如果同时指定了 feishu 参数，仍然启动 `mailbox_feishu_bridge.py`
- 其余行为与 `web-ui` 模式完全一致

## 7. API 设计

### 7.1 Agent 列表

```
GET /api/agents
```

返回所有注册的 Agent 及其实时状态。

```json
{
  "agents": [
    {
      "name": "security-auditor",
      "provider": "claude",
      "goal": "Audit security of auth module",
      "interval": 20,
      "tags": ["security"],
      "created_at": "2026-03-30T10:00:00Z",
      "status": {
        "state": "running",
        "runner_pid": 12345,
        "last_heartbeat": "2026-03-30 14:20",
        "awaiting_human": false,
        "last_message": "Found 3 vulnerabilities in auth middleware..."
      }
    }
  ]
}
```

### 7.2 创建 Agent

```
POST /api/agents/create
Content-Type: application/json

{
  "goal": "Audit security of auth module",
  "provider": "claude",
  "workdir": "/Users/tom/agents/security-auditor",
  "interval": 20,
  "tags": ["security"],
  "feishu": {
    "app_id": "...",
    "app_secret": "...",
    "chat_id": "..."
  }
}
```

### 7.3 导入已有 Agent

```
POST /api/agents/import
Content-Type: application/json

{
  "workdir": "/Users/tom/agents/existing-agent",
  "tags": ["imported"]
}
```

平台读取 `Runtime/` 下的文件自动填充 provider、agent_name 等字段。

### 7.4 Agent 状态

```
GET /api/agents/:name/status
```

返回格式与现有 `web_ui_server.py` 的 `/api/status` 一致。

### 7.5 Mailbox 操作

```
GET  /api/agents/:name/history?limit=50
POST /api/agents/:name/send     {"message": "..."}
POST /api/agents/:name/stop
```

### 7.6 LLM 配额

```
GET /api/usage
```

返回后台缓存的 `claude` + `codex` 快照。格式见 §4.4.2。

## 9. 文件结构

平台代码放在项目根目录的 `platform/` 下：

```
platform/
  platform_server.py    # 后端主入口
  registry.py           # Agent 注册中心操作
  static/
    index.html          # SPA 前端
  requirements.txt      # 依赖（flask 等）
```

## 10. 实施路径

### Phase 1：最小可用

- Agent Registry（JSON 文件读写）
- Dashboard 页（Agent 卡片列表，实时状态）
- Agent 详情页（Mailbox 交互，复用现有逻辑）
- 手动导入已有 Agent

### Phase 2：创建与配额看板

- 从 UI 创建 Agent（调用 deploy-agent）
- `--interaction platform` 模式
- LLM 配额采集（`platform/usage.py` 调用 `tmp/capture_*_tmux.sh`）
- LLM 配额看板

### Phase 3：增强

- Agent 标签与筛选
- 批量操作（暂停/恢复所有）
- Agent 日志查看（读取 Runtime/*.log）
