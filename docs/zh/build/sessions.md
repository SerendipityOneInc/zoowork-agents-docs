---
title: Sessions
description: 创建、继续、列出、归档和删除 session，并读取 transcript。
source: /en/build/sessions
source_hash: 8e5b21e6b042dafacb9f8532931e36068e36e57e53854f72558f73d4a1829583
---

# Sessions

一个 session 就是与一个 agent 的一段对话。你创建它，往里投递 `user.message` 事件，再以事件或对话记录的形式把 agent 的工作读出来。对话由 agent 保存在服务端 —— 你永远不需要重发之前的回合。

每一条 session 路由都嵌套在 agent 之下：

```
POST   /agents/{agent_id}/sessions
GET    /agents/{agent_id}/sessions/{session_id}
POST   /agents/{agent_id}/sessions/{session_id}/events
GET    /agents/{agent_id}/sessions/{session_id}/events
```

SDK 在方法签名里照搬了这层嵌套，所以 `agentId` 是每一个 session 调用的第一个参数：

```ts
createSession(agentId, input, idempotencyKey?)
getSession(agentId, sessionId, opts?)
postEvents(agentId, sessionId, events)
listEvents(agentId, sessionId, opts?)
```

不存在顶层的 `/sessions` 集合：session 只存在于它的 agent 之下，agent id 要一路穿过每一个调用。照「session 是顶层资源、agent 写在 body 里」那种形状写的代码，在这里编译不过。

本页所有示例共用一个客户端：

```ts
import {
  createZooworkClient,
  assistantText,
  isRunFinished,
  runOutcome,
  messageText,
  type SessionEvent,
} from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const agentId = process.env.AGENT_ID!
```

## 前置条件：agent 必须在运行

对一个不在运行的 agent 调 `createSession` 会失败：

```
409  error.type = "agent_not_running"
```

新创建的 agent 返回时是停止状态，所以你得自己调 `startAgent`。用 `status.desired_state === 'running'` 把关；`status.actual_state` 报的是聊天渠道的连通性，而纯 API 的 agent 没有任何渠道，所以它永远停在 `activating`，轮询它永远不会返回。

```ts
const agent = await zc.getAgent(agentId)
if (agent.status?.desired_state !== 'running') {
  await zc.startAgent(agentId)
}
```

## 创建 session

```ts
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Summarize the attached brief.' }],
  metadata: { source: 'my-app', tenant: 'acme' },
})

console.log(session.session_id)   // "0123456789abcdef0123456789abcdef"
console.log(session.session_key)  // "api:0123456789abcdef0123456789abcdef"
```

`session_id` 是 opaque string。不要要求它带资源前缀；`api:` 属于 `session_key`。

带 `initial_events` 创建会立刻启动第一个回合 —— 开场消息没有单独的「发送」步骤。

**`initial_events` 只接受 `user.message`。** 其他事件类型在这里都不合法；session 建好之后，其余的用 `postEvents` 投递。API 最多接受 50 条初始事件。`content` 传纯字符串这一形式已实测。

`metadata` 是一个随 session 一起存下来的任意 JSON 对象，`getSession` 会原样返回。它归你用来做关联 —— 一个租户 id、一个请求 id、这段对话来自哪个入口。平台不会解释它的任何内容。

### Idempotency-Key

`createSession` 接收一个可选的第三个参数，作为 `Idempotency-Key` 请求头发出。用同一个 key 重放会返回已存在的那个 session，而不是再建一个、把开场回合跑两遍。怎么选 key、怎么复用 key，见[错误处理](../reference/errors.md)。

事件写入路径用的是事件级的键而不是 header：给每个事件带一个 `idempotency_key`（任何稳定字符串），超时后重试 `postEvents` 就不会把同一条消息投递两次。

## 多回合

要继续一段对话，往同一个 session 再投一条 `user.message`。不要重发历史 —— agent 在服务端持有它。

```ts
async function runTurn(sessionId: string, cursor?: string) {
  let text = ''
  let outcome: string | undefined
  for await (const ev of zc.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
    cursor = ev.cursor ?? cursor
    text += assistantText(ev)
    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
  return { text, cursor, outcome }
}

// Turn 1 - opens with the session.
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'My display name is Ada.' }],
})
const first = await runTurn(session.session_id)
console.log(first.outcome, first.text)   // "succeeded" ...

// Turn 2 - same session, new message. Resume the stream from the last cursor you saw.
await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'What is my display name?' },
])
const second = await runTurn(session.session_id, first.cursor)
console.log(second.text)                 // mentions "Ada"
```

`postEvents` 返回 `202`，以及一个把每个事件的结果包起来的对象 —— 数组在 `events` 下面，不是响应本身。被接受的事件返回的就是历史里将出现的完整事件对象（带 `seq`）；没有进行中 run 时的 `user.interrupt` 返回 `{ id, type, accepted: false }`。被接受意味着事件已入队，不代表回合已经结束。一个回合在你看到 `run.finished` 时结束，它的 `payload.status` 是 `succeeded`、`failed` 或 `aborted` —— 见[事件与流式](./events.md)。

写入路径接受四种事件类型：`user.message`、`user.interrupt`、`system.message` 和 `user.tool_confirmation`。

## 读取 session

```ts
const s = await zc.getSession(agentId, session.session_id)
```

实测响应：

```json
{
  "session_id": "0123456789abcdef0123456789abcdef",
  "session_key": "api:0123456789abcdef0123456789abcdef",
  "channel": "api",
  "run_status": "succeeded",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "metadata": { "source": "sdk-capability-probe" },
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
| `pending_approvals` | 正在等待审批的工具调用数量。预期为 `0` —— 审批闭环未验证。 |
| `status` | 旧的 Session 字段；当前公开 `getSession()` 路径上实测为 `null`。见下面。 |

::: danger 不要把 `status` 当作 run 状态
当前公开 `getSession()` 路径返回 `status: null`，最后一次 run 已经成功结束的 session 也是如此。这个旧的 Session 字段不是 run 状态，不同部署上的值可能不同。不要轮询它，也不要用它做分支。真正的状态字段是 `run_status`（实测取值：`"succeeded"`）。
:::

响应里可能带有上表之外的字段。遇到不认识的就忽略，不要因此报错。

## 对话记录：`getSession({ history: true })`

传 `history: true` 会附上落盘的对话记录，它读自这个 session 存储的会话行：

```ts
const s = await zc.getSession(agentId, session.session_id, { history: true, limit: 20 })

for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  const msg = row.entry.message as { role?: string }
  console.log(row.seq, msg.role, messageText(row.entry.message))
}
```

每一条是 `{ seq, entry_type, entry, created_at }`。当 `entry_type: 'message'` 时，对话内容在 `entry.message`，形式是 `{ role, content }`，其中 `content` 是一个 block 数组，只有 `{ type: 'text', text }` 这种 block 带文本。`messageText()` 数组形式和纯字符串形式都能处理。

`limit` 是返回最近多少行，默认 100，最大 500。返回的行按 `seq` 升序排列。

一条实测的 assistant 行：

```json
{
  "seq": 2,
  "entry_type": "message",
  "entry": {
    "type": "message",
    "message": {
      "role": "assistant",
      "model": "litellm/claude-sonnet-5",
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
        { "type": "text", "text": "\n\nPROBE-ONE" }
      ],
      "stopReason": "stop"
    }
  },
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

有两样东西只有它能给你：

- **Token 用量。** `entry.message.usage` 是一个回合的 token 计数唯一暴露的地方。`usage.cost` 目前各字段都是 `0` —— 不要拿它做花费展示。
- **真正回答的那个模型。** `model` 是 agent 被配置成的模型；`responseModel` 是实际服务这次请求的模型。部署方可以把你配的别名映射到一个替代模型，上面的样例里两者就不一致。当这个答复要进计费、评测或合规记录时，以 `responseModel` 为准。

这是对话记录，不是事件日志。它装的是对话消息，不是 `run.started` / `agent.tool` / `run.finished`。用它来找回那些你漏掉了事件的答复；想要事件流就用 `listEvents`。还存在其他 `entry_type` 取值（session 锚点、压缩标记、模型变更）；筛出 `message`，其余跳过。

## `listEvents` 与分页

`listEvents` 返回一个 session 的持久事件日志 —— 你自己发的输入（`user.message` 等）也在里面，整段对话从这一个面就能重建 —— 已归一成单一的 `SessionEvent` 结构（`seq`、`eventType`、`payload`、`runId`、`turn`、`createdAt`，服务端给的话还有 `id` 和 `processedAt`）。

```ts
const events = await zc.listEvents(agentId, session.session_id, {
  types: ['user.message', 'agent.assistant'],
})
```

::: warning 一次调用只返回一页
服务端**默认返回 100 条事件，最多 500 条**，而 `listEvents` 只返回一页，且不带这一页的 `has_more`/`next_cursor` 字段。要重建整段对话，用 `listAllEvents`，或者用 `listEventsPage` 手动翻页。
:::

`listAllEvents` 就是这个翻页循环。它跟着服务端的 `next_cursor` 一直走到 `has_more` 为 false（对没有游标分页的服务端则回落到走 `after`）：

```ts
const all: SessionEvent[] = await zc.listAllEvents(agentId, session.session_id)
```

它比顺手写出来的循环更严格：它在页边界上去重，游标推不动时它停下来而不是空转。`pageSize` 是每次请求的 `limit`（默认值和上限都是 500）；`types` 的含义与 `listEvents` 上一致。

显式传 `after` —— 在这里或在 `listEvents`/`streamEvents` 上 —— 走的是废弃的 engine-only 通道：没有用户输入、没有分页标志，只留给旧存量游标用。`seq` 持久且严格递增，但不保证连续；续传 SSE 流用每个流式事件自带的 `cursor`（`streamEvents({ cursor })`）。`types` 在服务端过滤，可以和 `cursor`、`limit` 组合使用。

## SDK 里没有的

::: danger 不支持
`ZooworkClient` 没有 `patchSession`，对一个 session 发 `PATCH` 返回的是 `405`，这就使得 session 的 `metadata` 只能在 `createSession` 时写一次。

自己记录你创建过的那些 `session_id` —— 把它们和你应用里所属的东西存在一起 —— 并且在创建时就把之后需要检索的一切放进 `metadata`，因为后面加不进去。
:::

也没有顶层的 session 资源，所以无法跨 agent 列出 session。完整边界见[不支持的能力](../reference/not-supported.md)。

按 agent 的列举和生命周期操作确实有方法 —— `listSessions(agentId, { page })`、`archiveSession(agentId, sessionId)`、`deleteSession(agentId, sessionId)` —— 但它们不改变上面这两段：跨 agent 还是得你自己扇出去合并，`metadata` 还是只能写一次。

最后一个边界：session 隔离的是对话历史，不隔离沙箱里的文件——同一个 agent 的所有 session 共享一个 `/workspace`。多用户产品需要文件和记忆隔离时，见[每用户一个 agent](./per-user-agents.md)。
