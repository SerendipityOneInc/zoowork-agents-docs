---
lang: zh-CN
description: 发送 Session 事件、流式读取响应、判断 turn 结束状态并用持久 cursor 续传。
source: /en/build/events
source_hash: 0f222e45655766a7075265e39c2f79932251886374bbb9bd6165d43d759436a5
---

# Session 事件流

发送用户事件来开始或继续工作，再读取已保存事件或实时 SSE stream。事件有两个方向：`user.*` 和 `system.message` 是输入；Agent 和 run 事件报告响应、工具活动与执行进度。输入也会回显在持久日志中。

日志属于一个 Session。`seq` 递增且不复用，但允许间隔。使用 streamed event 或 list page 返回的 opaque cursor 续传，不要根据 seq 构造 cursor。还没有 Session 时，先阅读 [创建 Session](./sessions.md)。

使用[认证](../get-started/authentication.md)中配置的 `client`，以及已保存的 Agent 和 Session ID。Python 的 `await` 示例在 async 函数内运行。

## 发送事件 {#inbound-events}

你能 post 的事件类型恰好只有五种。其他任何类型都会被拒绝，返回 `400 invalid_event`，并在消息里点名这五种。

::: code-group

```ts [TypeScript]
const receipt = await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Summarize the last three findings.' },
])
console.log(receipt.events)
```

```python [Python]
receipts = await client.post_events(agent_id, session_id, [
    {"type": "user.message", "content": "Summarize the last three findings."},
])
print(receipts)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.message","content":"Summarize the last three findings."}]}'
```

:::

`postEvents` 返回带 `events` 数组的 object；Python `post_events` 直接返回这个数组。HTTP response 为 `202`，每提交一个 event 对应一条记录。`accepted` 是那个真正重要的字段。

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
| `actor` | 否 | 仅 API Session 接受 `{ ref: string }`。`ref` 为 1–200 个来自 `[A-Za-z0-9._:@+-]` 的 ASCII 字符。省略整个对象时归属 owner。 |

`createSession(agentId, { initial_events })` 只接受 `user.message`，别的都不接受，最多 50 条。

::: warning 记忆归属不等于访问控制
你的后端须把已认证的应用用户映射到稳定、不透明的 `actor.ref`，并校验 Session 归属。`metadata.user_id` 不会自动设置 actor。这个字段不隔离沙箱文件，也不删除原有对话上下文。IM Session 拒绝 `actor`；`actor.token`、未知 actor 字段和非法 ref 返回 HTTP 400。不能把调用方提供的 actor 当作身份证明。
:::

## 流式读取一个 turn {#streaming-a-turn}

`streamEvents` 是一个覆盖实时 session 流的异步生成器。

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

::: info 一个 Session stream 可以承载多个回合
`run.finished` 是*回合*的结束，不是*流*的结束。连接会保持打开等待下一个回合，只有当连接空闲得足够久时，服务端才会断开它。

如果你 `for await` 跑到底，或者 `await` 一个从生成器收集来的数组，程序会等到服务端关闭空闲连接。只需要当前回合时，在 `isRunFinished(ev)` 处 `break`。
:::

成功的 `run.finished` 也可能带有 `turnEndReason: "yielded"` 和 `outputType: "not_required"`：turn 已结束，但任务仍有后续工作。展示任务完成前，检查 [turn 结果和 yielded work](#turn-outcomes)。

下面假设前面发送的消息是**新 Session 的第一轮**，然后发送第二条消息，并复用第一轮的 cursor。如果是已有 Session，发送新消息前先取出上次处理完成的 cursor，第一次读取也要传入它。不带 cursor 会从开头重放，包括旧的 `run.finished`。

示例同一时间只发起一轮对话。自主执行或并发 run 需要额外关联 run，并检查 [turn 结果](#turn-outcomes)。

::: code-group

```ts [TypeScript]
import { assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

async function readOneTurn(startCursor?: string) {
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 120_000)
  let cursor = startCursor
  let text = ''
  try {
    for await (const ev of client.streamEvents(agentId, sessionId, {
      cursor: startCursor, signal: ctl.signal,
    })) {
      text += assistantText(ev)
      cursor = ev.cursor ?? cursor // Save after processing, alongside the Session ID.
      if (isRunFinished(ev)) {
        if (!cursor) throw new Error('Missing resume cursor')
        if (runOutcome(ev) !== 'succeeded') throw new Error(`run ${runOutcome(ev)}`)
        return { text, cursor }
      }
    }
    throw new Error('Read ended before run.finished; reconnect from the saved cursor')
  } finally {
    clearTimeout(timeout)
    ctl.abort()
  }
}

// First message in a new Session: replay starts at the beginning.
const first = await readOneTurn()
console.log(first.text)
// Persist first.cursor before sending a follow-up. One outstanding turn at a time.
const receipt = await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Explain the second finding in more detail.' },
])
if (receipt.events[0]?.accepted !== true) throw new Error('Message was not accepted')
const second = await readOneTurn(first.cursor)
console.log(second.text)
// Persist second.cursor for the next turn.
```

```python [Python]
import asyncio
from contextlib import aclosing
from zoowork import assistant_text, is_run_finished, run_outcome

async def read_one_turn(start_cursor=None):
    text = ""
    cursor = start_cursor
    async with aclosing(client.stream_events(
        agent_id, session_id, cursor=start_cursor,
    )) as stream:
        async for event in stream:
            text += assistant_text(event)
            cursor = event.cursor or cursor  # Save after processing with the Session ID.
            if is_run_finished(event):
                if not cursor:
                    raise RuntimeError("Missing resume cursor")
                if run_outcome(event) != "succeeded":
                    raise RuntimeError(f"run {run_outcome(event)}")
                return text, cursor
    raise RuntimeError("Read ended before run.finished; reconnect from the saved cursor")

# First message in a new Session; one outstanding turn at a time.
text, cursor = await asyncio.wait_for(read_one_turn(), timeout=120)
print(text)
# Persist cursor before sending a follow-up.
receipts = await client.post_events(agent_id, session_id, [
    {"type": "user.message", "content": "Explain the second finding in more detail."},
])
if not receipts or receipts[0].get("accepted") is not True:
    raise RuntimeError("Message was not accepted")
text, cursor = await asyncio.wait_for(read_one_turn(cursor), timeout=120)
print(text)
# Persist cursor for the next turn.
```

```bash [curl]
# Existing Session: EVENT_CURSOR is the last processed SSE id, saved by your app.
curl -N --max-time 120 --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream' \
  --data-urlencode "cursor=$EVENT_CURSOR"
```

:::

只有新 Session 的第一轮才省略 curl 的 `cursor` 参数。处理完 SSE event 后保存其 `id:`，供后续读取使用。

这些示例把 cursor 保存在内存中。服务端应在每个 event 处理完成后持久化处理状态和 cursor，避免超时或进程重启丢失 checkpoint。

机制上的几点：

- Abort stream 只关闭读取连接，不会发送 `user.interrupt`、停止服务端 run 或设置花费上限。需要停止工作时，post interrupt，再从新建或续传的 stream 观察 terminal event。
- TypeScript 中，abort `signal` 会正常结束生成器。Python 的 `asyncio.wait_for` 在 timeout 时抛出 `asyncio.TimeoutError`，`aclosing` 负责关闭 stream。curl 输出原始 frame，直到 timeout 或你停止读取；它不会在 `run.finished` 时退出。
- 生成器会丢弃任何 `seq` 小于等于它已产出过的最高值的 event，但这个去重状态只属于当前 generator。新 generator 不保留应用 checkpoint，必须传入已保存的 cursor。
- `streamEvents` 产出的一切都是持久的。
- 对于多回合 session，要么每个回合开一条新流并带上上次的 `cursor`，要么保持一条流开着并持续数 `run.finished` 事件。前者更容易推理。

### 已有 Session 没有保存 cursor {#existing-session-without-a-saved-cursor}

当前没有获取 Session 末尾 cursor 的 helper。REST 事件和 `postEvents` 回执不带 event cursor，最后一页的 `next_cursor` 为 null。不要根据 `seq` 拼接 opaque cursor，也不要用 deprecated `after` 通道替代。

如果已处理完某轮，并保存了验签通过的 `run.finished` webhook，其中存在的 `data.event_cursor` 可以作为该轮的 checkpoint。它不是查询当前末尾的接口；从它续读会跳过前面的输出，不能用来跳过尚未处理的结果。

应从第一次 stream 开始保存 cursor。如果已经丢失，需要重放持久事件流，结合应用记录的输入和 run 重建状态，不能把第一个重放的 `run.finished` 当成新答复。只有明确需要新对话时，才改为创建新 Session。不带 cursor 打开 stream 不表示从“现在”开始。

## Turn 结果 {#turn-outcomes}

一个回合恰好以一个 `run.finished` 结束。它的 `payload.status` 是以下之一：

| `status` | 含义 |
|---|---|
| `succeeded` | Turn 成功结束。检查 `turnEndReason` 是否为 yield。 |
| `failed` | 回合出错终止。通常前面会有一个带 `errorMessage` 的 `agent.error`。 |
| `aborted` | Turn 被取消，包括收到 `user.interrupt`。 |

::: info 分别判断 run 结果与工具结果
一个 `phase: 'end'` 且 `isError: true` 的 `agent.tool` 事件，后面照样跟着 `status: 'succeeded'` 的 `run.finished`。模型看到了这个工具错误，绕开了它，并给出了答案。那就是一个成功的回合。

使用 `runOutcome()` 判断回合结果，不要从单个工具事件推导。
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

### 回合 yield 时如何判断 {#when-a-turn-yields}

异步工作可能在启动它的回合结束后继续。Yielded turn 可以以 `status: "succeeded"`、`turnEndReason: "yielded"`、`outputType: "not_required"` 结束，而任务仍在等待。这表示一个回合结束，不表示任务已有最终答复。

```ts
if (isRunFinished(ev)) {
  if (ev.payload.turnEndReason === 'yielded') {
    // Persist ev.cursor and the task correlation fields, then keep observing.
  } else {
    // This run ended; inspect its outcome and output.
  }
}
```

| 可选 payload 字段 | 用法 |
|---|---|
| `taskRunId` | 关联同一个持续任务的各个 run。 |
| `parentRunId` | 标识 continuation lineage 中前一个 run。 |
| `waitingOn` | Yielded turn 正在等待的异步工作摘要。 |
| `waitingOnComplete` | 摘要是否完整。False 不能被解释成没有待完成工作。 |

把这些字段和 event cursor 一起保存。继续观察后续 run，检查它们的 terminal outcome 和 [run output](./session-operations.md#read-output-for-one-run)。Output endpoint 的 `output_complete` 只针对一个 run，不会把 yielded task 变成已完成。

这些观测字段不提供配置 subagent roster、advisor 或 session thread 的公共 API。相应边界见[暂不支持](../reference/not-supported.md)。定时结果的业务质量检查见 [Scheduled outcomes](./schedules.md#evaluate-a-scheduled-result)。

## 续传 {#resuming}

每一个持久帧都在 SSE 的 `id:` 行里带着自己的续传令牌，SDK 把它以 `ev.cursor` 交还给你。传 `{ cursor }`，服务端会先从那个事件之后重放日志，再继续实时推送。这是**服务端续传** ：没有客户端缓冲，没有去重环节，重连慢一点也不会有空洞。

::: code-group

```ts [TypeScript]
for await (const ev of client.streamEvents(agentId, sessionId, { cursor: savedCursor })) {
  savedCursor = ev.cursor ?? savedCursor
}
```

```python [Python]
from contextlib import aclosing

async with aclosing(client.stream_events(agent_id, session_id, cursor=saved_cursor)) as stream:
    async for event in stream:
        saved_cursor = event.cursor or saved_cursor
```

```bash [curl]
curl -N -G "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream' \
  --data-urlencode "cursor=$EVENT_CURSOR"
```

:::

上面的 `savedCursor`、`saved_cursor` 或 `EVENT_CURSOR` 使用已经保存的 token。
直接调公共 HTTP 端点时使用 `?cursor=`。公共网关不转发 `Last-Event-ID`，不能只靠浏览器 EventSource 自动发送的续传请求头。`{ after: seq }` 仍能续传废弃的 engine-only 通道——只留给旧存量游标用。

### 一个扛得住断线的重连循环

SDK 不会自动重连。断线后，从最后处理的 cursor 重新连接：

```ts
import {
  ZooworkError,
  assistantText,
  isRunFinished,
  runOutcome,
  type ZooworkClient,
} from '@zoowork-ai/sdk'

async function runTurnWithResume(
  client: ZooworkClient,
  agentId: string,
  sessionId: string,
  startCursor?: string,
  maxAttempts = 6,
): Promise<{ outcome?: 'succeeded' | 'failed' | 'aborted'; text: string; cursor?: string }> {
  let cursor = startCursor
  let text = ''

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      for await (const ev of client.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
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

`limit` 服务端默认 **100**，上限 **500**。`listEvents` / `list_events` 只返回一页事件；需要续传信息时使用下面的 page 方法：

::: code-group

```ts [TypeScript]
const page = await client.listEventsPage(agentId, sessionId, { limit: 100 })
```

```python [Python]
events, has_more, next_cursor = await client.list_events_page(
    agent_id, session_id, limit=100,
)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events?limit=100" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

读取全部页时，`listAllEvents()` / `list_all_events()` 会自动沿服务端 cursor 读取。HTTP 调用则在 `has_more` 为 true 时，继续传 `next_cursor`。

`types` 在服务端过滤，两个调用都支持，且只能包含词表成员；出现未知值就是 `400 invalid_request`。

```ts
const replies = await client.listAllEvents(agentId, sessionId, { types: ['agent.assistant'] })
```

从 REST 重放拼出来的文本，和从流拼出来的文本逐字节相同。

`listAllEvents` 在页边界去重，cursor 不前进时停止。`pageSize` 控制每次请求的 limit，默认值和上限都是 500。

## Interrupt 与工具响应 {#respond-to-tools}

### `user.interrupt`

中止当前正在跑的那个 run。

```json
{ "type": "user.interrupt" }
```

也可以携带事件级 `idempotency_key`。有 run 在跑时，它返回 `accepted: true`，该回合以 `run.finished` `status: 'aborted'` 结束。**没有** run 在跑时，它返回 `accepted: false`。那是一个空操作，不是错误，HTTP 状态码仍然是 `202`。

::: code-group

```ts [TypeScript]
const receipt = await client.postEvents(agentId, sessionId, [{ type: 'user.interrupt' }])
if (receipt.events[0]?.accepted === false) console.log('No run was in flight')
```

```python [Python]
receipts = await client.post_events(agent_id, session_id, [{"type": "user.interrupt"}])
if receipts and receipts[0].get("accepted") is False:
    print("No run was in flight")
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.interrupt"}]}'
```

:::

Transport failure 后重试 interrupt 时，复用同一个 `idempotency_key`。即使目标 run 已结束，也可以重放此前的 accepted receipt。不要只发送新 `user.message`，就认为它和显式 interrupt 有相同的取消行为。

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

Server 默认策略、逐工具覆盖和 REST approval 流程见[权限策略](./permissions.md)。

### `user.custom_tool_result`

返回应用执行的 custom tool 结果。用 `custom_tool_use_id` 或 `call_id` 标识调用，
`content` 放 1–16 个 text、JSON 或 base64 image block；可能重试时发送稳定的
`idempotency_key`。可选的 `is_error` 表示工具失败。同一操作也可通过
`resolveCustomToolCall()` 完成；完整的大小、图片、生命周期和错误规则见
[工具](./tools.md#应用执行的自定义工具)。

### `system.message`

注入一条带外说明，模型会在下一个回合读到它——它是你自己应用掌握的状态，不以用户发言的形式出现。

```json
{ "type": "system.message", "text": "Operator note: the user's plan is Enterprise." }
```

`text` 必须是非空字符串。这条说明进入下一个回合的 context，不是当前回合，所以要把它 post 在它应该影响的那条 `user.message` 之前。

```ts
await client.postEvents(agentId, sessionId, [
  { type: 'system.message', text: "Operator note: the user's plan is Enterprise." },
  { type: 'user.message', content: 'Which limits apply to me?' },
])
```

## 工具调用的 phase {#tool-call-phases}

一次工具调用会产生多个共享同一个 `toolCallId` 的 `agent.tool` 事件。

| `phase` | 含义 | 携带 |
|---|---|---|
| `start` | 已提出工具调用，策略或审批仍可能阻止执行。 | `args` |
| `end` | 调用已返回。 | `isError`、`resultPreview`、`executionStarted` |
| `blocked` | 调用在执行前结束，未执行；这是终态，具体原因见 `deniedReason`。 | `policyId`、`deniedReason` |

两条规则：

1. **按 `toolCallId` 配对，不要按前后相邻配对。** 当多个调用并发执行时，同一次调用的 `start` 和 `end` 之间会夹着属于其他调用的事件。
2. **`blocked` 是终态，不是等待审批。** 这次被拒绝的调用不会再出现 `end`。原因可能是策略规则拒绝、审批拒绝（`approval-denied`）、审批超时（`approval-timeout`）、审批取消（`approval-cancelled`）或被 interrupt 打断（`interrupted`）。读取 `ev.payload.deniedReason`，显示为未执行且已结束，不能显示为成功。等待人工决定时，事件是 `agent.approval`，`phase` 为 `requested`；`resolved` 表示审批等待结束，但不证明工具执行成功。

```ts
import { toolCall, isRunFinished, type ToolCall } from '@zoowork-ai/sdk'

// savedCursor is the application's checkpoint for this Session.
const pending = new Map<string, ToolCall>() // toolCallId -> latest state

for await (const ev of client.streamEvents(agentId, sessionId, { cursor: savedCursor })) {
  const tool = toolCall(ev)
  if (tool) {
    if (tool.phase === 'end' || tool.phase === 'blocked') pending.delete(tool.toolCallId)
    else pending.set(tool.toolCallId, tool) // start remains pending
  }
  if (isRunFinished(ev)) break
}

console.log(`${pending.size} tool calls never returned`)
```

`toolCall()` 会把未知 phase 映射成 `start`。需要读取原始值时，请直接使用 `ev.payload.phase`。

## `?deltas=` 预览通道 {#the-deltas-preview-lane}

流式端点接受 `?deltas=agent.message`，它会把增量预览帧交错混进持久帧之间。SDK 没有暴露它，`streamEvents` 也从不请求它，所以本节只和直接调 HTTP 的调用方有关。

有两点和你可能的预期不一样。预览帧**不带 `id:` 行** ：它们不属于持久游标，永远不会被重放。而预览帧上的 `replace: true` 意思是**整体快照替换，不是前缀追加** ——每一帧带的都是当前的完整文本，所以你为前缀追加式 delta 流写的那个 `+=` 会把已经显示过的内容全部重复一遍。要赋值，不要追加。

在没有配置预览后端的部署上请求 `deltas`，会在流打开之前返回 `501 not_configured`，所以你拿到的是一个正常的 JSON 错误，而不是一条一直沉默的流。

要拿最终文本，请使用 `agent.assistant` 事件。它是持久的，并且可以续传。

## 参考细节 {#reference-details}

下面的表格说明 SDK shape、wire format、事件词表和 helper。先使用前面的集成流程，再按需查询字段。

### 事件信封 {#the-event-envelope}

TypeScript SDK 会把两种 transport 的 event 归一成下面的结构。Python 使用
`event_type`、`run_id`、`created_at` 和 `processed_at` 等 snake_case 属性；
`seq`、`payload` 和 `cursor` 的名称相同：

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

没有顶层 `type` 字段，没有 `stop_reason`，也没有 `session.status_*` 事件。
TypeScript 用 `event.eventType` 读取事件类型，Python 用 `event.event_type`。

`payload` 是刻意松散的。读你需要的字段，忽略其余的；服务端会在一个版本内追加字段。

### 底层 wire format {#the-wire-underneath}

::: info SDK 会统一 wire format
统一通道上的两种 transport 都发送 snake_case 对象（`event_type`、`run_id`、`processed_at`、`created_at`），SSE 的 `id:` 行承载续传令牌。TypeScript 的 `normalizeEvent` 和 Python 的 `normalize_event` 会把这些对象转换为各自 SDK 的 `SessionEvent`，用于历史查询和流式读取。

直接调用 HTTP API 时，还应兼容旧 `after` SSE 通道中的 camelCase 字段。统一通道的事件类型字段为 `event_type`，旧通道为 `eventType`；两者都没有顶层 `type`。
:::

服务端每 20 秒写一行 `: ping` 注释作为 keepalive，所以任何低于这个值的 socket 读超时或代理空闲超时都会杀掉一条健康的流；而一个不跳过注释行的手写解析器会撞上 `JSON.parse('')` 并抛异常——不想自己写的话，`parseSSE` 是导出的。

`normalizeEvent` 是导出的，所以如果你有自己的 transport，可以复用它：

```ts
import { normalizeEvent } from '@zoowork-ai/sdk'

const ev = normalizeEvent(JSON.parse(frameData), sseIdLine) // the frame's SSE id value
```

### 事件词表 {#the-event-vocabulary}

以下是全部出站事件类型，也就是 `SESSION_EVENT_TYPES` 的完整内容（固定 20 项），外加[你自己的输入，回显](#你自己的输入-回显)那五种输入类型。历史查询上的 `types=` 过滤器接受这两组，其余任何值都以 `400 invalid_request` 拒绝。

#### `run.*` —— 回合记账

| 类型 | 何时触发 | `payload` |
|---|---|---|
| `run.started` | 一个回合开始，早于任何模型调用。 | `trigger`、`inboundMessageId`、`agentId` |
| `run.finished` | 回合结束。这是该回合的最后一个 event。 | `status`：`succeeded`、`failed`、`aborted` |

#### `agent.*` —— 回合内部发生了什么

| 类型 | 何时触发 | `payload` |
|---|---|---|
| `agent.lifecycle` | 给回合内的 agent 循环封头封尾。 | `phase`：`start`、`end`。定时触发的 agent 还可能发出 `phase: 'heartbeat-skipped'`，带 `reason`、`scheduleId`、`firedAt`。 |
| `agent.assistant` | 一个 assistant 消息片段被提交。 | `message`（`{ role, content[] }`）、`segment`（从 1 开始的步骤序号）、可选的 `artifacts`。用 `assistantText()`。 |
| `agent.thinking` | 刚提交的那个片段对应的推理文本。 | `text` |
| `agent.tool` | 一次工具调用切换了 phase。见[工具调用的 phase](#tool-call-phases)。 | `phase`、`toolCallId`、`toolName`；start 时有 `args`；end 时有 `isError`、`resultPreview`、`executionStarted`；blocked 时有 `policyId`、`deniedReason`。 |
| `agent.item` | 内部循环标记，不是对话内容。 | `kind`：`assistant_segment`（带 `phase`、`segment`）或 `llm_request`（抓取到的 provider 请求/响应）。渲染聊天界面时可以安全忽略。 |
| `agent.plan` | 词表里保留的类型。核心循环不会发出它。 | - |
| `agent.approval` | 某次工具调用需要审批，或该审批已经有了结果。 | `phase`：`requested`、`resolved`；`approvalId`、`toolCallId`、`toolName`、`arguments`，可选的 `stake`、`timeoutAt`；`resolved` 时还有 `resolution`，以及可选的 `resolvedBy`、`resolutionChannel`。 |
| `agent.custom_tool_use` | 应用执行的 custom tool 被请求或解决。 | `phase`：`requested`、`resolved`；`callId`；请求时有 `toolCallId`、`name`、`input`、`timeoutAt`；解决时有 `outcome`，以及可选的 `isError`、`resolvedBy`、`resolutionChannel`。用 `customToolUse()`。 |
| `agent.command_output` | 某个执行命令的工具产生了 stdout/stderr，按结果粒度给出。 | `toolCallId`、`toolName`，以及抓取到的输出字段。 |
| `agent.patch` | 一次 `apply_patch` 工具调用成功。 | `toolCallId`，以及这次 patch 的摘要。 |
| `agent.compaction` | 历史被压缩以塞进上下文窗口。 | `firstKeptEntryId`、`tokensBefore`、`reason` |
| `agent.error` | 回合内部发生了一个错误。 | `errorMessage`，有时还有 `kind`（例如 `mcp_connection_failed` 或 `mcp_authentication_failed`）、`server` 和可选 `reason`。保留未知 reason。它本身不是对这个回合的判决；判决读 `run.finished`。 |

#### 其他

| 类型 | 何时触发 | `payload` |
|---|---|---|
| `attachment.created` | 某个工具产出了一个文件或附件。 | `source`、`toolName`、`toolCallId`、`index`，以及存储引用相关的字段。 |
| `message.outbound` | Agent 主动发出了一条消息（message 工具、schedule announce 或 heartbeat），而不是在 session 内回复。 | `source`、`sourceRef`、`delivery`、`text`、`action`、`index`、`computerId`、`agentId`，可选的 `card`、`artifacts`。 |

#### 你自己的输入，回显

你自己发的输入会以 `user.message`、`user.interrupt`、`user.tool_confirmation`、`user.custom_tool_result`、`system.message` 出现在同一份日志里（导出为 `PUBLIC_INPUT_EVENT_TYPES`）。`user.message` 的 payload 是 `{ content: [...] }` —— 文本 block 加 `{ type: 'attachment', mime, name, size }` 存根 —— 它的 `processedAt` 在 agent 消费后从 `null` 变成时间戳。这五种的写入侧规则见[输入事件](#inbound-events)。

#### `chat.*` —— 不在持久日志上

`chat.delta`、`chat.final`、`chat.aborted` 和 `chat.error` 也是词表成员，但**不会写进持久事件日志** 。它们活在一条独立的、按 run 划分的预览通道上，唯一能看到其中内容的办法是[`?deltas=` 查询参数](#the-deltas-preview-lane)。不要拿它们构建回合逻辑；一个回合的边界是 `run.started` 和 `run.finished`。

### 辅助函数 {#helpers}

下面的名称从 `@zoowork-ai/sdk` 导出。Python 对应导出 `assistant_text`、`thinking_text`、`tool_call`、`is_run_finished`、`run_outcome` 和 `message_text`。每一个都是作用在 `SessionEvent` 上的纯函数，对类型不匹配的 event 返回一个无害的空值，所以你可以在一个循环里无条件地调用它们。

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

**`isRunFinished(e)`** —— 对 `run.finished` 返回 `true`。用它结束当前回合的读取；应用跟踪较长任务时，还需检查 [yielded turn](#when-a-turn-yields)。

```ts
if (isRunFinished(ev)) break
```

**`runOutcome(e)`** —— 对 `run.finished` 事件返回 `'succeeded' | 'failed' | 'aborted'`，其他一律返回 `undefined`（状态无法识别时也是 `undefined`）。

```ts
const outcome = runOutcome(ev) // undefined unless ev is run.finished
```

**`messageText(message)`** —— 返回一个 `{ role, content }` 消息对象的文本。用在 `getSession(agentId, sessionId, { history: true })` 返回的记录行上——那里消息挂在 `entry.message`，而不是在事件 payload 里面。block 数组和纯字符串两种形式它都能处理。

```ts
const s = await client.getSession(agentId, sessionId, { history: true, limit: 50 })
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
