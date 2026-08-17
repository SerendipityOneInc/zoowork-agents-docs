---
title: 核心概念
source: /en/get-started/concepts
source_hash: e4649c5f7cc20226d63a73926878363cc1062fdaeea56658d555422b8a7d2569
---

# 核心概念

ZooClaw Managed Agents 有三个原语。你构建的一切都建立在它们之上。

| 原语 | 是什么 | 如何寻址 |
|---|---|---|
| **Agent** | 一份持久、带版本的配置，外加一套生命周期。 | `agent_id` |
| **Session** | 属于某一个 agent 的一段持久会话。 | `agent_id` + `session_id` |
| **Event** | session 里发生过的一件事，持久存储、带序号。 | session 内的 `seq` |

没有独立的 Run 资源。run 存在于 session 内部，你通过事件（`run.started`、`run.finished`）观察它，但你永远不会创建、获取或列出一个 run。

沙箱模板是另一个独立的可选资源，叫 Environment。如果你需要自定义软件包或网络白名单，就在 agent 上固定一个；运行时你不和它打交道。见 [Environments](/zh/build/environments)。

本页所有示例都用 TypeScript SDK：

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...
```

key 从哪来见[鉴权](/zh/get-started/authentication)。

## Agent

agent 是一个配置对象，它比任何一段对话活得更久。你创建一次，然后在多个 session、多个用户、多天之间反复复用。

### 它持有什么

你提交的配置就是 **declared** 配置。它包含：

- `name` 和 `model`（`{ primary: 'litellm/...' }`）
- `persona.docs[]`——模型每个回合都会读的指令文档（`AGENTS.md`、`SOUL.md`、`IDENTITY.md` 等）
- `tool_policy`——agent 可以使用哪些内置工具；`{}` 表示完整清单
- `labels`——自由格式的字符串键值对，供你自己记账
- `skills`（仅创建时）、`mcp` 声明、`heartbeat`、`sandbox.scope`、`environment_id` / `environment_version`

它还持有一个 `status` 块，那是服务端维护的状态，你只读。

同一个 agent 有两种读取形态，而且这两种形态的结构不一样：

```ts
const created = await zc.createAgent({
  resource: { name: 'research-agent', model: { primary: 'litellm/claude-sonnet-5' } },
})
created.agent_id       // 'agt_...'
created.config_version // present: the create receipt is flat

const agent = await zc.getAgent(created.agent_id)
agent.declared               // { name, model, persona, labels, ... }
agent.status?.config_version // the version lives here on the read path
agent.config_version         // undefined - there is no top-level version on GET
agent.name                   // undefined - the name is under `declared`
```

`POST /agents` 返回一份扁平的创建回执。`GET` 和 `PUT` 返回的是一份投影：配置在 `declared` 下，版本在 `status.config_version` 下。如果你想要一个两边都能用的表达式，就按 `agent.status?.config_version ?? agent.config_version` 读版本号。

创建请求体里不用带 ownership 锚点——公开网关会用你 API key 的锚点自动填上。

### 生命周期

```text
createAgent() --> [stopped] --startAgent()--> [running] --stopAgent()--> [stopped]
                                                  |
                                            deleteAgent()
```

新创建的 agent 处于 **stopped** 。创建调用本身不会启动它。

```ts
const { warnings } = await zc.startAgent(agentId)
// warnings is informational, e.g. channel_routes_reload_failed on an API-only agent
```

`startAgent()` 很快——实测在一秒以内。`stopAgent()` 的形态相同。对一个没有聊天渠道的 agent，两者都可能返回 `channel_routes_reload_failed` 警告；那是正常噪声，不是失败。

::: danger 你必须调用 startAgent()
在 `startAgent()` 返回之前，`createSession()` 会失败并返回 `409 agent_not_running`。创建与启动是刻意分开的两步，而漏掉启动是第一次调用就卡住的最常见原因。
:::

::: warning 尚未验证
`DELETE` 在文档里是软删除：它不会停掉 agent、不会取消进行中的工作、不会删除调度，也不会释放它的沙箱。我们实测过 `deleteAgent()` 本身，但没有实测它留下了什么。请在 `deleteAgent()` 之前先调 `stopAgent()`。
:::

### `desired_state` 与 `actual_state`

`status` 块里有两个状态字段。它们的含义完全不同，而且只有其中一个决定 API 放不放行。

| 字段 | 取值 | 它告诉你什么 |
|---|---|---|
| `desired_state` | `running` \| `stopped` \| `deleted` | API 会不会接受 session 相关的调用。**你要等的是这一个。** |
| `actual_state` | `activating` \| `active` \| `degraded` \| `error` \| `stopped` \| `deleting` | 聊天渠道的连通性。与 API 是否就绪无关。 |

`actual_state` 报告的是 agent 的聊天渠道路由有没有连上。只通过 API 驱动的 agent 没有任何渠道（`status.channels.expected` 是 `0`），所以它永远停在 `activating`，永远到不了 `active`。另外注意，`running` 根本不在 `actual_state` 的枚举里——所以下面这个看起来很自然的循环永远不会返回：

```ts
// WRONG - hangs forever on an API-only agent
while ((await zc.getAgent(agentId)).status?.actual_state !== 'running') {
  await new Promise((r) => setTimeout(r, 1000))
}
```

改成轮询 `desired_state`。它会在远不到一秒内翻成 `running`，而且这个循环 SDK 已经写好了：

```ts
await zc.waitUntilRunning(agentId)
```

`waitUntilRunning()` 按 30 秒的总预算、每 500 毫秒轮询一次 `desired_state`，并且用剩余预算给每个请求设上限，所以网关中途卡住时这次等待会按时结束，而不是把 promise 挂死。如果 agent 始终没到 `running`，它抛出 `status === 408`、`type === 'timeout'` 的 `ZooclawError`。

在一个 `actual_state` 始终没离开过 `activating` 的 agent 上，一个完整的回合照样正常跑完。`desired_state` 是唯一有意义的就绪信号。

### `config_version`

`config_version` 是一个单调递增的整数，描述当前生效的是哪一份渲染后的配置快照。已经在跑的回合保留它自己的快照；下一个回合才会用上新的。

它不是一张回执。

- 每一次成功的 `PUT` 都会把它 bump 一次，**包括请求体与当前配置逐字节相同的 PUT** 。连续两次空写会产生两个新版本。
- 创建时的凭证注入也会 bump 它。创建回执写着 `config_version: 1`、紧接着的 `GET` 报 `3`，是常态。
- 没有乐观并发控制参数。你无法提交一个期望版本号，让写入在版本漂移时被拒绝。

所以不要用 `config_version` 给重试去重，也不要用它判断「我那次写入到底成没成」。写入超时之后，改用 `getAgent()` 并比对 `declared`。

```ts
await zc.updateAgent(agentId, { labels: { env: 'staging' } })
// -> config_version 4
await zc.updateAgent(agentId, { labels: { env: 'staging' } })
// -> config_version 5, same content
```

`updateAgent()` 按段做一层深度的合并：你省略的段会被保留。上面那次 PUT 不会动 `name`、`model`、`persona` 以及其他任何东西。例外是 `tool_policy`，它每次写入都被整体替换；`{}` 会把它清回完整的工具清单。

**反直觉的地方：** agent 创建出来是停止的，而那个看起来像就绪信号的状态字段（`actual_state`）并不是就绪信号。

## Session

session 是一段持久的会话，且恰好只属于一个 agent。路径是嵌套的，SDK 的签名也是：

```ts
const session = await zc.createSession(agentId, {
  metadata: { source: 'my-app' },
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
session.session_id  // 'ses_...'
session.session_key // 'api:...'
```

`POST /agents/{agent_id}/sessions`。每一个 session 调用的第一个参数都是 agent id：`createSession(agentId, input)`、`postEvents(agentId, sessionId, events)`、`listEvents(agentId, sessionId, opts)`、`streamEvents(agentId, sessionId, opts)`。

::: danger 不支持
不存在顶层的 `/sessions` 集合，也不存在把 agent 放在请求体里的 session 资源。照那种形状写的代码在这里编译不过。请改写调用点，显式传 `agentId`。
:::

`createSession` 的第三个参数接受一个 `Idempotency-Key`；用同一个 key 重试会收敛到第一个 session，而不是再建一个。

```ts
await zc.createSession(agentId, { initial_events: [...] }, 'my-stable-key')
```

### 它持有什么

session 在服务端持有对话历史。你不用自己拼消息数组，不用管理上下文窗口，也不用重发之前的回合。把新的用户消息 post 上去，其余的 agent 已经有了。

两个读取面：

```ts
// The event log - what happened, in order.
const events = await zc.listEvents(agentId, session.session_id)

// The at-rest transcript - the conversation itself.
const s = await zc.getSession(agentId, session.session_id, { history: true, limit: 100 })
s.history?.forEach((row) => {
  // row.entry_type === 'message' -> row.entry.message is { role, content }
})
```

想要事件流就用 `listEvents`。想把一个你错过了事件的回答捞回来，就用 `getSession({ history: true })`。

### 生命周期

session 被创建出来，只要你一直往里 post 就一直累积回合，之后仍然可读。它不会在一个回合结束时过期，SSE 流也不会在回合结束时关闭。

::: danger 不支持
`ZooclawClient` 没有 `patchSession`。对一个 session 发 `PATCH`，经过网关返回的是 `405`，所以 session 的 `metadata` 只能在 `createSession` 时写一次——之后要拿来检索的东西，创建时就放进去。见[不支持的能力](/zh/reference/not-supported)。
:::

按 agent 的列举和生命周期操作确实有方法——`listSessions(agentId)`、`archiveSession(agentId, sessionId)`、`deleteSession(agentId, sessionId)`。但仍然没有顶层的 session 集合，所以要跨 agent 找回一段会话，还是得自己记录 `session_id`；这三个各自被驱动到什么程度，记在[能力矩阵](/zh/reference/capabilities)里。

**反直觉的地方：** 你通过 API 创建的 session，和同一个 agent 在 ZooClaw App 里进行的对话，是两段互不相干的对话。API session 带一个以 `api:` 开头的 `session_key`；App 里的对话跑在另一个渠道上。它们不共享历史，其中一边的模型看不到另一边说了什么。在 App 里给 agent 的 persona 打样是有用的；指望 API session 记得那段聊天则不是。

## Event

event 是 session 内发生的一切的最小单位。这份日志只追加，并按 `seq` 持久排序——`seq` 是每个 session 内单调递增的整数。流能续传全靠 `seq`：每一个 SSE 帧都在 `id:` 行里带着它，`?after=<seq>` 让服务端从那里重放。

尽量少直接读 `payload`。SDK 为重要的那几种结构提供了带类型的读取函数，遇到类型不匹配的事件它们返回空值：

```ts
import {
  assistantText, // text of an agent.assistant event
  thinkingText,  // text of an agent.thinking event
  toolCall,      // { phase, toolName, toolCallId, args, isError } of an agent.tool event
  isRunFinished, // true for run.finished
  runOutcome,    // 'succeeded' | 'failed' | 'aborted' for run.finished
} from '@zooclaw-agents/sdk'
```

### 你写入的事件

四种入站类型。其余一律被拒绝。

| 类型 | 请求体 | 作用 |
|---|---|---|
| `user.message` | `{ type, content: string }` | 开启一个回合。 |
| `user.interrupt` | `{ type }` | 中止正在进行的 run。 |
| `system.message` | `{ type, text: string }` | 带外说明；模型在下一个回合读到它。 |
| `user.tool_confirmation` | `{ type, approval_id, decision }` | 处理一个待定的工具审批。 |

```ts
const res = await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'What changed in the report?' },
])
res.events[0]?.accepted // true
```

`postEvents` 返回 `202`，每一个提交的事件对应一个 `{ id, type, accepted }`。

对一个正在跑的 run 发 `user.interrupt` 会被接受（`accepted: true`），该 run 以带 `status: 'aborted'` 的 `run.finished` 结束。没有正在进行的 run 时它返回 `accepted: false`——这是空操作，不是错误，也不需要重试。

`system.message` 是一条真正通往模型上下文的带外通道。这样写进去的说明，模型在下一个回合就能看到——它是你自己应用掌握的状态，不以用户发言的形式注入。

::: warning 尚未验证
`user.tool_confirmation` 接受 `{ approval_id: string, decision: 'allow-once' | 'allow-always' | 'deny' }`，其他任何结构都会被 `400` 拒绝。我们没有端到端实测过它，因为那要求先造出一个真实的待定审批。目前请把「人在环中」的审批当作不可用：一个卡在审批上的 agent 会把这个回合耗到超时。
:::

`user.message` 只实测过 `content` 为纯字符串的形式。富内容块未经测试。

### 你读取的事件

出站的类型表更大。它以 `SESSION_EVENT_TYPES` 导出。

| 类型 | 含义 |
|---|---|
| `run.started` | 一个回合开始了。 |
| `run.finished` | 一个回合结束了。`payload.status` 是 `succeeded` \| `failed` \| `aborted`。 |
| `agent.lifecycle` | run 内部的阶段标记。 |
| `agent.item` | 回合里新增了一个 item。 |
| `agent.thinking` | 推理文本；用 `thinkingText(e)` 读。 |
| `agent.assistant` | assistant 消息；用 `assistantText(e)` 读。 |
| `agent.tool` | 一次工具调用。用 `toolCall(e)` 读。 |
| `agent.approval` | 一次工具调用正在等待审批。 |
| `agent.error` | run 内部的一个错误。 |
| `chat.delta` | 非持久通道上的预览帧。SDK 的流会跳过它们。 |
| `chat.final`、`chat.aborted`、`chat.error` | 聊天渠道的终止帧。 |
| `agent.plan`、`agent.command_output`、`agent.patch`、`agent.compaction` | 循环发出的更细节的信息。 |
| `attachment.created` | 产生了一个附件。 |
| `message.outbound` | 一条消息被投递到了聊天渠道。 |

在普通的 API 回合里，我们观察到过 `run.*`、`agent.lifecycle`、`agent.item`、`agent.thinking`、`agent.assistant` 和 `agent.tool`。其余类型在这份类型表里，也会原样穿过 SDK，但没有在我们的运行中出现过。未知类型永远不会抛错——API 可能在一个版本内新增类型，所以用 `eventType` 做 switch 时要带 default 分支。

assistant 文本在 `payload.message.content[]` 里，装在 `type: 'text'` 的块中。请用 `assistantText(e)`，不要自己去读 payload。

`agent.tool` 有三个 phase，不是两个：

| Phase | 含义 |
|---|---|
| `start` | 调用开始了；`args` 已填充。 |
| `end` | 调用返回了；`isError` 和 `resultPreview` 已填充。 |
| `blocked` | 调用正在等待审批，**没有** 执行。 |

一次工具调用产生一个 `start` 和一个 `end`，两者共享同一个 `toolCallId`。调用并发时它们在流里并不相邻，所以要按 id 配对，不要按位置配对。

::: tip 工具失败不会让 run 失败
一个带 `isError: true` 的 `agent.tool` 事件之后，照样跟着一个 `succeeded` 的 `run.finished`。永远不要从「没有工具错误」推断回合成功——读 `runOutcome(e)`。
:::

### 两种线格式

同一个事件，取决于你怎么读它，拼写不一样：

| | REST `GET /events` | SSE `GET /events/stream` |
|---|---|---|
| 类型 | `event_type` | `eventType` |
| run | `run_id` | `runId` |
| 时间 | `created_at` | `createdAt` |

两者都没有顶层的 `type` 字段。SDK 把两者归一成同一个 `SessionEvent`（`{ seq, eventType, payload, runId?, turn?, createdAt? }`），所以你只对一个字段做 switch。如果你直接调 HTTP API，就得自己处理两套拼写；SDK 为此导出了 `normalizeEvent`。

::: warning listEvents 只返回一页
服务端默认 100 条事件，最大 500 条。`listEvents` 只返回一页——长会话会静默截断，不报任何错。请用 `after` 游标翻页：

```ts
let after = 0
const all = []
for (;;) {
  const page = await zc.listEvents(agentId, sessionId, { after, limit: 500 })
  if (page.length === 0) break
  all.push(...page)
  after = page[page.length - 1]!.seq
}
```
:::

**反直觉的地方：** 这份日志可以续传。带上你见到的最后一个 `seq` 重连，服务端就从那里重放，所以你永远不需要手工去重。

## 一个回合是怎么跑的

一个回合就是一条用户消息，加上 agent 为此做的一切。你通过写入一个事件来开启它；你读到 `run.finished` 就知道它结束了。

```text
you                                    ZooClaw
 |
 |-- postEvents(user.message) --------> 202 { accepted: true }
 |                                        |
 |                                        run.started
 |                                        agent.lifecycle
 |                                        agent.item
 |<-- streamEvents(...) ----------------- agent.thinking
 |                                        agent.assistant
 |                                        agent.tool   phase: start   \  repeats
 |                                        agent.tool   phase: end     /  per call
 |                                        agent.lifecycle
 |<-- run.finished { status: succeeded } -+
 |
 |  ... the stream stays open. Post the next user.message on the same session.
```

不带工具调用的回合大约产生七个事件；用工具的回合每次调用多出两个 `agent.tool` 事件，忙一点的能跑到十七个左右。不要把顺序或数量写死——`run.finished` 是唯一可靠的终止标志。

端到端跑完一个回合：

```ts
import { assistantText, isRunFinished, runOutcome } from '@zooclaw-agents/sdk'

const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Summarize today in one sentence.' }],
})

const ctl = new AbortController()
setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: string | undefined
let lastSeq = 0

for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
  lastSeq = ev.seq
  text += assistantText(ev)
  if (isRunFinished(ev)) {
    outcome = runOutcome(ev) // 'succeeded' | 'failed' | 'aborted'
    break
  }
}
ctl.abort()

console.log(outcome, text)
```

下一个回合发到同一个 session，流从你停下的地方接着走：

```ts
await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'Now say it in French.' },
])

for await (const ev of zc.streamEvents(agentId, session.session_id, { after: lastSeq })) {
  if (isRunFinished(ev)) break
}
```

传 `after: lastSeq` 也是断线之后续传的做法：带上你处理过的最后一个 `seq` 重连，服务端从那里继续。SDK 不会替你重连。

流的作用域是 session，不是回合。`run.finished` 到达时它不会关闭——需要你自己跳出循环——服务端会在 session 空闲之后关掉它。

## 接下来读什么

- [快速开始](/zh/get-started/quickstart)——从拿到 key 到收到第一条回复。
- [Agents](/zh/build/agents)——完整的配置面。
- [Sessions](/zh/build/sessions)——session 的选项与读取。
- [事件与流式](/zh/build/events)——payload 结构、续传与过滤。
- [错误处理](/zh/reference/errors)——按 `ZooclawError.type` 匹配。
- [不支持的能力](/zh/reference/not-supported)——在围绕某个能力做设计之前，先来这里查一下。
