---
title: 工具
source: /en/build/tools
source_hash: 928e9733f92760f7cc27ef6d1ccbc18e42bdb72e6a05cf256bc12d87e9dd7525
---

# 工具

agent 跑在一个托管沙箱里，模型可用的内置工具集已经就位。你不注册工具，也不实现工具。你决定 agent 能触达内置工具集里的多少，再从 session 事件流里读 `agent.tool` 事件，观察它实际调用了什么。

在你设计产品之前先读这一页，因为这一页上最重要的东西是一个缺口。

## 不存在客户端执行的自定义工具

::: danger 不支持
没有任何办法让 agent 调用你进程里的函数。

- agent 和 session 上都没有 `{ type: 'custom' }` 这样的工具定义。
- 没有 `user.custom_tool_result` 事件，也没有任何其他写入侧事件能把工具结果交回给模型。
- 没有回调，没有 webhook，没有任何轮询握手会把一个待执行的工具调用交到你手上。

session 的写入侧只接受四种事件类型：`user.message`、`user.interrupt`、`user.tool_confirmation` 和 `system.message`。工具结果不在其中。

如果你的设计是「agent 调用我的函数，我的代码查我的数据库，我把答案交回去」，这个闭环不存在。请改走下面两条路之一。
:::

这是与 Claude Managed Agents 之间最大的一处差异。从那边移植过来、定义了自定义工具的代码，在这里没有任何可以编译的对象。

### 替代做法

**把数据放进 prompt 里。** 每一个回合都由你控制，所以你可以先从自己的系统取数，再把结果作为文本发过去。两条写入路径都可以：

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const rows = await myDatabase.lookup(customerId) // your code, your process

await zc.postEvents(agentId, sessionId, [
  {
    type: 'user.message',
    content: `Customer record:\n${JSON.stringify(rows)}\n\nSummarize the open issues.`,
  },
])
```

`system.message` 是带外的那一种。它不会作为一个 user 回合展示，模型在下一个回合读到它：

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'system.message', text: 'Operator note: the user is on the enterprise plan.' },
])
```

注意字段名：`system.message` 带的是 `text`，而 `user.message` 带的是 `content`。

这覆盖了常见情形——你事先就知道 agent 需要什么。它覆盖不了另一种情形：模型在回合进行到一半时决定要向你要点东西。对那种情形，唯一的路径是远程 MCP server。

**把你的能力做成一个远程 MCP server。** 见下面的[远程 MCP server](#remote-mcp-servers)，在基于它构建之前，先读那里如实写下的说明。

## 内置工具集

工具清单由平台定义，不由你的代码定义。这里不逐个列出，因为一份我们无法核实的清单比没有清单更糟：你会照着一批名字去设计，而这些名字未必和你那套部署实际发布的一致。

改为去观察真实的集合。跑一个需要用到工具的回合，从事件流里读工具名：

```ts
import { createZooclawClient, toolCall, isRunFinished } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Search the web for the current time in Tokyo.' }],
})

for await (const ev of zc.streamEvents(agentId, session.session_id)) {
  const call = toolCall(ev)
  if (call) {
    console.log(call.phase, call.toolName, call.toolCallId)
  }
  if (isRunFinished(ev)) break
}
```

对每一个不是 `agent.tool` 的事件，`toolCall(ev)` 返回 `undefined`，所以它同时充当类型守卫。

事后审计一个 session，改用带过滤的 REST 读取：

```ts
const toolEvents = await zc.listEvents(agentId, sessionId, { types: ['agent.tool'] })
```

::: warning listEvents 只返回一页
服务端默认 100 条事件，最多 500 条，而 `listEvents` 只返回一页。长 session 会被静默截断，不报错。用 `after` 游标翻页：

```ts
const all = []
let after = 0
for (;;) {
  const page = await zc.listEvents(agentId, sessionId, { after, limit: 500 })
  if (page.length === 0) break
  all.push(...page)
  after = page[page.length - 1]!.seq
}
```
:::

## 用 `tool_policy` 收窄工具集

`tool_policy` 挂在 agent 资源上。空对象表示完整清单，所以一个什么都没配的 agent 拥有全部内置工具。非空对象会被读作一份收窄可用范围的 allow/deny 策略。

```ts
await zc.createAgent({
  resource: {
    name: 'research-bot',
    model: { primary: 'litellm/claude-sonnet-5' },
    tool_policy: { allow: ['read', 'web_search'] },
  },
  ownership: { owner_uid: 'usr_example', org_id: 'org_example' },
})
```

依赖它之前要知道三件事。

**它是写入即整体替换。** agent 文档的其他每一个 section 都由 `updateAgent` 按 section 合并，所以省略某个 section 就是保留它。`tool_policy` 是例外：每一次 PUT 都整体替换它。要恢复完整清单，发 `{}`：

```ts
await zc.updateAgent(agentId, { tool_policy: {} })
```

**每一次 PUT 都会 bump `config_version`** ，包括什么都没改的那一次。不要把版本号当作幂等回执，也不要每个回合都重 PUT 一遍策略。

**这些标识符由平台定义。** 上面的 `read` 和 `web_search` 来自平台自己的请求示例。按上面的方式跑一个回合、读 `toolCall(ev).toolName`，来确认你那套部署实际用的名字。

::: warning 尚未验证
`tool_policy: {}`（默认值）我们已经端到端实测过。非空的 allow/deny 策略在真实运行中是否生效，我们没有实测过；所以在你亲眼盯过一个「本应被拦截」的回合的 `agent.tool` 事件之前，把收窄后的策略当作未确认。
:::

agent 资源还接受 `sandbox: { scope: 'agent' | 'session' }`。这个字段 API 是收的；两个取值我们都没实测过，所以本页不再展开。沙箱里*装了什么*由 [Environment](/zh/build/environments) 决定，不由 `tool_policy` 决定。

## 读取工具活动

一次工具调用产生两个共享同一个 `toolCallId` 的 `agent.tool` 事件：

| `phase` | 携带 | 含义 |
|---|---|---|
| `start` | `args` | 这次调用已发出。 |
| `end` | `isError`、`resultPreview` | 这次调用已结束。 |
| `blocked` | - | 这次调用正在等待审批，**没有** 执行。 |

按 `toolCallId` 配对 `start` 和 `end`，不要按相邻位置配。模型并发发出多个调用时，它们的事件会交错。

```ts
const pending = new Map<string, string>()

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  const call = toolCall(ev)
  if (call?.phase === 'start') pending.set(call.toolCallId, call.toolName)
  if (call?.phase === 'end') {
    const name = pending.get(call.toolCallId) ?? call.toolName
    console.log(`${name} ${call.isError ? 'FAILED' : 'ok'}: ${call.resultPreview ?? ''}`)
    pending.delete(call.toolCallId)
  }
  if (isRunFinished(ev)) break
}
```

一个用到工具的典型单回合，按顺序产生这样一条弧线：

```
run.started
agent.lifecycle
agent.item
agent.thinking
agent.assistant
agent.tool (start) / agent.tool (end)   x N
agent.lifecycle
run.finished  payload.status = succeeded
```

完整的事件词汇表和续传游标见[事件与流式](/zh/build/events)。

## 工具失败不会让 run 失败

一个 `isError: true` 的 `agent.tool` 事件之后，照样跟着 `payload.status === 'succeeded'` 的 `run.finished`。模型看得到这个错误，通常会绕开它，回合正常结束。

后果是：**你不能因为没有工具错误就推断成功，也不能因为出现了工具错误就推断失败。** 回合的结果以 `run.finished` 为准，`isError` 当作诊断信息。

```ts
import { runOutcome } from '@zooclaw-agents/sdk'

let toolFailures = 0
for await (const ev of zc.streamEvents(agentId, sessionId)) {
  if (toolCall(ev)?.isError) toolFailures += 1
  if (isRunFinished(ev)) {
    console.log(`turn ${runOutcome(ev)}, ${toolFailures} tool errors along the way`)
    break
  }
}
```

## 远程 MCP server {#remote-mcp-servers}

要把你自己写的能力交给 agent，唯一的办法是跑一个远程 MCP server，并在 agent 上声明它。声明写在 `createAgent` 的 `resource.mcp` 里，`updateAgent` 上位置相同。`AgentResource` 接受未知 key，所以这个字段会原样穿过 SDK。

我们能确定说出来的是：

- 只涵盖**远程 HTTP** server。沙箱里没有 stdio server，也没有 OAuth 流程。
- MCP 工具以 `mcp__<server>__<tool>` 这个名字呈现给模型，也呈现给你。`toolCall(ev).toolName` 里出现这个前缀，就是你确认 server 真的被访问到的方式。
- 目录按 `config_version` 固定，所以改动声明在下一个回合生效，不是当前这个回合。
- 没有 MCP 的 REST 资源，也没有凭证保险库。session 级的 MCP 覆盖会被拒绝。

::: warning 尚未验证
我们没有端到端连通过一个远程 MCP server。声明字段 API 是收的，而平台自己的文档至今仍把这条路径的 worker 侧描述为未接入生产。

我们刻意不给出 `resource.mcp[]` 的示例条目，因为我们没有跑过，写出来就是在猜字段名。请给自己留出时间，自行把条目的 schema 摸清楚；也不要按「这条路径可以直接顶替客户端执行的工具」这个假设去规划产品。
:::

## 人工审批无法端到端使用

`agent.tool` 有第三种 phase，`blocked`：这次调用正在等待审批，还没有执行。配套的 `agent.approval` 事件携带这个请求，审批一旦有结果，`end` 事件照样会跟上来。在写入侧，`user.tool_confirmation` 是四种被接受的事件类型之一。

::: warning 尚未验证
审批闭环今天无法端到端跑通，不要拿它做 demo。

- 我们从来没有制造出一个真实的待审批，所以这条路径上没有任何东西被观察到能工作。
- 写入侧的事件，和平台另外那套 approvals REST 资源，用两种不同的结构描述同一个操作，而且对不上。
- SDK 完全没有暴露审批相关的方法：`ZooclawClient` 上没有 `listApprovals`，也没有 `resolveApproval`。
- 一次 run 卡在没人回应的审批上，它不会等你。这个回合会超时。

如果你看到 `phase: 'blocked'`，把它当作待处理，并预期这个回合会在工具没有执行的情况下结束。这个面当前的状态见[能力矩阵](/zh/reference/capabilities)。
:::

## 相关

- [事件与流式](/zh/build/events)——事件词汇表、`seq` 续传游标，以及 `run.finished`。
- [Skills](/zh/build/skills)——挂在 agent 上的打包能力，和工具是两套不同的机制。
- [Environments](/zh/build/environments)——工具运行所在的那个沙箱里装了什么。
- [不支持的能力](/zh/reference/not-supported)——完整的缺口清单，包括这一条。
