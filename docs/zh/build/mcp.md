---
title: MCP Server
description: 为 Agent 连接远程 MCP Server，选择工具、加载方式，并传递运行时 context。
source: /en/build/mcp
source_hash: c428b651f3fd03ec0b14a9b19894a0848909ad298532b3f351b3b915bc4956e9
---

# MCP Server

Model Context Protocol（MCP）Server 为 Agent 提供运行在远程基础设施上的工具。每个 Server 都声明在 Agent 的
`resource.mcp` 数组里。平台读取它的工具目录，把选中的工具提供给模型，并直接调用远程 endpoint。

如果操作应由你的应用执行并返回结果，请使用[应用执行的 custom tool](./tools.md#应用执行的自定义工具)。
如果操作应由平台直接调用远程 Server，请使用 MCP。

示例复用[快速开始](../get-started/quickstart.md)中的 client 和 Agent。Python 调用在 async 函数中运行。curl 先完成[鉴权](../get-started/authentication.md)中的环境变量设置。

## 连接要求

远程 HTTP endpoint 需要能从公网访问，并接受平台发出的免鉴权请求。公共 API 通过
`streamable-http` 或 SSE 连接，不会附带已存储的 credential。

URL 不能指向 loopback、私有网络或 cloud metadata 地址，也不能经过 redirect。
平台在目录发现和工具执行时都会进行这些检查。

公共 API 不提供 MCP credential 配置、自动 OAuth 配置或托管的私网 tunnel。
运行时 context 不能代替鉴权。对于后端已经可以访问的私有或需要认证的服务，
使用[应用执行的 custom tool](./tools.md#应用执行的自定义工具)。

## 连接 Server

下面的配置从一个 Server 暴露 `quote` 和 `inventory` 两个工具：

::: code-group

```ts [TypeScript]
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'pricing',
      url: 'https://mcp.example.com/pricing',
      transport: 'streamable-http',
      toolFilter: ['quote', 'inventory'],
      exposure: 'deferred',
    },
  ],
})
```

```python [Python]
await client.update_agent(agent_id,
    {
        "mcp": [
            {
                "name": "pricing",
                "url": "https://mcp.example.com/pricing",
                "transport": "streamable-http",
                "toolFilter": [
                    "quote",
                    "inventory"
                ],
                "exposure": "deferred"
            }
        ]
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "mcp": [
    {
      "name": "pricing",
      "url": "https://mcp.example.com/pricing",
      "transport": "streamable-http",
      "toolFilter": [
        "quote",
        "inventory"
      ],
      "exposure": "deferred"
    }
  ]
}
JSON
```

:::

`mcp` 是 Agent 配置的一部分。更新时会整体替换这个数组，因此需要同时带上 Agent 应继续使用的
其他 Server。

每个声明接受以下字段：

| 字段 | 作用 |
|---|---|
| `name` | 唯一的 Server 名称，匹配 `^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$`。不能包含下划线。 |
| `url` | 远程 MCP endpoint 的绝对 URL。 |
| `transport` | `streamable-http` 或 `sse`，默认是 `streamable-http`。 |
| `toolFilter` | 最多 64 个要暴露的原始工具名，按精确名称匹配。省略时暴露完整目录。 |
| `exposure` | `deferred` 或 `direct`，控制工具定义何时进入模型 context。 |
| `context` | 决定工具调用是否携带 Agent 和 Session 标识。 |
| `permission` | 这个 Server 上工具的默认审批策略。 |
| `tools` | 最多 64 条按原始工具名设置的审批覆盖，也可设置 `requireConfirmation`。 |

`permission` 和 `tools` 的配置方式见[权限策略](./permissions.md)。

一个 Agent 最多声明 16 个 MCP Servers。Server 名称应保持简短：完整工具名
`mcp__<server>__<tool>` 必须匹配 `^[a-zA-Z0-9_-]{1,64}$`。
加前缀后超过这个限制的工具会从目录中省略。

## 选择 MCP 工具

`toolFilter` 使用 MCP Server 返回的原始工具名，不包含 ZooWork 添加的前缀。
例如，`pricing` Server 的原始工具名是 `quote`，模型和事件流看到的名称是：

```text
mcp__pricing__quote
```

省略 `toolFilter` 会暴露目录里的所有工具。当 Agent 只需要 Server 的一部分能力时，建议明确列出工具名，
这样 Server 后续新增工具也不会自动扩大 Agent 的工具范围。

Agent 的 [`tool_policy`](./tools.md#用-tool-policy-收窄工具集) 可以继续按带前缀的名称，
收窄所有来源合并后的工具范围。

## 选择加载方式

`exposure` 控制模型何时收到 MCP 工具定义。

| 取值 | 行为 |
|---|---|
| `deferred` | 默认值。工具先留在 `tool_search` 和 `tool_describe` 后面，由模型按需加载。 |
| `direct` | 工具定义从第一次模型请求开始就进入 context。 |

deferred 工具一旦加载，会在同一个 Session 的后续回合继续可用。工具数量少，而且几乎每个回合都会用到时，
选择 `direct`。工具目录较大时，选择 `deferred`，可以减少初始 context。

## 传递运行时 context

MCP 工具调用可以携带当前 Agent 和 Session 的标识：

::: code-group

```ts [TypeScript]
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'pricing',
      url: 'https://mcp.example.com/pricing',
      context: { meta: true, headers: false },
    },
  ],
})
```

```python [Python]
await client.update_agent(agent_id,
    {
        "mcp": [
            {
                "name": "pricing",
                "url": "https://mcp.example.com/pricing",
                "context": {
                    "meta": True,
                    "headers": False
                }
            }
        ]
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "mcp": [
    {
      "name": "pricing",
      "url": "https://mcp.example.com/pricing",
      "context": {
        "meta": true,
        "headers": false
      }
    }
  ]
}
JSON
```

:::

`meta: true` 会在每次 MCP 工具调用中添加 `_meta["ai.zooclaw/context"]`。
`headers: true` 会添加对应的 `x-zooclaw-*` HTTP header。context 包含 `agentId`、
`sessionId` 和 `computerId`；可用时还会包含 `runId`、`turn`、`configVersion` 和 `actorUid`。

两个选项都默认是 `false`。工具目录发现发生在具体工具调用之前，因此不携带运行时 context。
这些标识只提供请求上下文，不能作为调用方已经通过鉴权的证明。

## 处理连接错误

私有地址错误可能附带本地开发用的环境变量提示。该提示不是托管 API 用户可以设置的选项。请使用公共 MCP endpoint，或在自己的后端执行 application-executed custom tool；不要通过 Agent 配置尝试开启私网访问。

如果平台无法读取某个 Server 的工具目录，这个 Server 的工具不会出现在当前回合中。
事件流可能包含 `agent.error`，其中 `kind` 有以下取值：

- `mcp_connection_failed`：无法连接 endpoint。
- `mcp_authentication_failed`：endpoint 拒绝了请求。

payload 还包含 `server`、`errorMessage`，也可能包含 `reason`。保留未知的 `reason` 值，
以兼容后续新增的错误原因。目录连接错误不能说明业务工具已经执行，因此不要只根据这个事件重放业务操作。

## Server 变化后刷新目录

成功读取的目录会 pin 到 Agent 的配置版本。同一配置下再开一个 Session，
不会发现 Server 后续新增的工具。

临时连接失败会保留一段时间的错误目录。默认是五分钟，部署环境可以设置不同值。
到期后，下一次目录解析会重试这个 Server。永久失败会一直保留，直到 Agent 使用新的配置版本。

修复永久错误或修改 Server 的工具集后，更新 Agent 的 MCP 配置以生成新版本。
提交时包含完整 Server 数组。在配置变化时执行这一步，不要每个回合都 PUT：
即使内容相同，PUT 也会 bump `config_version`。见 [Agents](./agents.md#每一次-put-都会-bump-版本号)。

## 工具目录限制

平台先读取 Server 完整的 `tools/list` 响应，再应用 `toolFilter`。
只选择两个工具，并不能让超出限制的 Server 目录通过检查。

| 限制 | 最大值 |
|---|---|
| 单个 Server 返回的工具数 | 128 |
| 单个 Server 的 `tools/list` 页数 | 8 |
| 单个工具的 input schema | 64 KiB |
| 单个 Server 的序列化目录 | 256 KiB |
| Agent 已接受目录的工具总数 | 256 |
| 目录序列化后的总大小 | 1 MiB |

超过 32 KiB 的工具描述会被截断。Input schema 或目录超出限制时，目录发现失败，不会只接受一部分。
总预算按 Server 名称顺序计算。某个 Server 超出预算时，它的工具不会出现，并可能报告连接错误。

目录超出限制时，让 MCP Server 暴露一个更小的目录。`toolFilter` 控制发现之后的工具暴露范围，
不会缩小 Server 的目录发现预算。

## 相关

- [权限策略](./permissions.md)——决定哪些 MCP 调用需要审批。
- [工具](./tools.md)——配置内置工具和应用执行的工具。
- [通过工具接入知识库](./retrieval.md)——通过 MCP 或 custom tool 提供文档搜索。
- [事件与流式](./events.md)——观察 MCP 调用和连接错误。
