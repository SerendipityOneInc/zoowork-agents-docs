---
title: 工具
description: 控制内置工具、声明应用与 MCP 工具，并通过事件观察工具调用。
source: /en/build/tools
source_hash: 0dda772b62246e59805fca22e61c3f28b5285ea53bfbde2679cdc820e124c608
---

# 工具

agent 跑在一个托管沙箱里，模型可用的内置工具集已经就位。你决定它能触达其中多少。你也可以声明由自己的应用执行的 custom tools，或者由平台调用的远程 MCP server。内置和 MCP 工具活动通过 `agent.tool` 观察；custom call 使用 `agent.custom_tool_use`。

## 应用执行的自定义工具

当模型需要在一个回合中途暂停、让你的应用完成一项工作、再拿结果继续时，声明 custom tool。平台把声明交给模型，但不会替你的应用执行它。

::: warning 源码已核对，部署未验证
下面的 SDK 类型、方法、事件、校验规则和公共路由都有离线 contract test。本次没有在真实部署上跑完整闭环。
:::

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

等待期间 `run_status` 是 `awaiting_approval`。应检查 `pending_custom_tool_calls`，不要把这个状态一律当成人工审批。pending REST resolve 返回 `202` 和 `signaled: true`，但 row 会保持 pending，直到 run 消费结果。已经 completed、timeout 或 cancelled 的调用返回 `200` 和 `signaled: false`。未知调用返回 404，其他 Agent 的调用返回 403，停止的 run 返回 409，不支持 result signaling 的部署返回 501。

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

源码核对显示，policy 条目支持三种形式：

- `*` 匹配所有工具。
- `read` 只匹配这个精确工具名。
- `mcp__pricing__*` 匹配所有以 `mcp__pricing__` 开头的工具名。

只有末尾的一个 `*` 表示前缀匹配。`mcp__*__quote`、`*search` 等其他位置的 `*` 都匹配不到任何工具。相同规则用于 `allow`、`deny`、rule 的 `match` 和 `afterRules`，以及 deferred MCP 的 `pinned` 条目。`alsoAllow` 更严格，其中的条目始终按精确名称匹配。多条 policy rule 都可能命中时，以第一条为准。

这对 MCP 很重要，因为同一个 server 的多个工具都共享 `mcp__<server>__` 前缀。只控制一个 MCP 工具时应使用精确名称；只有确实想覆盖该 server 的所有工具时，才使用末尾前缀匹配。

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
      exposure: 'deferred',         // 默认值；首个模型请求就声明则用 'direct'
      context: { meta: true },      // 在 MCP 请求 metadata 中附带运行时标识
      permission: 'always_ask',     // 该 server 的默认审批行为
      tools: {
        quote: { permission: 'always_allow' }, // 精确的 MCP 原始工具名
      },
    },
  ],
})
```

- 只涵盖**远程 HTTP** server。沙箱里没有 stdio server，也没有 OAuth 流程。
- `url` 必须是绝对地址且公网可达：回环地址、私网段、云元数据地址和重定向都会被拒。
- MCP 工具以 `mcp__<server>__<tool>` 这个名字呈现给模型，也呈现给你。`toolCall(ev).toolName` 里出现这个前缀，就是你确认 server 真的被访问到的方式。
- `exposure` 决定这些工具何时进入模型上下文。省略或设为 `deferred` 时，工具先留在 `tool_search` / `tool_describe` 后面，加载后才可用；设为 `direct` 时，首个模型请求就直接声明。没有 `auto` 这个值。延迟工具一旦加载，会在同一个 Session 的后续回合继续可用。这些加载细节来自源码核对，尚未在部署环境验证。
- 健康目录仍按 `config_version` 固定。源码核对显示，短暂失败的目录可以过期，下次解析目录时才可能重新探测。过期策略由部署配置，不是周期重试或自动恢复保证。
- 探测失败可能让这个回合缺少该 server 的工具，并发出 `agent.error`：`kind` 为 `mcp_connection_failed` 或 `mcp_authentication_failed`，带 `server`、`errorMessage` 和可选 `reason`。未知 reason 应保留。这些新增细节尚未做真实部署验证，也不构成自动重试业务工具调用的理由。
- 它只声明在 agent 上：没有自己的 MCP 资源，也没有 session 级覆盖。

### 运行时 context 需要显式开启

MCP 声明可以通过 `context.meta`、`context.headers` 或两者同时开启运行时标识。省略时，两项都默认为 `false`。

`meta: true` 会在每次 MCP 工具调用的 `_meta["ai.zooclaw/context"]` 中加入 context。`headers: true` 会加入对应的 `x-zooclaw-*` HTTP header。context 包含 `agentId`、`sessionId` 和 `computerId`；有值时还会包含 `runId`、`turn`、`configVersion` 和 `actorUid`。这些值只是请求上下文，不是鉴权凭据；server 仍应独立验证调用方身份。

目录发现阶段没有 Session 调用上下文，所以不会带这些字段。HTTP 中间层也可能移除自定义 header；MCP server 需要经过中间层时，优先使用 `meta`。这些细节来自源码核对，尚未在部署环境验证。

### 默认审批和逐工具覆盖

`permission` 把整个 server 的默认值设为 `always_ask` 或 `always_allow`。`tools` 再按 MCP 原始工具名精确覆盖，匹配发生在加上 `mcp__<server>__<tool>` 前缀之前。`tools` 的 key 不支持通配符，一份声明最多有 64 条覆盖。两个字段都省略时，有效默认值是 `always_allow`。

`toolFilter` 和 permission 解决的是不同问题：filter 决定暴露哪些 server 工具；permission 决定已暴露的调用是否要审批。对 server 级通配范围做出的 allow-always 决定，会在当前 Session 中允许该 server 的全部工具。如果不希望范围这么大，应使用精确的逐工具 policy。

这些字段来自源码核对。端到端审批流程仍未验证，所以下面的警告仍然适用。

::: danger 只能用免鉴权的 server
`credential` 指向一个存好的 bearer token，但根本没有地方存——凭据端点经网关返回 404，这是有意为之。需要鉴权的 server 今天做不了。只声明免鉴权的 server。
:::

这条路径由服务端托管、只支持免鉴权，并按 `config_version` pin。能力需要在远程 MCP server 上执行时用它；执行属于你的应用，并且应用能在 run 等待期间返回结果时，用 `custom_tools`。

## 人工审批需要部署验证

`agent.tool` 有第三种 phase，`blocked`：这次调用正在等待审批，还没有执行；审批一旦有结果，`end` 事件照样会跟上来。

::: warning 尚未验证
审批闭环及 turn 预算行为尚未在这里验证。不要假设未经验证的审批流程能保护危险能力。源码核对的字段包括 `requested_at`、`arguments_preview`、`allowed_decisions` 和可选超时/处理人字段。202 响应带 `signaled: true` 时仍可能为 `pending`；接受信号不代表工具已经执行完成。

`ZooworkClient` 上确实有 `listApprovals` 和 `resolveApproval`，但它们调的是另外那套 approvals REST 资源，不是 `user.tool_confirmation` 事件闭环。

这个面当前的状态见[能力矩阵](../reference/capabilities.md)。
:::

## 相关

- [事件与流式](./events.md)——事件词汇表、不透明续传游标，以及 `run.finished`。
- [Skills](./skills.md)——挂在 agent 上的打包能力，和工具是两套不同的机制。
- [Environments](./environments.md)——工具运行所在的那个沙箱里装了什么。
- [不支持的能力](../reference/not-supported.md)——完整的缺口清单，包括这一条。
