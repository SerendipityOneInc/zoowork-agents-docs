---
title: 工具
description: 控制内置工具、声明 MCP server，并通过事件观察工具调用。
source: /en/build/tools
source_hash: 7e43f217453a95c44b4f9f6bba88db2798ae2dc64634de8150ec7f0d021f7a66
---

# 工具

agent 跑在一个托管沙箱里，模型可用的内置工具集已经就位。你不注册工具，也不实现工具。你决定 agent 能触达内置工具集里的多少，再从 session 事件流里读 `agent.tool` 事件，观察它实际调用了什么。

## 不存在客户端执行的自定义工具

::: danger 不支持
没有任何办法让 agent 调用你进程里的函数。

- agent 和 session 上都没有 `{ type: 'custom' }` 这样的工具定义。
- 没有 `user.custom_tool_result` 事件，也没有任何其他写入侧事件能把工具结果交回给模型。
- 没有回调，没有 webhook，没有任何轮询握手会把一个待执行的工具调用交到你手上。

session 的写入侧只接受四种事件类型：`user.message`、`user.interrupt`、`user.tool_confirmation` 和 `system.message`。工具结果不在其中。

如果你的设计是「agent 调用我的函数，我的代码查我的数据库，我把答案交回去」，这个闭环不存在。请改走下面两条路之一。
:::

这是最有可能改变你整体设计的一个缺口。从带客户端自定义工具的平台移植过来的代码，在这里没有任何可以编译的对象。

### 替代做法

**把数据放进 prompt 里。** 每一个回合都由你控制，所以你可以先从自己的系统取数，再把结果作为文本发过去。两条写入路径都可以：

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

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

**把你的能力做成一个远程 MCP server。** 见下面的[远程 MCP server](#remote-mcp-servers)。它是能用的，而且只支持免鉴权。

## 内置工具集

工具清单由平台定义，不由你的代码定义。这里不逐个列出，因为一份我们无法核实的清单比没有清单更糟：你会照着一批名字去设计，而这些名字未必和你那套部署实际发布的一致。

改为去观察真实的集合。跑一个需要用到工具的回合，从事件流里读工具名：

```ts
import { createZooworkClient, toolCall, isRunFinished } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

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
const toolEvents = await zc.listAllEvents(agentId, sessionId, { types: ['agent.tool'] })
```

::: warning `listEvents` 只返回一页
`listEvents` 只返回一页——默认 100 条事件，最多 500 条——长 session 会被静默截断：不报错，没有 `has_more`，也没有总数。`listAllEvents` 会替你走完游标。见[事件与流式](./events.md)。
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
})
```

依赖它之前要知道三件事。

**它是写入即整体替换。** agent 文档的其他每一个 section 都由 `updateAgent` 按 section 合并，所以省略某个 section 就是保留它。`tool_policy` 是例外：每一次 PUT 都整体替换它。要恢复完整清单，发 `{}`：

```ts
await zc.updateAgent(agentId, { tool_policy: {} })
```

**每一次 PUT 都会 bump `config_version`** ，包括什么都没改的那一次，所以不要每个回合都重 PUT 一遍策略。见[错误处理](../reference/errors.md)。

**这些标识符由平台定义。** 上面的 `read` 和 `web_search` 来自平台自己的请求示例。按上面的方式跑一个回合、读 `toolCall(ev).toolName`，来确认你那套部署实际用的名字。

::: warning 尚未验证
`tool_policy: {}`（默认值）我们已经端到端实测过。非空的 allow/deny 策略在真实运行中是否生效，我们没有实测过；所以在你亲眼盯过一个「本应被拦截」的回合的 `agent.tool` 事件之前，把收窄后的策略当作未确认。
:::

agent 资源还接受 `sandbox: { scope: 'agent' | 'session' }`。这个字段 API 是收的；两个取值我们都没实测过，所以本页不再展开。沙箱里*装了什么*由 [Environment](./environments.md) 决定，不由 `tool_policy` 决定。

## 读取工具活动

一次工具调用产生一系列共享同一个 `toolCallId` 的 `agent.tool` 事件，每个 phase 一个：`start`、`end` 和 `blocked`。按 `toolCallId` 配对 `start` 和 `end`，不要按相邻位置配。模型并发发出多个调用时，它们的事件会交错。每个 phase 各携带什么，见[事件与流式](./events.md)。

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

## 工具失败不会让 run 失败

一个 `isError: true` 的 `agent.tool` 事件之后，照样跟着 `payload.status === 'succeeded'` 的 `run.finished`。回合的结果以 `runOutcome()` 为准，`isError` 当作诊断信息。

## 远程 MCP server {#remote-mcp-servers}

要把你自己写的能力交给 agent，唯一的办法是跑一个远程 MCP server，并在 agent 上声明它。声明写在 `createAgent` 的 `resource.mcp` 里，`updateAgent` 上位置相同。它是一个有类型的字段，`mcp?: McpServerDeclaration[]`，所以条目的结构在编译期就会被检查。

```ts
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'pricing',              // 会出现在每个工具名里；不能带下划线
      url: 'https://mcp.example.com/pricing',
      transport: 'streamable-http', // 或 'sse'；这个是默认值
      toolFilter: ['quote'],        // 省略则暴露该 server 的全部工具
    },
  ],
})
```

- 只涵盖**远程 HTTP** server。沙箱里没有 stdio server，也没有 OAuth 流程。
- `url` 必须是绝对地址且公网可达：回环地址、私网段、云元数据地址和重定向都会被拒。
- MCP 工具以 `mcp__<server>__<tool>` 这个名字呈现给模型，也呈现给你。`toolCall(ev).toolName` 里出现这个前缀，就是你确认 server 真的被访问到的方式。
- 目录按 `config_version` 固定，所以改动声明在下一个回合生效，不是当前这个回合。
- 一个目录探测失败的 server 不会让 run 失败。它会钉住一份空目录，并发出 `kind: 'mcp_connection_failed'` 的 `agent.error`，回合照常进行，只是没有那些工具。
- 它只声明在 agent 上：没有自己的 MCP 资源，也没有 session 级覆盖。

::: danger 只能用免鉴权的 server
`credential` 指向一个存好的 bearer token，但根本没有地方存——凭据端点经网关返回 404，这是有意为之。需要鉴权的 server 今天做不了。只声明免鉴权的 server。
:::

这条路径是服务端托管、只支持免鉴权、按 `config_version` 钉住的。不要把它当成客户端执行工具的直接替代品来规划产品。

## 人工审批无法端到端使用

`agent.tool` 有第三种 phase，`blocked`：这次调用正在等待审批，还没有执行；审批一旦有结果，`end` 事件照样会跟上来。

::: warning 尚未验证
一次 run 卡在没人回应的审批上，它不会等你。这个回合会超时。

`ZooworkClient` 上确实有 `listApprovals` 和 `resolveApproval`，但它们调的是另外那套 approvals REST 资源，不是 `user.tool_confirmation` 事件闭环。

这个面当前的状态见[能力矩阵](../reference/capabilities.md)。
:::

## 相关

- [事件与流式](./events.md)——事件词汇表、`seq` 续传游标，以及 `run.finished`。
- [Skills](./skills.md)——挂在 agent 上的打包能力，和工具是两套不同的机制。
- [Environments](./environments.md)——工具运行所在的那个沙箱里装了什么。
- [不支持的能力](../reference/not-supported.md)——完整的缺口清单，包括这一条。
