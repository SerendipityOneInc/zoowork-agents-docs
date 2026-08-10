---
title: Sessions
source: /en/build/sessions
source_hash: 0ff607e34d2def6c1c1db6cba8f0761a63a420c38be77329ef3cabdc6eca2447
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

在 Claude Managed Agents 里，session 是顶层资源，agent 写在 body 里，所以从 Claude 移植过来的代码在这里编译不过，除非你把 agent id 一路穿下去 —— 见[从 Claude Managed Agents 迁移](/zh/reference/from-claude-managed-agents)。

本页所有示例共用一个客户端：

```ts
import {
  createZooclawClient,
  ZooclawError,
  assistantText,
  isRunFinished,
  runOutcome,
  messageText,
  type SessionEvent,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

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

`startAgent` 远远用不到一秒。它返回一个 `warnings` 数组；纯 API 的 agent 每次启动都会报 `channel_routes_reload_failed`，因为它没有聊天渠道路由可以重载。这是预期内的噪音，不是失败。

匹配 `error.type`，永远不要匹配报错文本：

```ts
try {
  await zc.createSession(agentId, {
    initial_events: [{ type: 'user.message', content: 'Hello.' }],
  })
} catch (e) {
  if (e instanceof ZooclawError && e.type === 'agent_not_running') {
    await zc.startAgent(agentId)
    // retry
  } else {
    throw e
  }
}
```

## 创建 session

```ts
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Summarize the attached brief.' }],
  metadata: { source: 'my-app', tenant: 'acme' },
})

console.log(session.session_id)   // "ses_example"
console.log(session.session_key)  // "api:example"
```

带 `initial_events` 创建会立刻启动第一个回合 —— 开场消息没有单独的「发送」步骤。

**`initial_events` 只接受 `user.message`。** 其他事件类型在这里都不合法；session 建好之后，其余的用 `postEvents` 投递。API 最多接受 50 条初始事件。`content` 传纯字符串这一形式已实测。

`metadata` 是一个随 session 一起存下来的任意 JSON 对象，`getSession` 会原样返回。它归你用来做关联 —— 一个租户 id、一个请求 id、这段对话来自哪个入口。平台不会解释它的任何内容。

### Idempotency-Key

`createSession` 接收一个可选的第三个参数，作为 `Idempotency-Key` 请求头发出：

```ts
const session = await zc.createSession(
  agentId,
  { initial_events: [{ type: 'user.message', content: userInput }] },
  `chat-${incomingMessageId}`,
)
```

它防的是超时或断连之后的那次重试：如果你没看到响应、但服务端确实创建了 session，用同一个 key 重放会返回已存在的那个 session，而不是再建一个、把开场回合跑两遍。key 要从你自己系统里稳定的东西推导出来，不要用调用时生成的随机值。用同一个 key 配不同的请求 body，是冲突，不是重放。

事件写入路径没有幂等键。超时后重试 `postEvents` 可能把同一条消息投递两次；重试之前请在你这边先去重。

## 多回合

要继续一段对话，往同一个 session 再投一条 `user.message`。不要重发历史 —— agent 在服务端持有它。

```ts
async function runTurn(sessionId: string, after = 0) {
  let text = ''
  let lastSeq = after
  let outcome: string | undefined
  for await (const ev of zc.streamEvents(agentId, sessionId, { after })) {
    lastSeq = ev.seq
    text += assistantText(ev)
    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
  return { text, lastSeq, outcome }
}

// Turn 1 - opens with the session.
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'My display name is Ada.' }],
})
const first = await runTurn(session.session_id)
console.log(first.outcome, first.text)   // "succeeded" ...

// Turn 2 - same session, new message. Resume the stream from the last seq you saw.
await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'What is my display name?' },
])
const second = await runTurn(session.session_id, first.lastSeq)
console.log(second.text)                 // mentions "Ada"
```

`postEvents` 返回 `202`，每个事件对应一条记录：`{ id?, type?, accepted? }`。被接受意味着事件已入队，不代表回合已经结束。一个回合在你看到 `run.finished` 时结束，它的 `payload.status` 是 `succeeded`、`failed` 或 `aborted`。事件流的作用域是 session，不会在回合之间关闭 —— 见[事件与流式](/zh/build/events)。

写入路径接受四种事件类型：`user.message`、`user.interrupt`、`system.message` 和 `user.tool_confirmation`。

## 读取 session

```ts
const s = await zc.getSession(agentId, session.session_id)
```

实测响应：

```json
{
  "session_id": "ses_example",
  "session_key": "api:example",
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
| `pending_approvals` | 正在等待审批的工具调用数量。 |
| `status` | 永远是 `null`。见下面。 |

::: danger `status` 是 null —— 请读 `run_status`
`status` 在每一次读取里都返回 `null`，包括最后一次 run 已经成功结束的 session。它不是一个你能轮询的状态机。真正带值的字段是 `run_status`（实测取值：`"succeeded"`）。用 `session.status` 做分支的代码，会永远走同一个分支。
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

- **Token 用量。** `entry.message.usage` 是一个回合的 token 计数唯一暴露的地方。`usage.cost` 在 staging 上是 `0` —— 不要拿它做花费展示。
- **真正回答的那个模型。** `model` 是 agent 被配置成的模型；`responseModel` 是实际服务这次请求的模型。在 staging 上两者不一致，因为 staging 把一部分模型映射到了替代模型。以 `responseModel` 为准。

这是对话记录，不是事件日志。它装的是对话消息，不是 `run.started` / `agent.tool` / `run.finished`。用它来找回那些你漏掉了事件的答复；想要事件流就用 `listEvents`。还存在其他 `entry_type` 取值（session 锚点、压缩标记、模型变更）；筛出 `message`，其余跳过。

## `listEvents` 与分页

`listEvents` 返回一个 session 的持久事件日志，已归一成单一的 `SessionEvent` 结构（`seq`、`eventType`、`payload`、`runId`、`turn`、`createdAt`）。

```ts
const events = await zc.listEvents(agentId, session.session_id, {
  types: ['agent.assistant'],
})
```

::: warning 一次调用只返回一页 —— 长会话会被静默截断
服务端**默认返回 100 条事件，最多 500 条** ，而 `listEvents` 只返回一页。没有 `has_more` 标志，也没有报错：一个有 900 条事件的 session 只返回前 100 条，看上去却是完整的。任何要重建整段对话的代码都必须分页。
:::

`listAllEvents` 就是这个翻页循环。它用 `after` 游标 —— 也就是它收到的最后一个事件的 `seq` —— 一直走，直到某一页返回的条数少于它请求的 limit：

```ts
const all: SessionEvent[] = await zc.listAllEvents(agentId, session.session_id)
```

它存在正是因为上面那种截断，而且它在两个地方比顺手写出来的循环更严格：`seq` 不大于游标的事件会被丢掉，所以页边界不会重复吐出同一个事件；如果某一页里最大的 `seq` 没能把游标推进，这次遍历就直接停下来，所以一个忽略了 `after` 的服务端只会让你拿到一页重复数据，而不是让循环空转到底。`pageSize` 是每次请求的 `limit`（默认值和上限都是 500）；`after` 和 `types` 的含义与 `listEvents` 上一致。

`seq` 是每个 session 内持久且单调的序号，所以同一个游标也能用来续传 SSE 流（`streamEvents({ after })`）。`types` 在服务端过滤，接收一个事件类型列表；它可以和 `after`、`limit` 组合使用。

## SDK 里没有的

::: danger 不支持
`ZooclawClient` 没有 `patchSession`。对一个 session 发 `PATCH`，经过网关返回的是 `405` —— 网关的 catch-all 只注册了 GET/POST/PUT/DELETE，PATCH 根本没有被代理 —— 这就使得 session 的 `metadata` 只能在 `createSession` 时写一次。

自己记录你创建过的那些 `session_id` —— 把它们和你应用里所属的东西存在一起 —— 并且在创建时就把之后需要检索的一切放进 `metadata`，因为后面加不进去。
:::

也没有顶层的 session 资源，所以无法跨 agent 列出 session。完整边界见[不支持的能力](/zh/reference/not-supported)。

按 agent 的列举和生命周期操作确实有方法 —— `listSessions(agentId, { page })`、`archiveSession(agentId, sessionId)`、`deleteSession(agentId, sessionId)` —— 但它们不改变上面这两段：跨 agent 还是得你自己扇出去合并，`metadata` 还是只能写一次。这三个各自被驱动到什么程度，记在[能力矩阵](/zh/reference/capabilities)里。
