---
title: 快速开始
source: /en/get-started/quickstart
source_hash: 62d698839a5deb480714c88f1d84ea3d3a7bb12ca26a226c7ff61b39df10e001
---

# 快速开始

建一个 agent、启动它、开一个 session、把回复流式读回来。整个流程大约五分钟。

::: tip 先把你的编码助手教会
```bash
npx skills add SerendipityOneInc/zoowork-sdk-skills
```
装完之后，你的助手在写第一行代码之前就已经懂这套 API——哪些调用存在、哪些不存在，以及那几个「看着对、运行时才炸」的地方。它会装进你有的各种助手：Claude Code、Codex、Cursor 等 70 多个，每个都装进它自己真正会读的目录。需要 Node 22.20 或更高。

更想从一个已经能跑的东西开始？三个模板在 [zoowork-quickstarts](https://github.com/SerendipityOneInc/zoowork-quickstarts)：`chat/` 跟你已有的 agent 对话，`skill-lab/` 从零建一个 agent 并给它上传 skill，`app-kit/` 是带鉴权和持久化的生产参考。
:::

## 前置条件

- **Node 20 或更高。** `@zoowork-ai/sdk` 是一个 ES module，没有任何运行时依赖，用的是平台自带的 `fetch`。
- **一个 API key** ，形如 `zct_...`。由组织管理员为你的组织签发并交给你。没有自助注册页面。

这个 key 只能放在服务端。它认证的是你的整个组织，不是某一个终端用户。

```bash
export ZOOWORK_API_KEY='zct_...'
```

下面每一步都同时给出 TypeScript 和 `curl` 两种写法。`curl` 这一栏的存在是为了让你用任何语言都能跟着走：它发出的 HTTP 和 SDK 发的是同一份。它需要把端点显式写出来，所以跑这些示例还要额外 export：

```bash
export ZOOWORK_BASE_URL='https://clawapi.ecap.gsmo.ai/service/v1'
```

选一次栏目，本页所有代码块都会跟着切。

## 安装

::: code-group

```bash [pnpm]
pnpm add @zoowork-ai/sdk
```

```bash [npm]
npm install @zoowork-ai/sdk
```

```bash [yarn]
yarn add @zoowork-ai/sdk
```

:::

要直接跑本页的 TypeScript：

```bash
pnpm add -D typescript tsx @types/node
```

SDK 只发 ESM。在 `package.json` 里设 `"type": "module"`，这样 `import` 才能用，顶层 `await` 也才可用。

## 创建客户端

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

只要 export 了 `ZOOWORK_API_KEY`，这个参数可以整个省掉——`createZooworkClient()` 会自己读。剩下的选项只有两个：`baseUrl`（默认指向公开网关，也可由 `ZOOWORK_BASE_URL` 指定），以及一个注入的 `fetch`，供边缘运行时和测试使用。

key 缺失会在构造时就抛错，而不是等你第一次调用时才以 401 的形式冒出来。

验证 key 是否可用最便宜的方式是 `listModels()`——它不需要 agent，也不需要 session：

::: code-group

```ts [TypeScript]
const models = await zc.listModels()
console.log(models.length, models[0]?.model)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

```json
[
  { "model": "litellm/claude-sonnet-5", "display_name": "Claude Sonnet 5", "family": "anthropic", "api": "anthropic-messages" }
]
```

无效的 key 返回 `401`。SDK 抛出的 `ZooworkError` 带 `.status` 和 `.type`——绝不要匹配报错文本。在你清楚是哪个家族回的错时匹配 `.type`；`401` 请按 `.status` 分支，因为网关和核心 API 对这个 type 的拼法不一样。

## 1. 创建 agent

agent 是一个持久化、带版本的配置对象。给出 `name` 和 `model.primary` 就够了。

::: code-group

```ts [TypeScript]
const created = await zc.createAgent({
  resource: {
    name: 'quickstart-agent',
    model: { primary: models[0]?.model ?? 'litellm/claude-sonnet-5' },
  },
})

const agentId = created.agent_id
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": {
      "name": "quickstart-agent",
      "model": { "primary": "litellm/claude-sonnet-5" }
    }
  }'
```

:::

响应是一个扁平的**创建回执** ：

```json
{
  "agent_id": "agt_example",
  "computer_id": "cmp_example",
  "config_version": 1,
  "resolved_skills": []
}
```

关于这个结构，有两点要知道：

- 回执和读取返回的不是同一个结构。`getAgent()` 返回的是一个投影：配置在 `declared` 下面，版本号在 `status.config_version`——读取路径上没有顶层的 `config_version` 和 `name`。要这样读：`agent.status?.config_version ?? agent.config_version`。
- 回执里的 `config_version`，等你读到它的时候就已经过期了：创建之后的每一次写入都会 bump 一次版本号，所以一秒后再 `getAgent()` 通常报的是 `3`。不要把版本号当幂等回执用。

如果你想要一个可以安全重试的创建，把幂等 key 作为第二个参数传进去：

```ts
const agent = await zc.createAgent(
  {
    resource: { name: 'quickstart-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  },
  'quickstart-run-01', // 你的幂等 key
)
```

## 2. 启动 agent

::: warning 别跳过这一步
新建出来的 agent 是 `status.desired_state === 'stopped'`。所有 session 调用都要求它是 `running`。如果你直接去调 `createSession()`，SDK 会抛出 `ZooworkError`，其中 `status === 409`、`type === 'agent_not_running'`：

```ts
import { ZooworkError } from '@zoowork-ai/sdk'

try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooworkError && e.type === 'agent_not_running') {
    // You forgot startAgent(). Match on e.type, not on e.message.
  }
}
```

创建与启动是刻意分开的两步；假设「建完就能用」的代码会在这里失败。
:::

::: code-group

```ts [TypeScript]
const { warnings } = await zc.startAgent(agentId)
console.log(warnings)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

```json
{ "warnings": ["channel_routes_reload_failed: routes reload returned 404"] }
```

这条警告是提示性的，纯 API 的 agent 每次启动和停止都会报一次。不要在它上面重试——请改看 `desired_state`。

### 等待就绪

::: danger 轮询 `desired_state`，绝不要轮询 `actual_state`
`actual_state` 反映的是**聊天渠道的连通性** ，不是 API 的就绪状态。纯 API 的 agent 没有任何渠道，所以它永远停在 `activating`，永远到不了 `active`。`running` 甚至不在 `actual_state` 的枚举里（`activating | active | degraded | error | stopped | deleting`）。**等 `actual_state` 的循环永远不会返回。**

请等 `status.desired_state === 'running'`。它翻转所需的时间远不到一秒。
:::

这个循环 SDK 已经写好了，你不用自己写：

```ts
const agent = await zc.waitUntilRunning(agentId)
```

它按 30 秒的总预算、每 500 毫秒轮询一次 `status.desired_state`，返回的就是 `getAgent()` 会给你的那份投影。如果 agent 始终没到 `running`，它抛出 `status === 408`、`type === 'timeout'` 的 `ZooworkError`。

启动之后立刻 `getAgent()` 读一次，长这样（省略了其他字段）：

```json
{
  "agent_id": "agt_example",
  "declared": { "name": "quickstart-agent", "model": { "primary": "litellm/claude-sonnet-5" } },
  "status": {
    "desired_state": "running",
    "actual_state": "activating",
    "config_version": 3,
    "channels": { "expected": 0, "connected": 0 }
  }
}
```

对纯 API 的 agent 来说，`actual_state: "activating"` 配上 `channels.expected: 0` 就是它的稳态。在这个状态下 session 完全正常。

## 3. 创建 session 并带上首条消息

session 挂在 agent 下面：`createSession(agentId, input)`。没有顶层的 sessions 资源，agent id 也不放在 body 里。

::: code-group

```ts [TypeScript]
const session = await zc.createSession(agentId, {
  metadata: { source: 'quickstart' },
  initial_events: [{ type: 'user.message', content: 'In one sentence, what can you do?' }],
})

const sessionId = session.session_id
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": { "source": "quickstart" },
    "initial_events": [
      { "type": "user.message", "content": "In one sentence, what can you do?" }
    ]
  }'
```

:::

```json
{
  "session_id": "ses_example",
  "session_key": "api:ses_example",
  "status": null
}
```

`status` 恒为 `null`——请改读 `run_status`。

`initial_events` 会在这次创建调用里就把第一个回合起起来，所以你不需要再单独发一次。用 `user.message`，content 传字符串。同一个 session 里后续的回合，调 `postEvents(agentId, sessionId, events)`。

`session_key` 上的 `api:` 前缀标明这是一个 API session。通过聊天渠道创建的 session 带的是另一种前缀，属于另一段对话，记忆也是分开的。

这里同样可以传一个幂等 key：

```ts
const session = await zc.createSession(agentId, input, 'quickstart-session-01')
```

## 4. 流式读取，直到本回合结束

`streamEvents()` 是一个 async generator，遍历这个 session 的持久事件日志。

::: code-group

```ts [TypeScript]
import { assistantText, isRunFinished, runOutcome, toolCall } from '@zoowork-ai/sdk'

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined

try {
  for await (const ev of zc.streamEvents(agentId, sessionId, { signal: ctl.signal })) {
    const call = toolCall(ev)
    if (call?.phase === 'start') console.log(`\n[tool] ${call.toolName}`)

    const chunk = assistantText(ev)
    if (chunk) {
      text += chunk
      process.stdout.write(chunk)
    }

    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
} finally {
  clearTimeout(budget)
  ctl.abort()
}
```

```bash [curl]
# -N disables buffering so frames arrive as they are produced.
# Resume after a drop by appending ?after=<last seq you saw>.
curl -N "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H "Accept: text/event-stream"
```

:::

每一次迭代吐出一个归一化后的 `SessionEvent`：

```json
{
  "seq": 5,
  "eventType": "agent.assistant",
  "runId": "run_example",
  "turn": 1,
  "payload": {
    "message": { "role": "assistant", "content": [{ "type": "text", "text": "I can research topics and write code." }] }
  },
  "createdAt": "2026-08-06T08:00:00.000Z"
}
```

一个回合产生的事件大致是这样一条弧线：`run.started` -> `agent.lifecycle` -> `agent.item` -> `agent.thinking` -> `agent.assistant` -> `agent.tool`（start/end 成对）-> `agent.lifecycle` -> `run.finished`。

有四件事最容易把人绊住：

- **`run.finished` 结束的是回合，不是流。** `isRunFinished(ev)` 为真时请自己跳出循环，否则你会一直阻塞到服务端的空闲超时。
- **`runOutcome(ev)` 的取值是 `succeeded | failed | aborted`。** 即使个别工具调用出了错，这次 run 依然可能以 `succeeded` 结束——`toolCall(ev).isError === true` 不会让 run 失败。不要用「没有工具报错」来推断成功。
- **对每一个不是 `agent.assistant` 的事件，`assistantText(ev)` 都返回 `''`** ，所以在整个循环里一路拼接是安全的，拼出来就是完整回复。
- **用 `after` 续传。** 每一帧都带一个持久的 `seq`。连接断了，就用 `{ after: lastSeq }` 重新起这个 generator，服务端从那里开始重放。不丢，也不重。

```ts
for await (const ev of zc.streamEvents(agentId, sessionId, { after: lastSeq })) { /* ... */ }
```

如果你更想用轮询，`listEvents(agentId, sessionId)` 走 REST 读的是同一批事件。它只返回一页——服务端默认 100 条，最多 500 条——而且整页会被静默截断：没有 `has_more`，没有总数，也没有游标。用 `listAllEvents(agentId, sessionId)` 一次把所有页走完，不要自己写这个循环。

## 5. 清理

::: code-group

```ts [TypeScript]
await zc.stopAgent(agentId)
await zc.deleteAgent(agentId)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"

curl -X DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

先停。`deleteAgent()` 只是一次软删除：它不会停掉 agent，不会取消调度，也不会释放沙箱，所以删掉但没停的 agent 会继续跑着。详见 [Agents](../build/agents.md)。

`stopAgent()` 返回和启动时一样的 `channel_routes_reload_failed` 提示性警告。停掉之后，对这个 agent 调 `createSession()` 会重新返回 `409 agent_not_running`。

## 完整程序

存成 `quickstart.ts`，然后运行 `ZOOWORK_API_KEY='zct_...' pnpm exec tsx quickstart.ts`。

```ts
import {
  createZooworkClient,
  ZooworkError,
  assistantText,
  isRunFinished,
  runOutcome,
  toolCall,
} from '@zoowork-ai/sdk'

const apiKey = process.env.ZOOWORK_API_KEY
if (!apiKey) throw new Error('set ZOOWORK_API_KEY')

const zc = createZooworkClient({ apiKey })

// 0. Confirm the key works and pick a model.
const models = await zc.listModels()
const model = models[0]?.model ?? 'litellm/claude-sonnet-5'
console.log(`${models.length} models available, using ${model}`)

// 1. Create the agent.
const created = await zc.createAgent({
  resource: {
    name: `quickstart-${Date.now()}`,
    model: { primary: model },
  },
})
const agentId = created.agent_id
console.log(`created agent ${agentId}`)

try {
  // 2. Start it. Without this, createSession returns 409 agent_not_running.
  const { warnings } = await zc.startAgent(agentId)
  if (warnings.length) console.log(`start warnings (expected for API-only agents): ${warnings.join(', ')}`)
  // Readiness is desired_state. waitUntilRunning polls that, never actual_state.
  await zc.waitUntilRunning(agentId)
  console.log('agent is running')

  // 3. Open a session with the first user message already in it.
  const session = await zc.createSession(agentId, {
    metadata: { source: 'quickstart' },
    initial_events: [{ type: 'user.message', content: 'In one sentence, what can you do?' }],
  })
  console.log(`session ${session.session_id}\n`)

  // 4. Stream until run.finished. The stream does not close on its own.
  const ctl = new AbortController()
  const budget = setTimeout(() => ctl.abort(), 120_000)
  let text = ''
  let outcome: 'succeeded' | 'failed' | 'aborted' | undefined

  try {
    for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
      const call = toolCall(ev)
      if (call?.phase === 'start') console.log(`\n[tool] ${call.toolName}`)

      const chunk = assistantText(ev)
      if (chunk) {
        text += chunk
        process.stdout.write(chunk)
      }

      if (isRunFinished(ev)) {
        outcome = runOutcome(ev)
        break
      }
    }
  } finally {
    clearTimeout(budget)
    ctl.abort()
  }

  console.log(`\n\nrun ${outcome}, ${text.trim().length} characters`)
  if (outcome !== 'succeeded') process.exitCode = 1
} catch (e) {
  if (e instanceof ZooworkError) {
    console.error(`ZooWork error ${e.status} ${e.type ?? ''}: ${e.message}`)
    process.exitCode = 1
  } else {
    throw e
  }
} finally {
  // 5. Stop before delete. DELETE is a soft delete and does not stop the agent.
  await zc.stopAgent(agentId)
  await zc.deleteAgent(agentId)
  console.log(`cleaned up agent ${agentId}`)
}
```

预期输出：

```
25 models available, using litellm/claude-sonnet-5
created agent agt_example
agent is running
session ses_example

I can research topics, run code, and work with documents.

run succeeded, 57 characters
cleaned up agent agt_example
```

## 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 每次调用都返回 `401` | key 缺失或无效 | 检查 `ZOOWORK_API_KEY` 是否以 `zct_` 开头，以及是否以 `apiKey` 传入。网关和核心 API 在这件事上用的 `error.type` 字符串不一样，所以请按 `e.status` 分支，不要按 type |
| `createSession` 返回 `409 agent_not_running` | agent 从未启动，或已被停止 | 调 `startAgent()`，并等到 `desired_state === 'running'` |
| 就绪轮询循环永远不返回 | 在轮询 `status.actual_state` | 改成轮询 `status.desired_state`，或者直接交给 `zc.waitUntilRunning()` |
| 流永远不结束 | 在等连接自己关闭 | 在 `isRunFinished(ev)` 处跳出 |
| 手上的 agent id 却返回 `404 not_found` | 这个 id 属于另一个组织 | 跨租户的 id 是被隐藏，而不是用 403 拒绝 |
| `409 idempotency_conflict` | 同一个 `Idempotency-Key`，body 不同 | 换一个新 key，或者发送逐字节一致的请求体 |

## 下一步

- [Agents](../build/agents.md) —— 配置分区、`updateAgent()` 的合并语义，以及两种响应结构。
- [Sessions](../build/sessions.md) —— 多回合对话、`postEvents()`、`system.message` 和 `user.interrupt`。
- [事件与流式](../build/events.md) —— 完整的事件词表、用 `after` 续传，以及走 REST 读历史。
- [不支持的能力](../reference/not-supported.md) —— 这里不存在的东西，包括客户端执行的自定义工具。在你围绕某个能力做设计之前，先读这一页。
