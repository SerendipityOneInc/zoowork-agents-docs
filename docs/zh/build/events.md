---
title: 事件与流式
description: 写入事件、消费 SSE、通过 cursor 续传，并理解完整的事件词表。
source: /en/build/events
source_hash: 3bc0bc2364d7d0cedcd38e2d8a41e5a45a78454cf12f9a54714cf8c35248f0c4
---

# 事件与流式

Session 里发生的每一件事都是一个 event。你通过 post 少数几种入站 event 来驱动 session，然后从同一份事件日志把整段对话读回来——你自己的输入也在里面，和 engine 的输出并排回显——可以读持久化的列表，也可以读实时的 SSE 流。

事件日志按 session 划分。每个 event 带一个 `seq`，它在该 session 内严格递增且永不复用（有洞是正常的）。分页和流式续传都走游标：列表页的 `next_cursor`，或每个流式事件自带的 `cursor`。

```ts
import {
  createZooworkClient,
  assistantText,
  isRunFinished,
  runOutcome,
} from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY }) // zct_...

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  process.stdout.write(assistantText(ev))
  if (isRunFinished(ev)) {
    console.log(`\nturn ${runOutcome(ev)}`)
    break
  }
}
```

## 事件信封

SDK 会把每一个 event、无论来自哪种 transport，都归一成同一个结构：

```ts
interface SessionEvent {
  /** Durable per-session sequence: strictly increasing, not necessarily contiguous. */
  seq: number
  eventType: SessionEventType | PublicInputEventType | string
  payload: Record<string, unknown>
  runId?: string
  turn?: number
  createdAt?: string
  id?: string
  processedAt?: string | null
  cursor?: string
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `seq` | `number` | 在 session 内严格递增，由服务端分配，有洞是正常的。如果这一帧完全没带 sequence 就是 `-1`，而这在持久流上不应该发生。 |
| `eventType` | `string` | 下面几张表中的某个值。故意标注得很松：未知类型会原样透传而不是抛错，因为这个 API 处于 Developer Preview，可能在一个版本内新增类型。 |
| `payload` | `Record<string, unknown>` | 与类型相关的 body，永远是一个对象。缺省时是 `{}` 而不是 `undefined`。它的 key 是 camelCase。 |
| `runId` | `string \| undefined` | 这个回合的 run。同一回合的所有 event 共享它。输入事件没有。 |
| `turn` | `number \| undefined` | 该 session 内的回合序号。 |
| `createdAt` | `string \| undefined` | ISO 8601 时间戳。 |
| `id` | `string \| undefined` | 事件 id，服务端给的话就有。 |
| `processedAt` | `string \| null \| undefined` | 仅输入事件：排队中是 `null`，agent 消费后变成时间戳。 |
| `cursor` | `string \| undefined` | 续传令牌，流式事件上有——传给 `streamEvents({ cursor })`。 |

没有顶层 `type` 字段，没有 `stop_reason`，也没有 `session.status_*` 事件。如果你在移植一份 switch `event.type` 的代码，改成 switch `event.eventType`。

`payload` 是刻意松散的。读你需要的字段，忽略其余的；服务端会在一个版本内追加字段。

## 底层的线格式

::: warning 线格式的拼写不一致
统一通道上两种 transport 发的是同一个 snake_case 对象（`event_type`、`run_id`、`processed_at`、`created_at`），SSE 的 `id:` 行承载续传令牌。废弃的 `after` 通道上，REST 仍是 snake_case，但 SSE 帧是 camelCase（`eventType`、`runId`、`createdAt`）。**任何形状都不带顶层 `type`。**

SDK 在 `normalizeEvent` 里吸收了这一切，所以 `listEvents` 和 `streamEvents` 返回同一个 `SessionEvent`，你根本看不到区别。如果你直接调 HTTP API，这些映射都得自己处理。
:::

服务端每 20 秒写一行 `: ping` 注释作为 keepalive，所以任何低于这个值的 socket 读超时或代理空闲超时都会杀掉一条健康的流；而一个不跳过注释行的手写解析器会撞上 `JSON.parse('')` 并抛异常——不想自己写的话，`parseSSE` 是导出的。

`normalizeEvent` 是导出的，所以如果你有自己的 transport，可以复用它：

```ts
import { normalizeEvent } from '@zoowork-ai/sdk'

const ev = normalizeEvent(JSON.parse(frameData), sseIdLine) // sseIdLine is the seq fallback
```

## 事件词表

以下是全部出站事件类型，也就是 `SESSION_EVENT_TYPES` 的完整内容（固定 19 项），外加[你自己的输入，回显](#你自己的输入回显)那四种输入类型。历史查询上的 `types=` 过滤器接受这两组，其余任何值都以 `400 invalid_request` 拒绝。

### `run.*` —— 回合记账

| 类型 | 何时触发 | `payload` |
|---|---|---|
| `run.started` | 一个回合开始，早于任何模型调用。 | `trigger`、`inboundMessageId`、`agentId` |
| `run.finished` | 回合结束。这是该回合的最后一个 event。 | `status`：`succeeded` \| `failed` \| `aborted` |

### `agent.*` —— 回合内部发生了什么

| 类型 | 何时触发 | `payload` |
|---|---|---|
| `agent.lifecycle` | 给回合内的 agent 循环封头封尾。 | `phase`：`start` \| `end`。定时触发的 agent 还可能发出 `phase: 'heartbeat-skipped'`，带 `reason`、`scheduleId`、`firedAt`。 |
| `agent.assistant` | 一个 assistant 消息片段被提交。 | `message`（`{ role, content[] }`）、`segment`（从 1 开始的步骤序号）、可选的 `artifacts`。用 `assistantText()`。 |
| `agent.thinking` | 刚提交的那个片段对应的推理文本。 | `text` |
| `agent.tool` | 一次工具调用切换了 phase。见[工具调用的 phase](#工具调用的-phase)。 | `phase`、`toolCallId`、`toolName`；start 时有 `args`；end 时有 `isError`、`resultPreview`、`executionStarted`；blocked 时有 `policyId`、`deniedReason`。 |
| `agent.item` | 内部循环标记，不是对话内容。 | `kind`：`assistant_segment`（带 `phase`、`segment`）或 `llm_request`（抓取到的 provider 请求/响应）。渲染聊天界面时可以安全忽略。 |
| `agent.plan` | 词表里保留的类型。核心循环不会发出它。 | - |
| `agent.approval` | 某次工具调用需要审批，或该审批已经有了结果。 | `phase`：`requested` \| `resolved`；`approvalId`、`toolCallId`、`toolName`、`arguments`，可选的 `stake`、`timeoutAt`；`resolved` 时还有 `resolution`，以及可选的 `resolvedBy`、`resolutionChannel`。 |
| `agent.command_output` | 某个执行命令的工具产生了 stdout/stderr，按结果粒度给出。 | `toolCallId`、`toolName`，以及抓取到的输出字段。 |
| `agent.patch` | 一次 `apply_patch` 工具调用成功。 | `toolCallId`，以及这次 patch 的摘要。 |
| `agent.compaction` | 历史被压缩以塞进上下文窗口。 | `firstKeptEntryId`、`tokensBefore`、`reason` |
| `agent.error` | 回合内部发生了一个错误。 | `errorMessage`，有时还有 `kind`（例如 `mcp_connection_failed`）和 `server`。它本身不是对这个回合的判决；判决读 `run.finished`。 |

### 其他

| 类型 | 何时触发 | `payload` |
|---|---|---|
| `attachment.created` | 某个工具产出了一个文件或附件。 | `source`、`toolName`、`toolCallId`、`index`，以及存储引用相关的字段。 |
| `message.outbound` | Agent 主动发出了一条消息（message 工具、schedule announce 或 heartbeat），而不是在 session 内回复。 | `source`、`sourceRef`、`delivery`、`text`、`action`、`index`、`computerId`、`agentId`，可选的 `card`、`artifacts`。 |

### 你自己的输入，回显

你自己发的输入会以 `user.message`、`user.interrupt`、`user.tool_confirmation`、`system.message` 出现在同一份日志里（导出为 `PUBLIC_INPUT_EVENT_TYPES`）。`user.message` 的 payload 是 `{ content: [...] }` —— 文本 block 加 `{ type: 'attachment', mime, name, size }` 存根 —— 它的 `processedAt` 在 agent 消费后从 `null` 变成时间戳。这四种的写入侧规则见[入站事件](#入站事件)。

### `chat.*` —— 不在持久日志上

`chat.delta`、`chat.final`、`chat.aborted` 和 `chat.error` 也是词表成员，但**不会写进持久事件日志** 。它们活在一条独立的、按 run 划分的预览通道上，唯一能看到其中内容的办法是本页末尾讲的 `?deltas=` 查询参数。不要拿它们构建回合逻辑；一个回合的边界是 `run.started` 和 `run.finished`。

::: warning 尚未验证
我们在真实 session 上反复观察到的序列是 `run.started`、`agent.lifecycle`、`agent.item`、`agent.thinking`、`agent.assistant`、`agent.tool`（start/end）、`agent.lifecycle`、`run.finished`。

`agent.approval`、`agent.command_output`、`agent.patch`、`agent.compaction`、`attachment.created` 和 `message.outbound` 在词表里，引擎也会发出它们，但我们没有通过这个 API 端到端跑通过其中任何一个。把它们的 payload 字段当作参考，不是契约，代码要写得防御一些。（回显的输入事件已验证：投递、回显、`processedAt`、游标续传、重试去重，2026-08-19 端到端跑通。）
:::

## 入站事件

你能 post 的事件类型恰好只有四种。其他任何类型都会被拒绝，返回 `400 invalid_event`，并在消息里点名这四种。

```ts
const res = await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Summarize the last three findings.' },
])
// res.events -> 被接受的事件返回完整事件对象（带 seq）；
//               没有进行中 run 的 user.interrupt 是 { id, type, accepted: false }
```

`postEvents` 返回 `202`，每提交一个 event 对应一条记录。`accepted` 是那个真正重要的字段。

### `user.message`

追加一个用户回合并启动一个 run。

```json
{ "type": "user.message", "content": "Hello", "idempotency_key": "optional", "attachments": [] }
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `content` | 是 | 必须是**非空字符串** 。其他任何形式都是 `400 invalid_event`。 |
| `attachments` | 否 | 如果出现，必须是数组。 |
| `idempotency_key` | 否 | 非空字符串。用作投递去重的 key，所以带同一个 key 的重试会收敛，而不是把消息发重。 |

`createSession(agentId, { initial_events })` 只接受 `user.message`，别的都不接受，最多 50 条。

::: warning 尚未验证
我们只跑过纯字符串的 `content`。富内容块目前不被解析器接受，所以请发字符串。
:::

### `user.interrupt`

中止当前正在跑的那个 run。

```json
{ "type": "user.interrupt" }
```

没有其他字段。有 run 在跑时，它返回 `accepted: true`，该回合以 `run.finished` `status: 'aborted'` 结束。**没有** run 在跑时，它返回 `accepted: false`。那是一个空操作，不是错误，HTTP 状态码仍然是 `202`。

```ts
const r = await zc.postEvents(agentId, sessionId, [{ type: 'user.interrupt' }])
if (r.events[0]?.accepted === false) {
  // nothing was running; not a failure
}
```

### `user.tool_confirmation`

解决一个待处理的审批。

```json
{ "type": "user.tool_confirmation", "approval_id": "apr_...", "decision": "allow-once" }
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `approval_id` | 是 | 非空字符串。来自 `agent.approval` 的 `payload.approvalId`。 |
| `decision` | 是 | 恰好是 `allow-once`、`allow-always`、`deny` 三者之一。 |

注意这里大小写风格是混的：请求体是 snake_case（`approval_id`），而你读到这个值的那个事件 payload 是 camelCase（`approvalId`）。其他任何形状都是 `400 invalid_event`。

::: warning 尚未验证
上面这个可接受的请求体是从请求解析器里读出来的；没有任何一个真实的待处理审批通过这条路由被创建并解决过。审批闭环的状态记在[能力矩阵](../reference/capabilities.md)里。
:::

### `system.message`

注入一条带外说明，模型会在下一个回合读到它——它是你自己应用掌握的状态，不以用户发言的形式出现。

```json
{ "type": "system.message", "text": "Operator note: the user's plan is Enterprise." }
```

`text` 必须是非空字符串。已实测：这条说明进的是下一个回合的上下文，不是当前回合，所以要把它 post 在它应该影响的那条 `user.message` 之前。

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'system.message', text: "Operator note: the user's plan is Enterprise." },
  { type: 'user.message', content: 'Which limits apply to me?' },
])
```

## 流式读取一个回合

`streamEvents` 是一个覆盖实时 session 流的异步生成器。

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

::: danger 这个流是 session 级的，回合结束时不会关闭
`run.finished` 是*回合*的结束，不是*流*的结束。连接会保持打开等待下一个回合，只有当连接空闲得足够久时，服务端才会断开它。

如果你 `for await` 跑到底，或者 `await` 一个从生成器收集来的数组，你就会一直等到服务端把这个连接超时掉。永远要在 `isRunFinished(ev)` 时 `break`。
:::

一个完整的单回合，带一个墙钟预算，这样一个卡住的 run 不会把你的进程挂死：

```ts
import {
  createZooworkClient,
  assistantText,
  thinkingText,
  toolCall,
  isRunFinished,
  runOutcome,
} from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const session = await zc.createSession(agentId, {
  metadata: { source: 'docs-example' },
  initial_events: [{ type: 'user.message', content: 'What can you do? One sentence.' }],
})

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined
let cursor: string | undefined

try {
  for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
    cursor = ev.cursor ?? cursor

    const think = thinkingText(ev)
    const tool = toolCall(ev)
    if (think) console.log(`[${ev.seq}] thinking: ${think.slice(0, 60)}`)
    else if (tool) console.log(`[${ev.seq}] tool ${tool.toolName} ${tool.phase}`)
    else console.log(`[${ev.seq}] ${ev.eventType}`)

    text += assistantText(ev)

    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break // required: the stream will not end on its own
    }
  }
} finally {
  clearTimeout(budget)
  ctl.abort() // releases the HTTP connection
}

console.log(outcome, text.trim())
```

机制上的几点：

- abort 掉 `signal` 会干净地结束生成器。SDK 会吞掉这个 abort 而不是抛出，所以你不需要为自己发起的取消写 `catch`。
- 生成器会丢弃任何 `seq` 小于等于它已产出过的最高值的 event，所以重连时被重放的边界 event 不会被投递两次。
- `streamEvents` 产出的一切都是持久的。
- 对于多回合 session，要么每个回合开一条新流并带上上次的 `cursor`，要么保持一条流开着并持续数 `run.finished` 事件。前者更容易推理。

## 续传

每一个持久帧都在 SSE 的 `id:` 行里带着自己的续传令牌，SDK 把它以 `ev.cursor` 交还给你。传 `{ cursor }`，服务端会先从那个事件之后重放日志，再继续实时推送。这是**服务端续传** ：没有客户端缓冲，没有去重环节，重连慢一点也不会有空洞。

```ts
for await (const ev of zc.streamEvents(agentId, sessionId, { cursor: saved })) {
  saved = ev.cursor ?? saved
}
```

如果你直接调 HTTP 端点，用 `?cursor=` 或标准的 `Last-Event-ID` 请求头都可以。浏览器的 `EventSource` 会自动发送 `Last-Event-ID`，因为服务端写了 `id:` 行。`{ after: seq }` 仍能续传废弃的 engine-only 通道——只留给旧存量游标用。

### 一个扛得住断线的重连循环

SDK 不会替你重连。十六行代码就够了：

```ts
import {
  ZooworkError,
  assistantText,
  isRunFinished,
  runOutcome,
  type ZooworkClient,
} from '@zoowork-ai/sdk'

async function runTurnWithResume(
  zc: ZooworkClient,
  agentId: string,
  sessionId: string,
  startCursor?: string,
  maxAttempts = 6,
): Promise<{ outcome?: 'succeeded' | 'failed' | 'aborted'; text: string; cursor?: string }> {
  let cursor = startCursor
  let text = ''

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      for await (const ev of zc.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
        cursor = ev.cursor ?? cursor
        text += assistantText(ev)
        if (isRunFinished(ev)) {
          const outcome = runOutcome(ev)
          return { ...(outcome ? { outcome } : {}), text, ...(cursor ? { cursor } : {}) }
        }
      }
      // The generator returned without run.finished: the server closed the
      // connection. Nothing is lost - reconnect from the last cursor.
    } catch (e) {
      // 4xx is a real problem (bad id, archived session, expired key). Retrying
      // will not fix it.
      if (e instanceof ZooworkError && e.status >= 400 && e.status < 500) throw e
    }
    await new Promise((r) => setTimeout(r, Math.min(1_000 * 2 ** attempt, 15_000)))
  }

  return { text, ...(cursor ? { cursor } : {}) }
}
```

把 cursor 和你的 session id 存在一起。它跨进程重启依然有效，所以一个在回合中途崩掉的 worker 能精确地从它停下的地方把这个回合接回来。

### 历史读取用的是同一个游标

`listEvents` 通过 REST 读同一份持久日志，列表页的 `next_cursor` 和流式事件的 `cursor` 是同一种令牌。

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

`limit` 在服务端默认是 **100** ，上限是 **500** ，而且这个调用只返回**一页** ，不带这一页的 `has_more`/`next_cursor` 字段（`listEventsPage` 是保留分页字段的同一个调用，供手动翻页）。其余情况读日志请用 `listAllEvents`，它替你跟完服务端的游标：

```ts
const all = await zc.listAllEvents(agentId, sessionId)
```

`types` 在服务端过滤，两个调用都支持，且只能包含词表成员；出现未知值就是 `400 invalid_request`。

```ts
const replies = await zc.listAllEvents(agentId, sessionId, { types: ['agent.assistant'] })
```

从 REST 重放拼出来的文本，和从流拼出来的文本逐字节相同。

## 辅助函数

全部从 `@zoowork-ai/sdk` 导出。每一个都是作用在 `SessionEvent` 上的纯函数，对类型不匹配的 event 返回一个无害的空值，所以你可以在一个循环里无条件地调用它们。

**`assistantText(e)`** —— 对 `agent.assistant` 事件返回 assistant 文本，其他一律返回 `''`。

```ts
text += assistantText(ev)
```

**`thinkingText(e)`** —— 对 `agent.thinking` 事件返回推理文本，其他一律返回 `''`。

```ts
if (thinkingText(ev)) console.log('thinking:', thinkingText(ev))
```

**`toolCall(e)`** —— 对 `agent.tool` 事件返回一个 `ToolCall`，其他一律返回 `undefined`。

```ts
const tool = toolCall(ev)
if (tool?.phase === 'end' && tool.isError) console.warn(`${tool.toolName} failed`)
```

**`isRunFinished(e)`** —— 对 `run.finished` 返回 `true`。这就是你的循环退出条件。

```ts
if (isRunFinished(ev)) break
```

**`runOutcome(e)`** —— 对 `run.finished` 事件返回 `'succeeded' | 'failed' | 'aborted'`，其他一律返回 `undefined`（状态无法识别时也是 `undefined`）。

```ts
const outcome = runOutcome(ev) // undefined unless ev is run.finished
```

**`messageText(message)`** —— 返回一个 `{ role, content }` 消息对象的文本。用在 `getSession(agentId, sessionId, { history: true })` 返回的记录行上——那里消息挂在 `entry.message`，而不是在事件 payload 里面。block 数组和纯字符串两种形式它都能处理。

```ts
const s = await zc.getSession(agentId, sessionId, { history: true, limit: 50 })
const transcript = (s.history ?? [])
  .filter((row) => row.entry_type === 'message')
  .map((row) => messageText(row.entry.message))
```

`ToolCall` 的结构：

```ts
interface ToolCall {
  phase: 'start' | 'end' | 'blocked'
  toolName: string
  toolCallId: string
  args?: Record<string, unknown>
  isError?: boolean
  resultPreview?: string
}
```

## 回合结果

一个回合恰好以一个 `run.finished` 结束。它的 `payload.status` 是以下之一：

| `status` | 含义 |
|---|---|
| `succeeded` | 循环跑完了。 |
| `failed` | 回合出错终止。通常前面会有一个带 `errorMessage` 的 `agent.error`。 |
| `aborted` | 一个 `user.interrupt` 落到了正在跑的 run 上。 |

::: danger 工具失败不会让 run 失败
一个 `phase: 'end'` 且 `isError: true` 的 `agent.tool` 事件，后面照样跟着 `status: 'succeeded'` 的 `run.finished`。模型看到了这个工具错误，绕开了它，并给出了答案。那就是一个成功的回合。

反过来同样成立：**不要因为没有工具错误就推断成功** 。读 `runOutcome()`，别读别的。
:::

```ts
if (isRunFinished(ev)) {
  const outcome = runOutcome(ev)
  if (outcome !== 'succeeded') {
    // the turn itself failed or was aborted
  }
  break
}
```

如果你想把工具层面的问题暴露给你的用户，请在流式过程中单独收集它们，并把它们和回合结果一起报告，而不是用它们取代回合结果。

## 工具调用的 phase

一次工具调用会产生多个共享同一个 `toolCallId` 的 `agent.tool` 事件。

| `phase` | 含义 | 携带 |
|---|---|---|
| `start` | 调用已派发。 | `args` |
| `end` | 调用已返回。 | `isError`、`resultPreview`、`executionStarted` |
| `blocked` | 这次调用**正在等待审批，还没有执行** 。 | `policyId`、`deniedReason` |

两条规则：

1. **按 `toolCallId` 配对，不要按前后相邻配对。** 当多个调用并发执行时，同一次调用的 `start` 和 `end` 之间会夹着属于其他调用的事件。
2. **`blocked` 是待处理，不是已完成。** 它意味着一道审批闸门在执行前拦住了这次调用。对应的 `agent.approval` 事件带着这个请求，而一旦审批有了结果，`end` 仍然会跟上。把 `blocked` 渲染成一次已完成的调用，会让你的用户以为一个从未运行过的工具已经运行了。

```ts
const pending = new Map<string, ToolCall>() // toolCallId -> latest state

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  const tool = toolCall(ev)
  if (tool) {
    if (tool.phase === 'end') pending.delete(tool.toolCallId)
    else pending.set(tool.toolCallId, tool) // start AND blocked are both in flight
  }
  if (isRunFinished(ev)) break
}

console.log(`${pending.size} tool calls never returned`)
```

`toolCall()` 会把任何它不认识的 phase 映射成 `start`，所以如果你需要线上的确切值，请直接读 `ev.payload.phase`。

## `?deltas=` 预览通道

流式端点接受 `?deltas=agent.message`，它会把增量预览帧交错混进持久帧之间。SDK 没有暴露它，`streamEvents` 也从不请求它，所以本节只和直接调 HTTP 的调用方有关。

有两点和你可能的预期不一样。预览帧**不带 `id:` 行** ：它们不属于持久游标，永远不会被重放。而预览帧上的 `replace: true` 意思是**整体快照替换，不是前缀追加** ——每一帧带的都是当前的完整文本，所以你为前缀追加式 delta 流写的那个 `+=` 会把已经显示过的内容全部重复一遍。要赋值，不要追加。

在没有配置预览后端的部署上请求 `deltas`，会在流打开之前返回 `501 not_configured`，所以你拿到的是一个正常的 JSON 错误，而不是一条一直沉默的流。

::: warning 尚未验证
上面的语义是从服务端实现里读出来的；`?deltas=` 没有对着真实部署跑过。要拿最终文本，请用 `agent.assistant` 事件——它是持久的、可续传的，而且已实测。
:::
