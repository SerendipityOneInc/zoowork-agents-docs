---
title: 工具
description: 配置内置工具和由应用执行的工具，并观察调用结果。
source: /en/build/tools
source_hash: 54b56759483eb365158bbfd374277848050073dcac70ec74e5eac039afaffbd0
---

# 工具

Agent 在 run 中调用工具，操作文件、运行命令、访问 Web 或你自己的服务。
ZooWork 通过托管 runtime 执行内置工具。Custom tool 由应用执行并返回结果；
[MCP Server](./mcp.md) 提供由平台远程调用的工具。

示例复用[快速开始](../get-started/quickstart.md)中的 client 和 Agent。Python 调用在 async 函数中运行。curl 先完成[鉴权](../get-started/authentication.md)中的环境变量设置。

## Agent 基础工具

普通的 active Agent 在 `tool_policy` 为空时，默认可以看到这些名称。可见不保证调用成功：沙箱 backend 或 Web proxy 仍需可用，文件访问和网络请求也受各自的限制。

| 工具 | Agent 可以做什么 | 边界 |
|---|---|---|
| `read` | 读取沙箱中的文件。 | 相对路径从 `/workspace` 解析。 |
| `write` | 新建或覆盖沙箱中的文件。 | 只能写入声明的可写目录。 |
| `edit` | 修改已有文件中的文字。 | 同样受可写目录限制。 |
| `apply_patch` | 对沙箱文件应用 patch。 | 同样受可写目录限制。 |
| `exec` | 在沙箱中执行命令。 | 安装的软件和沙箱网络访问由 Environment 决定。 |
| `process` | 继续管理或停止 `exec` 启动的命令。 | 需要当前 Agent runtime 中已有的进程。 |
| `web_fetch` | 获取并提取 HTTP(S) 网页内容。 | 走平台 proxy，不操作浏览器。 |
| `web_search` | 搜索网页。 | 走已配置的平台搜索服务。 |
| `web_image_search` | 搜索图片。 | 走已配置的平台搜索服务。 |

软件和资源规格见[云沙箱参考](./cloud-sandbox-reference.md)。沙箱的 `networking` 控制 `exec` 中 `curl` 等命令的网络访问；`web_fetch` 和搜索工具通过沙箱网络之外的平台服务执行。需要移除这些 Web 工具时，用 `tool_policy` 收窄 Agent 的工具面。

这些是 Agent 工具，不是 SDK 按名称直接调用的方法。SDK 另有 `exec(agentId, args)`，
可以在 agent-scope 沙箱中执行命令，不经过 Agent 的工具循环。

## 用 `tool_policy` 收窄工具集

`tool_policy` 挂在 Agent 资源上。空对象表示 policy 不额外限制工具；runtime 和配置条件仍会决定哪些工具可见。非空对象可以收窄工具可用范围，并配置调用规则。`allow` 和 `deny` 选择暴露哪些工具，
`permissions` 可以要求调用前审批。见[权限策略](./permissions.md)。

ZooWork 在 `tool_policy` 中使用 `allow` 和 `deny` 工具名，不使用逐个工具的 `enabled` 配置。

### 关闭指定工具

创建 Agent 时，可以隐藏三个 Web 工具。其他工具仍按正常的 runtime 条件决定是否可见：

::: code-group

```ts [TypeScript]
await client.createAgent({
  resource: {
    name: 'report-agent-no-web-tools',
    tool_policy: { deny: ['web_fetch', 'web_search', 'web_image_search'] },
  },
})
```

```python [Python]
await client.create_agent(
    {
        "name": "report-agent-no-web-tools",
        "tool_policy": {
            "deny": [
                "web_fetch",
                "web_search",
                "web_image_search"
            ]
        }
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "resource": {
    "name": "report-agent-no-web-tools",
    "tool_policy": {
      "deny": [
        "web_fetch",
        "web_search",
        "web_image_search"
      ]
    }
  }
}
JSON
```

:::

对于已有 Agent，可以替换 policy，关闭单个工具：

::: code-group

```ts [TypeScript]
await client.updateAgent(agentId, {
  tool_policy: { deny: ['web_search'] },
})
```

```python [Python]
await client.update_agent(agent_id,
    {
        "tool_policy": {
            "deny": [
                "web_search"
            ]
        }
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "tool_policy": {
    "deny": [
      "web_search"
    ]
  }
}
JSON
```

:::

这次更新会**整体替换**原有 `tool_policy`。提交时要带上仍需保留的其他规则。

### 只开放指定工具

`allow` 会收窄普通工具面。下面的 policy 只从这个工具面开放 `read`、`write` 和 `exec`，仍受正常 runtime 条件限制：

::: code-group

```ts [TypeScript]
await client.createAgent({
  resource: {
    name: 'report-agent',
    tool_policy: { allow: ['read', 'write', 'exec'] },
  },
})
```

```python [Python]
await client.create_agent(
    {
        "name": "report-agent",
        "tool_policy": {
            "allow": [
                "read",
                "write",
                "exec"
            ]
        }
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "resource": {
    "name": "report-agent",
    "tool_policy": {
      "allow": [
        "read",
        "write",
        "exec"
      ]
    }
  }
}
JSON
```

:::

同一个名称同时出现在 `allow` 和 `deny` 时，`deny` 优先。
特殊的系统回合仍可能额外注入上下文工具。

这些例子控制的是 Agent 的模型工具面。拒绝 Web 工具不会阻止 `exec` 中的命令访问网络；沙箱出站网络要用 Environment 的 `networking` policy 控制。

### 恢复默认工具面

要移除所有 policy 限制，恢复 runtime 的默认工具面，发 `{}`：

::: code-group

```ts [TypeScript]
await client.updateAgent(agentId, { tool_policy: {} })
```

```python [Python]
await client.update_agent(agent_id,
    {
        "tool_policy": {}
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "tool_policy": {}
}
JSON
```

:::

默认工具面仍取决于 runtime 和部署配置。每次 PUT 点名 `tool_policy` 都会整体替换该 policy；省略它则会保留原有 policy。
清空 `tool_policy` 时，`mcp` 中声明的 MCP 审批默认值仍然生效。

依赖它之前还要知道两件事。

**每一次 PUT 都会 bump `config_version`** ，包括什么都没改的那一次，所以不要每个回合都重 PUT 一遍策略。见[错误处理](../reference/errors.md)。

**这些标识符由平台定义。** 上表列出基础工具名称。一个回合的 `agent.tool` 事件可以确认实际调用过的名称，但事件中没有某个名称，不表示该工具不可用。

### 工具名匹配模式

policy 条目支持三种形式：

- `*` 匹配所有工具。
- `read` 只匹配这个精确工具名。
- `mcp__pricing__*` 匹配所有以 `mcp__pricing__` 开头的工具名。

只有末尾的一个 `*` 表示前缀匹配。`mcp__*__quote`、`*search` 等其他位置的 `*` 都匹配不到任何工具。相同规则用于 `allow`、`deny`、rule 的 `match` 和 `afterRules`，以及 deferred MCP 的 `pinned` 条目。`alsoAllow` 更严格，其中的条目始终按精确名称匹配。多条 policy rule 都可能命中时，以第一条为准。

这对 MCP 很重要，因为同一个 server 的多个工具都共享 `mcp__<server>__` 前缀。只控制一个 MCP 工具时应使用精确名称；只有确实想覆盖该 server 的所有工具时，才使用末尾前缀匹配。

Agent resource 里的 `sandbox: { scope: 'agent' | 'session' }` 与工具是否可用无关。沙箱里安装了什么由 [Environment](./environments.md) 决定，不由 `tool_policy` 决定。

## 应用执行的自定义工具

当模型需要在一个回合中途暂停、让你的应用完成一项工作、再拿结果继续时，声明 custom tool。平台把声明交给模型，但不会替你的应用执行它。

后端需要查询已有数据库或调用已有服务时，使用 custom tool。
应由平台直接调用兼容的远程 Server 时，使用 [MCP](./mcp.md)。
完整应用示例见[通过工具接入知识库](./retrieval.md)。

### 声明工具

`resource.custom_tools` 是 replace-on-write。每一项包含名称、描述、object JSON Schema 和可选 timeout：

::: code-group

```ts [TypeScript]
const agent = await client.createAgent({
  resource: {
    name: 'pricing-agent',
    custom_tools: [
      {
        name: 'lookup_price',
        description: 'Look up one SKU in the pricing service.',
        input_schema: {
          type: 'object',
          properties: { sku: { type: 'string' } },
          required: ['sku'],
        },
        timeoutMs: 600_000,
      },
    ],
  },
})
```

```python [Python]
agent = await client.create_agent(
    {
        "name": "pricing-agent",
        "custom_tools": [
            {
                "name": "lookup_price",
                "description": "Look up one SKU in the pricing service.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "sku": {
                            "type": "string"
                        }
                    },
                    "required": [
                        "sku"
                    ]
                },
                "timeoutMs": 600000
            }
        ]
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "resource": {
    "name": "pricing-agent",
    "custom_tools": [
      {
        "name": "lookup_price",
        "description": "Look up one SKU in the pricing service.",
        "input_schema": {
          "type": "object",
          "properties": {
            "sku": {
              "type": "string"
            }
          },
          "required": [
            "sku"
          ]
        },
        "timeoutMs": 600000
      }
    ]
  }
}
JSON
```

:::

一个 Agent 最多声明 32 个 custom tools。`name` 匹配 `^[a-zA-Z0-9_-]{1,64}$`，在 Agent 内唯一，而且不能覆盖内置、MCP、memory 或 runtime 保留的工具名。`description` 非空且最多 4 KiB。`input_schema` 必须是 `type: 'object'`，最多 16 KiB。`timeoutMs` 默认 600,000 ms，最大 86,400,000 ms。非法声明返回 `400 invalid_request`。

### 写清楚工具描述

描述 Agent 何时应该调用工具、接受什么输入、返回什么结果。操作会修改数据时，明确写出影响。
让描述集中说明如何选择工具；业务规则和授权由应用处理。

Schema 帮助模型生成参数。执行前仍要校验收到的输入，并根据应用中可信的用户上下文检查访问权限。

### 执行并返回结果

请求事件是 `agent.custom_tool_use`。TypeScript 的 `customToolUse()` 和 Python 的 `custom_tool_use()` 会给出 `callId`、名称、输入和 timeout：

::: code-group

```ts [TypeScript]
import { customToolUse } from '@zoowork-ai/sdk'

const call = customToolUse(ev)
if (call?.phase === 'requested') {
  const price = await pricing.lookup(call.input?.sku)
  await client.resolveCustomToolCall(agentId, call.callId, {
    content: [{ type: 'json', value: price }],
    resolvedBy: 'pricing-service',
  })
}
```

```python [Python]
from zoowork import custom_tool_use

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

:::

`listCustomToolCalls(agentId, { status: 'pending' })` 和 `list_custom_tool_calls(agent_id, status="pending")` 可以在应用重启后找回待处理调用。列表只支持 `pending` filter。

另一条返回路径是 Session API：发送 `user.custom_tool_result` event，带 `custom_tool_use_id`（也接受 `call_id`）、`content`、可选 `is_error` 和稳定的 `idempotency_key`。content 包含 1–16 个 text、JSON 或 base64 image blocks。text 合计最多 256 KiB；单张图片的 base64 最多 4 MiB；所有 blocks 合计最多 8 MiB。图片接受 PNG、JPEG、GIF 和 WebP。

等待期间 `run_status` 是 `awaiting_approval`。应检查 `pending_custom_tool_calls`，不要把这个状态一律当成人工审批。pending REST resolve 返回 `202` 和 `signaled: true`，但 row 会保持 pending，直到 run 消费结果。已经 completed、timeout 或 cancelled 的调用返回 `200` 和 `signaled: false`。未知调用返回 404，其他 Agent 的调用返回 403，停止的 run 返回 409。如果当前环境没有配置 result signaling，这个 endpoint 返回 501。

## 图像与 PDF 工具

对应模型和服务可用时，Agent 可以调用 `pdf` 和 `image` 检查文件。
下面列的是 Agent loop 内的工具参数，不是 SDK 方法，也不是 `user.message` 接受的字段。

| 工具 | 输入与限制 |
|---|---|
| `pdf` | 必须提供 `prompt`，接受 `pdf` 或 `pdfs`。最多 10 份文件，单份最多 30 MiB，总计最多 30 MiB。 |
| `image` | 接受 `image` 或 `images`，`prompt` 可选。最多 20 张 PNG、JPEG、GIF 或 WebP，单张最多 10 MiB，总计最多 25 MiB。`maxImages` 和 `maxBytesMb` 只能降低这些上限。 |

PDF 不超过 10 MiB，且未指定 `pages` 或 `password` 时，使用 native PDF 处理。
其他情况使用 `pdftotext`，每份文件最多提取 512 KiB 文字。
`pages` 接受单页或最多包含 20 页的连续页码范围。文字提取可能丢失视觉布局，也可能无法恢复扫描内容。

Loader 接受 `/workspace` 路径、data URL、HTTP(S) URL，以及当前 Session 所有的 artifact reference。
Session 消息只能携带文本。要把本地文件交给 Agent，先[上传到 `/workspace`](./files.md#send-a-file-to-the-agent)，再在消息中写出路径。

`model.input: ['image']` 声明主模型自己读图，与 `image` 工具和图像生成是不同能力。
Typed `AgentResource` 不能配置 `imageModel` 或 `pdfModel`；见 [Models](../reference/models.md)。

## 观察工具调用

事件流记录 Agent 实际调用过的工具，不是全部可用工具的清单。
同一时间只发起一轮对话时，从已有 Session 保存的 cursor 续读，并按调用 id 配对各个 phase。没有 checkpoint 时，见 [cursor 恢复](./events.md#existing-session-without-a-saved-cursor)：

一次工具调用产生一系列共享同一个 `toolCallId` 的 `agent.tool` 事件，每个 phase 一个：`start`、`end` 和 `blocked`。`blocked` 是未执行即结束的终态，原因可能是策略拒绝、审批拒绝、超时或取消，或被 interrupt 打断；具体读取事件 payload 的 `deniedReason`。等待审批使用 `agent.approval` 的 `requested`。按 `toolCallId` 关联事件，不要按相邻位置配。模型并发发出多个调用时，它们的事件会交错。每个 phase 各携带什么，见[事件与流式](./events.md)。

```ts
import { toolCall, isRunFinished } from '@zoowork-ai/sdk'

const pending = new Map<string, string>()

// savedCursor is the last processed cursor for this Session.
for await (const ev of client.streamEvents(agentId, sessionId, { cursor: savedCursor })) {
  const call = toolCall(ev)
  if (call?.phase === 'start') pending.set(call.toolCallId, call.toolName)
  if (call?.phase === 'blocked') {
    console.log(call.toolName + ' blocked before execution', ev.payload.deniedReason)
    pending.delete(call.toolCallId)
  }
  if (call?.phase === 'end') {
    const name = pending.get(call.toolCallId) ?? call.toolName
    console.log(`${name} ${call.isError ? 'FAILED' : 'ok'}: ${call.resultPreview ?? ''}`)
    pending.delete(call.toolCallId)
  }
  if (isRunFinished(ev)) break
}
```

事后审计一个 session，改用带过滤的 REST 读取：

```ts
const toolEvents = await client.listAllEvents(agentId, sessionId, { types: ['agent.tool'] })
```

::: warning `listEvents` 只返回一页
`listEvents` 只返回一页——默认 100 条事件，最多 500 条——长 session 会被静默截断：不报错，没有 `has_more`，也没有总数。`listAllEvents` 会替你走完游标。见[事件与流式](./events.md)。
:::

## 工具结果与 run 结果

模型处理了工具错误后，run 仍可能成功。工具结果看 `isError`，最终 run 状态看 `runOutcome()`。
后续模型或 runtime 失败仍可能让整个 run 失败。

返回与任务相关的结果。较大的工具输出可能被截断，不要假定模型会收到整个索引或文档集合。
检索时返回少量相关片段并附上来源标识。见[通过工具接入知识库](./retrieval.md)。

## 相关

- [MCP Server](./mcp.md)——连接运行在远程 MCP 服务上的工具。
- [权限策略](./permissions.md)——决定哪些工具调用需要审批。
- [通过工具接入知识库](./retrieval.md)——接入自己的文档搜索或知识服务。
- [事件与流式](./events.md)——事件词汇表、不透明续传游标，以及 `run.finished`。
- [Skills](./skills.md)——挂在 agent 上的打包能力，和工具是两套不同的机制。
- [Environments](./environments.md)——工具运行所在的那个沙箱里装了什么。
