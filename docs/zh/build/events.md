---
title: 事件与流式
source: /en/build/events
source_hash: a255cdc6aa062885795550de92fba4ead117004d51bdb444b2c110fc19c2a39e
---

# 事件与流式

Agent 在一个 session 里做的每一件事都是一个 event。你通过 post 少数几种入站 event 来驱动 session，通过读取出站事件日志来观察它——可以读持久化的列表，也可以读实时的 SSE 流。

事件日志按 session 划分。每个 event 带一个 `seq`，它在该 session 内单调递增且永不复用。`seq` 是你唯一需要的游标：历史分页靠它，流式续传也靠它。

```ts
import {
  createZooclawClient,
  assistantText,
  isRunFinished,
  runOutcome,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...

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
  /** Durable per-session sequence. Use as the `after` cursor when resuming. */
  seq: number
  eventType: SessionEventType | string
  payload: Record<string, unknown>
  runId?: string
  turn?: number
  createdAt?: string
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `seq` | `number` | 在 session 内单调递增，由服务端分配。如果这一帧完全没带 sequence 就是 `-1`，而这在持久流上不应该发生。 |
| `eventType` | `string` | 下表中的某个值。故意标注成 `SessionEventType \| string`：未知类型会原样透传而不是抛错，因为这个 API 处于 Developer Preview，可能在一个版本内新增类型。 |
| `payload` | `Record<string, unknown>` | 与类型相关的 body，永远是一个对象。缺省时是 `{}` 而不是 `undefined`。它的 key 是 camelCase。 |
| `runId` | `string \| undefined` | 这个回合的 run。同一回合的所有 event 共享它。 |
| `turn` | `number \| undefined` | 该 session 内的回合序号。 |
| `createdAt` | `string \| undefined` | ISO 8601 时间戳。 |

没有顶层 `type` 字段，没有 `stop_reason`，也没有 `session.status_*` 事件。如果你在移植一份 switch `event.type` 的代码，改成 switch `event.eventType`。

`payload` 是刻意松散的。读你需要的字段，忽略其余的；服务端会在一个版本内追加字段。

## 底层的线格式

::: warning 两种 transport 的拼写不一致
同一个 event，你在哪里读它，它回来的形状就不一样。

| | REST `GET .../events` | SSE `GET .../events/stream` |
|---|---|---|
| 序号 | `seq` | `seq`，同时还有 SSE 的 `id:` 行 |
| 事件类型 | `event_type` | `eventType` |
| run | `run_id` | `runId` |
| 回合 | `turn` | `turn` |
| 事件体 | `payload` | `payload` |
| 时间戳 | `created_at` | `createdAt` |
| 额外字段 | | `version`、`engine`、`sessionId` |

REST 是 snake_case，SSE 是 camelCase。**两者都不带顶层 `type`。**

SDK 在 `normalizeEvent` 里吸收了这个差异，所以 `listEvents` 和 `streamEvents` 返回同一个 `SessionEvent`，你根本看不到区别。如果你直接调 HTTP API，这两套映射都得自己写。
:::

一个原始 SSE 帧长这样：

```
id: 42
data: {"version":1,"engine":"zooclaw","sessionId":"ses_...","seq":42,"runId":"run_...","turn":0,"eventType":"agent.assistant","payload":{"message":{"role":"assistant","content":[{"type":"text","text":"Hi."}]},"segment":1},"createdAt":"2026-08-06T09:12:44.001Z"}
```

服务端还会每 20 秒写一行 `: ping` 注释作为 keepalive。符合规范的 SSE 解析器会忽略它们，SDK 的解析器就是这样。

`normalizeEvent` 是导出的，所以如果你有自己的 transport，可以复用它：

```ts
import { normalizeEvent } from '@zooclaw-agents/sdk'

const ev = normalizeEvent(JSON.parse(frameData), sseIdLine) // sseIdLine is the seq fallback
```

## 事件词表

以下是全部出站事件类型，也就是 `SESSION_EVENT_TYPES` 的完整内容。这是一个固定的 19 项列表；历史查询上的 `types=` 过滤器会用 `400 invalid_request` 拒绝其中之外的任何值。

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

### `chat.*` —— 不在持久日志上

`chat.delta`、`chat.final`、`chat.aborted` 和 `chat.error` 也是词表成员，但**不会写进持久事件日志** 。它们活在一条独立的、按 run 划分的预览通道上，唯一能看到其中内容的办法是本页末尾讲的 `?deltas=` 查询参数。不要拿它们构建回合逻辑；一个回合的边界是 `run.started` 和 `run.finished`。

::: warning 尚未验证
我们在真实 session 上反复观察到的序列是 `run.started`、`agent.lifecycle`、`agent.item`、`agent.thinking`、`agent.assistant`、`agent.tool`（start/end）、`agent.lifecycle`、`run.finished`。

`agent.approval`、`agent.command_output`、`agent.patch`、`agent.compaction`、`attachment.created` 和 `message.outbound` 在词表里，引擎也会发出它们，但我们没有通过这个 API 端到端跑通过其中任何一个。把它们的 payload 字段当作参考，不是契约，代码要写得防御一些。
:::

## 入站事件

你能 post 的事件类型恰好只有四种。其他任何类型都会被拒绝，返回 `400 invalid_event`，并在消息里点名这四种。

```ts
const res = await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Summarize the last three findings.' },
])
// res.events -> [{ id?: string, type?: string, accepted?: boolean }]
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
我们没有端到端跑通过一次审批。上面这个可接受的请求体是从请求解析器里读出来的，但没有任何一个真实的待处理审批通过这条路由被创建并解决过，而且一个卡在无人应答的审批上的回合会超时。不要围绕 human-in-the-loop 审批做演示。
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
  opts?: { after?: number; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

::: danger 这个流是 session 级的，回合结束时不会关闭
`run.finished` 是*回合*的结束，不是*流*的结束。连接会保持打开等待下一个回合，只有当连接空闲得足够久时，服务端才会断开它。

如果你 `for await` 跑到底，或者 `await` 一个从生成器收集来的数组，你就会一直等到服务端把这个连接超时掉。永远要在 `isRunFinished(ev)` 时 `break`。
:::

一个完整的单回合，带一个墙钟预算，这样一个卡住的 run 不会把你的进程挂死：

```ts
import {
  createZooclawClient,
  assistantText,
  thinkingText,
  toolCall,
  isRunFinished,
  runOutcome,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const session = await zc.createSession(agentId, {
  metadata: { source: 'docs-example' },
  initial_events: [{ type: 'user.message', content: 'What can you do? One sentence.' }],
})

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined
let lastSeq = 0

try {
  for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
    lastSeq = ev.seq

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
- `streamEvents` 从不请求 delta 预览通道，所以它产出的一切都是持久的。
- 对于多回合 session，要么每个回合开一条新流并带上 `after: lastSeq`，要么保持一条流开着并持续数 `run.finished` 事件。前者更容易推理。

## 续传

这是本 API 比你可能习惯的那个替代方案更强的地方。

每一个持久帧都在 SSE 的 `id:` 行里带着自己的 `seq`。传 `{ after: lastSeq }`，服务端会先从 `lastSeq + 1` 重放日志，再继续实时推送。这是**服务端续传** ：没有客户端缓冲，没有去重环节，重连慢一点也不会有空洞。

```ts
for await (const ev of zc.streamEvents(agentId, sessionId, { after: 128 })) {
  // first event delivered is seq 129, even if the turn finished minutes ago
}
```

在没有服务端续传的平台上，连接掉了之后唯一的恢复办法是重新列一遍历史、自己按 event id 去重；在这里服务端直接从你的游标重放，重连不花任何代价。

如果你直接调 HTTP 端点，用 `?after=<seq>` 或标准的 `Last-Event-ID` 请求头都可以；服务端从两者中较大的那个开始续传。浏览器的 `EventSource` 会自动发送 `Last-Event-ID`，因为服务端写了 `id:` 行。

### 一个扛得住断线的重连循环

SDK 不会替你重连。十六行代码就够了：

```ts
import {
  ZooclawError,
  assistantText,
  isRunFinished,
  runOutcome,
  type ZooclawClient,
} from '@zooclaw-agents/sdk'

async function runTurnWithResume(
  zc: ZooclawClient,
  agentId: string,
  sessionId: string,
  startSeq = 0,
  maxAttempts = 6,
): Promise<{ outcome?: 'succeeded' | 'failed' | 'aborted'; text: string; lastSeq: number }> {
  let lastSeq = startSeq
  let text = ''

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      for await (const ev of zc.streamEvents(agentId, sessionId, { after: lastSeq })) {
        lastSeq = ev.seq
        text += assistantText(ev)
        if (isRunFinished(ev)) {
          const outcome = runOutcome(ev)
          return { ...(outcome ? { outcome } : {}), text, lastSeq }
        }
      }
      // The generator returned without run.finished: the server closed the
      // connection. Nothing is lost - reconnect from lastSeq.
    } catch (e) {
      // 4xx is a real problem (bad id, archived session, expired key). Retrying
      // will not fix it.
      if (e instanceof ZooclawError && e.status >= 400 && e.status < 500) throw e
    }
    await new Promise((r) => setTimeout(r, Math.min(1_000 * 2 ** attempt, 15_000)))
  }

  return { text, lastSeq }
}
```

把 `lastSeq` 和你的 session id 存在一起。它跨进程重启依然有效，所以一个在回合中途崩掉的 worker 能精确地从它停下的地方把这个回合接回来。

### 历史读取用的是同一个游标

`listEvents` 通过 REST 读同一份持久日志。

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

`limit` 在服务端默认是 **100** ，上限是 **500** ，而且这个调用只返回**一页** 。长 session 会被截断，不报错也不给标志位，所以要自己分页：

```ts
async function listAllEvents(zc: ZooclawClient, agentId: string, sessionId: string) {
  const all: SessionEvent[] = []
  let after = 0
  for (;;) {
    const page = await zc.listEvents(agentId, sessionId, { after, limit: 500 })
    all.push(...page)
    if (page.length < 500) break
    after = page[page.length - 1]!.seq
  }
  return all
}
```

`types` 在服务端过滤，且只能包含词表成员；出现未知值就是 `400 invalid_request`。

```ts
const replies = await zc.listEvents(agentId, sessionId, { types: ['agent.assistant'] })
```

从 REST 重放拼出来的文本，和从流拼出来的文本逐字节相同。

## 辅助函数

全部从 `@zooclaw-agents/sdk` 导出。每一个都是作用在 `SessionEvent` 上的纯函数，对类型不匹配的 event 返回一个无害的空值，所以你可以在一个循环里无条件地调用它们。

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

有两点和你可能的预期不一样：

- 预览帧**不带 `id:` 行** 。它们不属于持久游标，永远不会被重放。重连时它们会从下一个 `run.started` 重新推导出来。
- 帧的 body 是 `{ "type": "event_delta", "runId", "turn", "deltaText", "replace": true }`。**`replace: true` 的意思是整体快照替换，不是前缀追加。** 每一帧带的都是当前的完整文本，不是新增的那一段。

所以，你为前缀追加式 delta 流写的那种拼接，在这里会产生重复文本。要赋值，不要追加：

```js
// correct for this API
if (frame.type === 'event_delta') previewText = frame.deltaText

// wrong: duplicates on every frame
if (frame.type === 'event_delta') previewText += frame.deltaText
```

在没有配置预览后端的部署上请求 `deltas`，会在流打开之前返回 `501 not_configured`，所以你拿到的是一个正常的 JSON 错误，而不是一条一直沉默的流。

::: warning 尚未验证
上面的帧结构和快照替换语义是从服务端实现里读出来的。我们没有对着一个真实部署跑过 `?deltas=`，也不知道你正在用的那个部署有没有启用它。要拿最终文本，请用 `agent.assistant` 事件——它是持久的、可续传的，而且已实测。
:::
