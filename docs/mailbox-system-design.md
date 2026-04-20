# Mailbox System Design

Inter-agent and human-agent unified messaging system.

## Core Principles

- Each agent的每个联系人对应一个独立的 .jsonl 文件
- 所有消息操作通过 skills/mailbox-operate 的脚本完成
- Append-only + file lock，保证并发安全
- 双写模型：发送方和接收方各保存一份

## Directory Structure

```
agent_workdir/
├── mailbox/
│   ├── contacts.json              # 联系人列表（握手后自动维护）
│   ├── human.jsonl                # 与 human 的消息记录
│   ├── agent.<agent_name>.jsonl   # 与某个 agent 的消息记录
│   └── ...
├── Runtime/
│   ├── pending_messages/          # 替代原 pending_human.json
│   │   ├── human.json             # human 有新消息
│   │   └── agent.<name>.json      # 某 agent 有新消息
│   ├── awaiting_reply/            # 替代原 awaiting_human
│   │   ├── human                  # 等待 human 回复
│   │   └── agent.<name>           # 等待某 agent 回复
│   └── mailbox_read_last_id/      # 替代原 mailbox_read_human_last_id
│       ├── human                  # human 消息的读取 checkpoint
│       └── agent.<name>           # 某 agent 消息的读取 checkpoint
```

## contacts.json

```json
{
  "human": {
    "type": "human",
    "mailbox_file": "human.jsonl",
    "connected_at": "2026-04-06T10:00:00Z"
  },
  "jarvis": {
    "type": "agent",
    "mailbox_file": "agent.jarvis.jsonl",
    "remote_workdir": "/home/ubuntu/agents/jarvis",
    "connected_at": "2026-04-06T12:00:00Z"
  }
}
```

- human 默认存在，无需握手（bootstrap 阶段自动创建 human 条目和 human.jsonl）
- agent 联系人通过 human 在前端操作建联

## Message Schema

```json
{
  "id": "mail.20260406T120000Z.001",
  "ts": "2026-04-06T12:00:00Z",
  "from": "jarvis",
  "to": "clyd",
  "task_id": "task.agent.message",
  "message": "...",
  "await_reply": false
}
```

与现有 schema 的变化：
- 移除 `role` 字段，替换为 `from` / `to`
- `from` / `to` 的值为联系人名称（human 或 agent name）

## Handshake（握手）

Agent 间通信前需要建联。建联由 human 通过 platform 前端手动操作，agent 不能自主发起。

### 流程

1. Human 在 platform 前端选择两个 agent，点击"Connect"
2. 前端调用 `POST /api/mailbox/connect`，body: `{agent_a: "name_a", agent_b: "name_b"}`
3. Platform 验证双方均已注册，获取双方 workdir
4. Platform 在双方的 contacts.json 中添加对方信息
5. Platform 在双方的 mailbox/ 目录下创建对应的空 .jsonl 文件
6. 返回成功

### 断开连接

同样由 human 在前端操作：
1. 在某个 agent 的详情页，查看其联系人列表，点击"Disconnect"
2. 前端调用 `POST /api/mailbox/disconnect`，body: `{agent_a: "name_a", agent_b: "name_b"}`
3. Platform 从双方的 contacts.json 中移除对方（不删除历史消息文件）

### 设计决策

- 建联是 human 的管理行为，不是 agent 自主行为
- 同一平台下的 agent 默认互信，human 决定谁能和谁通信
- 重复建联为幂等操作
- 断开连接不删除历史消息，只移除联系人关系

### 前端交互

#### Dashboard 层级 -- Agent Connections 面板

在 dashboard 或单独的管理页面中，提供一个 connections 管理区域：

- 两个下拉框选择 agent_a 和 agent_b，点击"Connect"建联
- 下方展示当前所有已建联的 agent 对，每行显示 `A <-> B`，右侧有"Disconnect"按钮

#### Agent 详情页 -- Contacts 区域

在现有 agent 详情页中，新增一个 Contacts 区块：

- 列出该 agent 的所有联系人（human + 已建联的 agents）
- 每个 agent 联系人右侧显示未读消息数
- 点击联系人名可展开查看该联系人的消息历史

## Send（发信）

### 接口

```bash
# 发给 human（默认）
mailbox-send --message "hello"

# 发给另一个 agent
mailbox-send --to jarvis --message "need your help"

# 发送并等待回复
mailbox-send --to jarvis --await-reply --message "what's the status?"

# 广播给所有已建联的 agent（不包括 human）
mailbox-send --broadcast --message "I'm done with phase 1"
```

### 双写流程

当 Agent A 发消息给 Agent B：

1. 写入 B 的 `mailbox/agent.<A>.jsonl`（远端优先）
2. 写入自己的 `mailbox/agent.<B>.jsonl`（本地记录）
3. 在 B 的 `Runtime/pending_messages/agent.<A>.json` 创建通知文件
4. 如果 `--await-reply`，创建自己的 `Runtime/awaiting_reply/agent.<B>`

两侧写入均使用 fcntl.LOCK_EX 文件锁。

### 双写失败处理

可能的失败场景：
- 远端 workdir 不可访问（被删除、权限问题）
- 写远端成功但写本地时进程被 kill
- 文件锁竞争超时

策略：任一步骤失败，最多重试一次，仍然失败则报错返回。不做后台 reconcile。

### 广播模式

`--broadcast` 遍历 contacts.json 中所有 type=agent 的联系人，逐个执行双写流程。不包括 human（human 可以自己查看文件）。

广播不支持 `--await-reply`（无法同时等待多个回复）。

### 发给 human

与现有逻辑一致，只是文件从 `MAILBOX.jsonl` 改为 `human.jsonl`。

## Read（读信）

### 接口

```bash
# 读取 human 未读消息（默认）
mailbox-read

# 读取某 agent 的未读消息
mailbox-read --from jarvis

# 读取某 agent 最近 N 条消息
mailbox-read --from jarvis 5

# 列出所有有未读消息的联系人
mailbox-read --summary
```

### 读取逻辑

1. 根据 `--from` 确定对应的 .jsonl 文件
2. 读取 `Runtime/mailbox_read_last_id/<contact>` 获取 checkpoint
3. 返回 checkpoint 之后的所有消息
4. 更新 checkpoint

### --summary 模式

遍历 contacts.json 中的所有联系人，对每个联系人对比 .jsonl 文件和 `mailbox_read_last_id/<contact>` checkpoint，计算未读消息数：

```json
[
  {"contact": "human", "unread": 2},
  {"contact": "jarvis", "unread": 1}
]
```

未读数为 0 的联系人不输出。

## Pending Messages（通知机制）

替代原有的 `pending_human.json`，泛化为 `pending_messages/` 目录。

### 文件格式

`Runtime/pending_messages/<contact>.json`：

```json
{
  "mailbox_id": "mail.20260406T120000Z.001",
  "ts": "2026-04-06T12:00:00Z",
  "source": "agent"
}
```

### Runtime 唤醒逻辑变更

现有 `sleep_with_wakeup()` 中检查 `pending_human.json` 的逻辑改为：
- 扫描 `Runtime/pending_messages/` 目录
- 任意文件存在即唤醒（不区分来源）
- `build_prompt()` 中同时传入：
  - pending_messages summary（谁发了几条新消息）
  - 当前 awaiting_reply 状态（在等谁）
- agent 自行决定处理优先级

### pending_messages 清除时机

与现有 `clear_pending_human_if_unchanged` 逻辑一致：每次 heartbeat 结束后，对比 pending 文件中的 mailbox_id，如果未变化则清除。如果 heartbeat 期间又有新消息到达（mailbox_id 变了），保留 pending 文件，下次继续唤醒。

### awaiting_reply 泛化

原有 `awaiting_human` 改为 `awaiting_reply/` 目录：
- `awaiting_reply/human` — 等待 human
- `awaiting_reply/agent.<name>` — 等待某 agent

heartbeat 跳过条件：存在 awaiting_reply 文件 **且** `pending_messages/` 目录为空。

关键规则：**任何联系人的新消息都会唤醒 agent，无论 agent 当前在等谁。** human 在等 agent B 回复时发了消息，agent 必须响应 human。唤醒后 agent 根据 prompt 中的 awaiting 状态和 pending 信息自行判断：
- 如果是等待的对象回复了 → 处理回复，清除 awaiting 状态
- 如果是其他联系人发了消息 → 先响应，awaiting 状态保持
- 如果 human 说"别等了" → agent 清除 awaiting 状态

## Contact List（联系人列表）

### 接口

```bash
# 列出所有联系人
mailbox-contacts
```

建联/断联由 human 通过 platform 前端操作，不提供 agent 侧脚本。

### mailbox-contacts 输出

```json
[
  {"name": "human", "type": "human", "connected_at": "2026-04-06T10:00:00Z"},
  {"name": "jarvis", "type": "agent", "connected_at": "2026-04-06T12:00:00Z"}
]
```

## Platform API 扩展

```
POST /api/mailbox/connect                — 建联（前端调用）
POST /api/mailbox/disconnect             — 断联（前端调用）
GET  /api/agents/<name>/contacts         — 获取某 agent 的联系人列表
GET  /api/agents/<name>/mailbox/<contact> — 获取与某联系人的消息历史（前端展示用）
```

connect/disconnect 端点负责在双方 workdir 中完成文件创建/清理和 contacts.json 更新。

## Skills 脚本清单

`engine/skills/mailbox-operate/scripts/` 下：

| 脚本 | 用途 |
|------|------|
| send_mailbox.py | 发信（支持 --to, --broadcast） |
| read_mailbox.py | 读信（支持 --from, --summary） |
| contacts.py | 联系人列表查询 |

connect/disconnect 不在 skills 中，由 human 通过 platform 前端操作。

## Migration（从现有系统迁移）

1. `MAILBOX.jsonl` → `human.jsonl`（重命名 + 一次性数据迁移：将 `role` 字段转为 `from`/`to` 字段。不做运行时兼容，迁移脚本跑完即切换。）
2. `pending_human.json` → `pending_messages/human.json`
3. `awaiting_human` → `awaiting_reply/human`
4. `mailbox_read_human_last_id` → `mailbox_read_last_id/human`
5. deploy-agent 中创建新目录结构
6. 所有引用上述路径的代码同步更新（run_claude.py, run_codex.mjs, platform_server.py, feishu_bridge 等）

## Resolved Decisions

- 双写失败：简单重试一次，不做后台 reconcile
- 已读回执：不需要
- 限流：不需要，发信频率天然很低
- 广播：支持 `--broadcast`，仅对所有已建联 agent 广播，不对 human 广播
