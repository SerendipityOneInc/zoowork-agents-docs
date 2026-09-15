---
title: 工具
description: 配置内置工具和应用执行的工具，控制工具是否可用，并观察工具调用。
source: /en/build/tools
source_hash: 1f8c1b12937a03fb0a174d39393b9ca1346b8e81796944f4e71b74cced10ce66
---

# 工具

agent 跑在一个托管沙箱里，模型可用的内置工具集已经就位。你决定它能触达其中多少。你也可以声明由自己的应用执行的 custom tools，让 run 等待应用返回结果。由平台调用的外部工具通过 [MCP Server](./mcp.md) 连接。

## 应用执行的自定义工具

当模型需要在一个回合中途暂停、让你的应用完成一项工作、再拿结果继续时，声明 custom tool。平台把声明交给模型，但不会替你的应用执行它。

### 声明工具

`resource.custom_tools` 是 replace-on-write。每一项包含名称、描述、object JSON Schema 和可选 timeout：

```ts
const agent = await zc.createAgent({
  resource: {
    name: 'pricing-agent',
    custom_tools: [{
      name: 'lookup_price',
      description: 'Look up one SKU in the pricing service.',
      input_schema: { type: 'object', required: ['sku'] },
      timeoutMs: 600_000,
    }],
  },
})
```

Python resource 使用相同的 wire 字段：

```python
agent = await client.create_agent(
    {
        "name": "pricing-agent",
        "custom_tools": [
            {
                "name": "lookup_price",
                "description": "Look up one SKU in the pricing service.",
                "input_schema": {"type": "object", "required": ["sku"]},
                "timeoutMs": 600_000,
            }
        ],
    }
)
```

一个 Agent 最多声明 32 个 custom tools。`name` 匹配 `^[a-zA-Z0-9_-]{1,64}$`，在 Agent 内唯一，而且不能覆盖内置、MCP、memory 或 runtime 保留的工具名。`description` 非空且最多 4 KiB。`input_schema` 必须是 `type: 'object'`，最多 16 KiB。`timeoutMs` 默认 600,000 ms，最大 86,400,000 ms。非法声明返回 `400 invalid_request`。

### 执行并返回结果

请求事件是 `agent.custom_tool_use`。TypeScript 的 `customToolUse()` 和 Python 的 `custom_tool_use()` 会给出 `callId`、名称、输入和 timeout：

```ts
const call = customToolUse(ev)
if (call?.phase === 'requested') {
  const price = await pricing.lookup(call.input?.sku)
  await zc.resolveCustomToolCall(agentId, call.callId, {
    content: [{ type: 'json', value: price }],
    resolvedBy: 'pricing-service',
  })
}
```

```python
call = custom_tool_use(event)
if call is not None and call.phase == "requested":
    price = await pricing.lookup(call.input["sku"] if call.input else None)
    await client.resolve_custom_tool_call(
        agent_id,
        call.call_id,
        content=[{"type": "json", "value": price}],
        resolved_by="pricing-service",
    )
```

`listCustomToolCalls(agentId, { status: 'pending' })` 和 `list_custom_tool_calls(agent_id, status="pending")` 可以在应用重启后找回待处理调用。列表只支持 `pending` filter。

另一条返回路径是 Session API：发送 `user.custom_tool_result` event，带 `custom_tool_use_id`（也接受 `call_id`）、`content`、可选 `is_error` 和稳定的 `idempotency_key`。content 包含 1–16 个 text、JSON 或 base64 image blocks。text 合计最多 256 KiB；单张图片的 base64 最多 4 MiB；所有 blocks 合计最多 8 MiB。图片接受 PNG、JPEG、GIF 和 WebP。

等待期间 `run_status` 是 `awaiting_approval`。应检查 `pending_custom_tool_calls`，不要把这个状态一律当成人工审批。pending REST resolve 返回 `202` 和 `signaled: true`，但 row 会保持 pending，直到 run 消费结果。已经 completed、timeout 或 cancelled 的调用返回 `200` 和 `signaled: false`。未知调用返回 404，其他 Agent 的调用返回 403，停止的 run 返回 409。如果当前环境没有配置 result signaling，这个 endpoint 返回 501。

## 内置工具集

内置工具 manifest 由平台定义。应用不要另外维护一份工具名称清单；直接从事件流读取 Agent 实际使用的工具名。

运行一个需要调用工具的回合，再从事件流读取工具名：

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
    model: { primary: 'litellm/gpt-5.6-terra' },
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

### 工具名匹配模式

policy 条目支持三种形式：

- `*` 匹配所有工具。
- `read` 只匹配这个精确工具名。
- `mcp__pricing__*` 匹配所有以 `mcp__pricing__` 开头的工具名。

只有末尾的一个 `*` 表示前缀匹配。`mcp__*__quote`、`*search` 等其他位置的 `*` 都匹配不到任何工具。相同规则用于 `allow`、`deny`、rule 的 `match` 和 `afterRules`，以及 deferred MCP 的 `pinned` 条目。`alsoAllow` 更严格，其中的条目始终按精确名称匹配。多条 policy rule 都可能命中时，以第一条为准。

这对 MCP 很重要，因为同一个 server 的多个工具都共享 `mcp__<server>__` 前缀。只控制一个 MCP 工具时应使用精确名称；只有确实想覆盖该 server 的所有工具时，才使用末尾前缀匹配。

Agent resource 里的 `sandbox: { scope: 'agent' | 'session' }` 与工具是否可用无关。沙箱里安装了什么由 [Environment](./environments.md) 决定，不由 `tool_policy` 决定。

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

## 工具结果与 run 结果

一个 `isError: true` 的 `agent.tool` 事件之后，照样跟着 `payload.status === 'succeeded'` 的 `run.finished`。回合的结果以 `runOutcome()` 为准，`isError` 当作诊断信息。

## 相关

- [MCP Server](./mcp.md)——连接运行在远程 MCP 服务上的工具。
- [权限策略](./permissions.md)——决定哪些 MCP 调用需要审批。
- [事件与流式](./events.md)——事件词汇表、不透明续传游标，以及 `run.finished`。
- [Skills](./skills.md)——挂在 agent 上的打包能力，和工具是两套不同的机制。
- [Environments](./environments.md)——工具运行所在的那个沙箱里装了什么。

## 检查你的理解

::: details `tool_policy` 会控制审批吗？
不会。它控制 Agent 可以使用哪些工具。MCP 工具的审批行为由[权限策略](./permissions.md)单独配置。
:::

::: details 什么时候用 custom tool，什么时候用 MCP？
由你的应用执行操作，并在 run 等待时返回结果，使用 custom tool。由平台直接调用远程 MCP Server，使用 MCP。
:::

::: details 如何读取工具和 run 的结果？
工具调用结果读取事件上的 `isError`，turn 结果读取 `runOutcome()`。模型处理工具错误后，run 仍然可以成功完成。
:::
