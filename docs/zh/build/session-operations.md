---
lang: zh-CN
description: 读取 Session 状态和 transcript，获取 run output，列出、归档或删除 Session。
source: /en/build/session-operations
source_hash: 911dbd9a427f807fd9923b0430f5536da162becdbfb0c640be6ea14874a68c23
---

# Session 操作

Session 创建后，可以用这些操作检查工作或管理生命周期。创建和首次输入见 [创建 Session](./sessions.md)，持久事件日志见 [事件与流式响应](./events.md)。

所有操作都属于一个 Agent。使用[认证](../get-started/authentication.md)中配置的后端 `client`，以及[创建 Session](./sessions.md)时保存的 Agent 和 Session ID。Python 的 `await` 示例在 async 函数内运行。

## 读取 Session {#read-a-session}

::: code-group

```ts [TypeScript]
const s = await client.getSession(agentId, sessionId)
```

```python [Python]
s = await client.get_session(agent_id, session_id)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

示例响应：

```json
{
  "session_id": "0123456789abcdef0123456789abcdef",
  "session_key": "api:0123456789abcdef0123456789abcdef",
  "channel": "api",
  "run_status": "succeeded",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "metadata": { "source": "docs-example" },
  "archived": false,
  "status": null,
  "pending_approvals": 0
}
```

| 字段 | 含义 |
|---|---|
| `session_id` | 你传给其他每一个 session 调用的 id。 |
| `session_key` | 带渠道限定的 key。你通过 API 创建的 session 是 `api:<session_id>`。 |
| `channel` | 通过这个 API 创建的 session 是 `api`。 |
| `run_status` | 最近一次 run 的状态 —— 你要的是这个字段。 |
| `updated_at` | 最后一次变更的 ISO 时间戳。 |
| `metadata` | 你传给 `createSession` 的东西，原样返回。 |
| `archived` | 布尔值。 |
| `pending_approvals` | 正在等待审批的工具调用数量。记录本身通过 `listApprovals()` 读取。 |
| `status` | 旧的 Session 字段；当前 `getSession()` 路径返回 `null`。见下面。 |

::: info 从 `run_status` 读取运行状态
`status` 是旧的 Session 字段，值可能是 `null`。需要读取或轮询最近一次 run 的状态时，请使用 `run_status`。
:::

把最近 run 的状态和 pending 计数一起读取：

| 读到的值 | 下一步 |
|---|---|
| `run_status: null` | 还没有最近 run 可以检查。 |
| `run_status: "running"` | 继续读取事件。 |
| `run_status: "awaiting_approval"`，且 `pending_approvals > 0` | 读取并处理待办[审批](./permissions.md)。 |
| `run_status: "awaiting_approval"`，且 `pending_custom_tool_calls > 0` | 执行并返回待办 [custom tool 结果](./tools.md#应用执行的自定义工具)。 |
| `succeeded`、`failed` 或 `aborted` | 最近 run 已结束。检查事件和 output；yielded run 仍可能有后续任务工作。 |

审批和应用执行的 custom tool 共用同一个等待状态。不要认为每个 `awaiting_approval` 都需要权限决策。resolve 返回 202 只确认请求被接受，不证明 run 已恢复或工具已执行。

响应里可能带有上表之外的字段。遇到不认识的就忽略，不要因此报错。

## 对话记录：`getSession({ history: true })` {#the-transcript-getsession-history-true}

传 `history: true` 会附上落盘的对话记录，它读自这个 session 存储的会话行：

::: code-group

```ts [TypeScript]
import { messageText } from '@zoowork-ai/sdk'

const s = await client.getSession(agentId, sessionId, { history: true, limit: 20 })
for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  const msg = row.entry.message as { role?: string }
  console.log(row.seq, msg.role, messageText(row.entry.message))
}
```

```python [Python]
from zoowork import message_text

s = await client.get_session(agent_id, session_id, history=True, limit=20)
for row in s.get("history", []):
    if row["entry_type"] != "message":
        continue
    message = row["entry"]["message"]
    print(row["seq"], message.get("role"), message_text(message))
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID?history=true&limit=20" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

每一条是 `{ seq, entry_type, entry, created_at }`。当 `entry_type: 'message'` 时，对话内容在 `entry.message`，形式是 `{ role, content }`，其中 `content` 是一个 block 数组，只有 `{ type: 'text', text }` 这种 block 带文本。`messageText()` 数组形式和纯字符串形式都能处理。

`limit` 是返回最近多少行，默认 100，最大 500。返回的行按 `seq` 升序排列。

一条 assistant 示例记录：

```json
{
  "seq": 2,
  "entry_type": "message",
  "entry": {
    "type": "message",
    "message": {
      "role": "assistant",
      "model": "litellm/gpt-5.6-terra",
      "responseModel": "qwen35-122B",
      "usage": {
        "input": 15212,
        "output": 40,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 15252,
        "cost": { "input": 0, "output": 0, "total": 0 }
      },
      "content": [
        { "type": "text", "text": "" },
        { "type": "thinking", "thinking": "..." },
        { "type": "text", "text": "Your display name is Ada." }
      ],
      "stopReason": "stop"
    }
  },
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

Transcript 还包含：

- **Token 用量。** `entry.message.usage` 带有这条模型消息的 token 计数。上面的示例中，cost 字段为 `0`。这些值不是计费 contract；消耗查询见 [Usage API](../reference/usage.md)。
- **真正回答的那个模型。** `model` 是 agent 被配置成的模型；`responseModel` 是实际服务这次请求的模型。部署方可以把你配的别名映射到一个替代模型，上面的样例里两者就不一致。当这个答复要进计费、评测或合规记录时，以 `responseModel` 为准。

这是对话记录，不是事件日志。它装的是对话消息，不是 `run.started` / `agent.tool` / `run.finished`。用它来找回那些你漏掉了事件的答复；想要事件流就用 `listEvents`。还存在其他 `entry_type` 取值（session 锚点、压缩标记、模型变更）；筛出 `message`，其余跳过。

### 用量不等于 Session budget {#usage-is-not-a-session-budget}

Transcript token 计数和 [Usage API](../reference/usage.md) 用于观察消耗，并不为单个 session 设置花费上限。公共 Session API 不接受 `budget` 或 `max_list_cost`，也没有达到金额上限暂停、提高上限后恢复的 contract。

客户端 timeout 只让应用停止读取。scheduled turn 的执行 timeout 也不是花费上限。应用需要停止当前工作时，使用 [interrupt](./events.md#user-interrupt)，并考虑已经在执行的工作。

## 读取单个 run 的 output {#read-output-for-one-run}

[Webhook](./webhooks.md) 或已保存事件带有 run ID 时，可以只读取该 run 的 output，无需读取整段对话。使用 `getRunOutput()` / `get_run_output()` 或这个 HTTP endpoint：

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/runs/$RUN_ID/output?limit=50" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

| 响应字段 | 含义 |
|---|---|
| `run` | `run_id`、`session_id`、`status`、`terminal_outcome`、`started_at`、`finished_at`。 |
| `items` | Output entry，带有 `seq`、`kind`、`source`、可选 `text` 和 `artifacts`。`kind` 为 `assistant`、`outbound` 或 `attachment`。 |
| `has_more` / `next_cursor` | 还有下一页时，继续传 `?cursor=...`。`limit` 默认 50，上限 200。 |
| `output_complete` | 只有 run 已进入 terminal 状态、且当前页读到 output 末尾时才为 true。 |

失败的 run 也可能有 partial output。没有注册为可下载 artifact 的引用，其 `artifact_id` 可为 null。已注册的 ID 使用 [Artifacts 方法](../reference/typescript-sdk.md)读取，不要假设每个 output 文件都有下载 URL。

`output_complete` 只描述这个 run 的 output，不证明业务任务通过评价，也不证明所有异步工作已结束。跨 run 的工作需要继续读取 [yielded turn 的任务关联](./events.md#when-a-turn-yields)。

## 保存 Session metadata {#store-session-metadata}

Session 的 `metadata` 在调用 `createSession()` 时写入。SDK 没有 `patchSession`，
对一个 Session 发送 `PATCH` 会返回 `405`。

在应用中，把每个 `session_id` 和它所属的记录一起保存。需要关联的字段在创建时写入 `metadata`，后续不能补写。Session 列表不提供任意 metadata 查询。

### 用户归属 {#user-attribution}

API Session 的初始和后续 `user.message` 都可携带 `actor: { ref }`。ref 必须来自已认证的后端状态。`metadata.user_id` 不选择 actor；归属不代表访问授权，也不隔离文件或清除已有上下文。IM Session 拒绝调用方 actor。字段规则见 [Message 输入](./events.md#user-message)。

## 列出 Session {#list-sessions}

Session 列表的作用域是一个 Agent。需要跨多个 Agent 查找 Session 时，请在应用中保存 Agent id。

按 agent 列出 session 有两条兼容通道。`listSessions(agentId, { page })` 保留旧的数字分页：固定 50 条，按 `updated_at` 最新在前，`page` 从 1 开始。Python 的对应方法是 `list_sessions(agent_id, page=...)`。

需要 filter 或可续传扫描时，用 `listSessionPage()` / `list_session_page()`：

::: code-group

```ts [TypeScript]
let cursor: string | undefined
do {
  const page = await client.listSessionPage(agentId, {
    cursor, limit: 100, runtimeModes: ['active'],
    includeArchived: false, includeDeleted: true,
  })
  for (const session of page.sessions) console.log(session.session_id)
  cursor = page.next_cursor ?? undefined
} while (cursor)
```

```python [Python]
cursor = "sls1:0"
while cursor is not None:
    page = await client.list_session_page(
        agent_id, cursor=cursor, limit=100, runtime_modes=["active"],
        include_archived=False, include_deleted=True,
    )
    for session in page.sessions:
        print(session["session_id"])
    cursor = page.next_cursor
```

```bash [curl]
curl -G "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'cursor=sls1:0' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'runtime_modes=active' \
  --data-urlencode 'include_archived=false' \
  --data-urlencode 'include_deleted=true'
```

:::

curl 请求读取一页；继续请求时传入它返回的 `next_cursor`。

初始 cursor 是 `sls1:0`。cursor 不透明，续传时必须保持所有 filter 不变；它绑定 Agent 和 filter scope，错误复用返回 `400 invalid_cursor`。`limit` 是 1–100。`runtime_modes` 接受 `active`、`preview`、`authoring` 和 `evaluation`。每行都有 `list_cursor`，所以只处理半页时可以从最后处理的 row 之后继续。到达末尾时 `next_cursor` 是 null。

默认不会返回已删除的 Session。reconciliation job 需要 deletion tombstone 时，TypeScript 传 `includeDeleted: true`，Python 传 `include_deleted=True`。这类 row 带有 `deleted: true`，page 用 `includes_deleted: true` 确认当前模式。这个选项属于 cursor scope；使用同一个 cursor 续传时不能修改它。tombstone 只用于识别已删除的 Session id，不能当作可读取的 Session resource。

## 归档 Session {#archive-a-session}

需要停止新输入、同时保留可读历史时，使用 archive：

::: code-group

```ts [TypeScript]
await client.archiveSession(agentId, sessionId)
```

```python [Python]
await client.archive_session(agent_id, session_id)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/archive" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

仍有 run 在执行时，返回 `409 session_running`。发送 `user.interrupt`，观察到该 run 的 terminal `run.finished` 后再 archive。归档后仍可读取历史，新事件返回 `409 session_archived`。重复 archive 保留第一次归档时间。

## 删除 Session {#delete-a-session}

::: code-group

```ts [TypeScript]
await client.deleteSession(agentId, sessionId)
```

```python [Python]
await client.delete_session(agent_id, session_id)
```

```bash [curl]
curl -X DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

删除会先向进行中的 run 发送取消请求，再隐藏 session。取消请求失败时，删除也失败。删除成功后，公共 session 读取返回 404。Transcript 和事件保留用于审计；这是 soft delete，不是物理擦除全部记录或 workspace 文件的保证。

这些生命周期操作不改变前面的应用边界：应用仍需保存 Agent/session 映射，公共 session metadata 仍然只能在创建时写入。

Session 分开保存对话历史。应用用户需要文件和记忆隔离时，见[每用户一个 agent](./per-user-agents.md)。

## SDK 调用

以下示例要求安装包含该方法的 SDK release。先检查已安装的 exports；缺少方法时使用本页 HTTP 示例。

::: code-group

```ts [TypeScript]
const output = await zc.getRunOutput(agentId, sessionId, runId, { limit: 50 })
const approvals = await zc.listApprovalPage(agentId, { sessionId, limit: 50 })
const calls = await zc.listCustomToolCallPage(agentId, { sessionId, limit: 50 })
```

```python [Python]
output = await client.get_run_output(agent_id, session_id, run_id, limit=50)
approvals = await client.list_approval_page(agent_id, session_id=session_id, limit=50)
calls = await client.list_custom_tool_call_page(agent_id, session_id=session_id, limit=50)
```

:::

分页方法保留 `has_more` 与 `next_cursor`。现有 list 方法仍返回数组。`getApproval` / `get_approval` 和 `getCustomToolCall` / `get_custom_tool_call` 可以读取已结束的 action。只有 `output_complete` 为 true 才表示 output 完整；artifact 引用的 ID 可以为 null。
