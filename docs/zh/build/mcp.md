---
title: MCP Server
description: 为 Agent 连接远程 MCP Server，选择工具、加载方式，并传递运行时 context。
source: /en/build/mcp
source_hash: 01df4204b1bdf2c7b17187fb646911e181fa2804cfa4d4872986f97ae0d32692
---

# MCP Server

MCP Server 为 Agent 提供运行在远程基础设施上的工具。每个 Server 都声明在 Agent 的
`resource.mcp` 数组里。平台读取它的工具目录，把选中的工具提供给模型，并直接调用远程 endpoint。

如果操作应由你的应用执行并返回结果，请使用[应用执行的 custom tool](./tools.md#应用执行的自定义工具)。
如果操作应由平台直接调用远程 Server，请使用 MCP。

## 连接 Server

下面的配置从一个 Server 暴露 `quote` 和 `inventory` 两个工具：

```ts
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

`mcp` 是 Agent 配置的一部分。更新时会整体替换这个数组，因此需要同时带上 Agent 应继续使用的
其他 Server。

每个声明接受以下字段：

| 字段 | 作用 |
|---|---|
| `name` | Server 名称，用于生成工具名。名称中不能包含下划线。 |
| `url` | 远程 MCP endpoint 的绝对 URL。 |
| `transport` | `streamable-http` 或 `sse`，默认是 `streamable-http`。 |
| `toolFilter` | 要暴露的原始工具名。省略时暴露完整目录。 |
| `exposure` | `deferred` 或 `direct`，控制工具定义何时进入模型 context。 |
| `context` | 决定工具调用是否携带 Agent 和 Session 标识。 |
| `permission` | 这个 Server 上工具的默认审批策略。 |
| `tools` | 按原始工具名覆盖审批策略。 |

`permission` 和 `tools` 的配置方式见[权限策略](./permissions.md)。

## 选择 MCP 工具

`toolFilter` 使用 MCP Server 返回的原始工具名，不包含 ZooWork 添加的前缀。
例如，`pricing` Server 的原始工具名是 `quote`，模型和事件流看到的名称是：

```text
mcp__pricing__quote
```

省略 `toolFilter` 会暴露目录里的所有工具。当 Agent 只需要 Server 的一部分能力时，建议明确列出工具名，
这样 Server 后续新增工具也不会自动扩大 Agent 的工具范围。

Agent 的 [`tool_policy`](./tools.md#用-tool_policy-收窄工具集) 可以继续按带前缀的名称，
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

```ts
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

`meta: true` 会在每次 MCP 工具调用中添加 `_meta["ai.zooclaw/context"]`。
`headers: true` 会添加对应的 `x-zooclaw-*` HTTP header。context 包含 `agentId`、
`sessionId` 和 `computerId`；可用时还会包含 `runId`、`turn`、`configVersion` 和 `actorUid`。

两个选项都默认是 `false`。工具目录发现发生在具体工具调用之前，因此不携带运行时 context。
这些标识只提供请求上下文，不能作为调用方已经通过鉴权的证明。

## 连接要求

远程 HTTP endpoint 需要能从公网访问，并接受平台发出的免鉴权请求。公共 API 通过
`streamable-http` 或 SSE 连接，不会附带已存储的 credential。

URL 不能指向 loopback、私有网络或 cloud metadata 地址，也不能经过 redirect。
平台在读取 Server 工具目录时执行这些检查。

## 处理连接错误

如果平台无法读取某个 Server 的工具目录，这个 Server 的工具不会出现在当前回合中。
事件流可能包含 `agent.error`，其中 `kind` 有以下取值：

- `mcp_connection_failed`：无法连接 endpoint。
- `mcp_authentication_failed`：endpoint 拒绝了请求。

payload 还包含 `server`、`errorMessage`，也可能包含 `reason`。保留未知的 `reason` 值，
以兼容后续新增的错误原因。目录连接错误不能说明业务工具已经执行，因此不要只根据这个事件重放业务操作。

## 相关

- [权限策略](./permissions.md)——决定哪些 MCP 调用需要审批。
- [工具](./tools.md)——配置内置工具和应用执行的工具。
- [事件与流式](./events.md)——观察 MCP 调用和连接错误。

## 检查你的理解

::: details MCP Server 配置在哪里？
配置在 Agent 的 `resource.mcp` 数组里。每个 Session 不需要单独创建 MCP 资源。
:::

::: details `toolFilter` 和 `tool_policy` 有什么区别？
`toolFilter` 从一个 MCP Server 中选择原始工具。`tool_policy` 在 MCP 工具加上
`mcp__<server>__<tool>` 前缀后，继续收窄 Agent 的完整工具范围。
:::

::: details 运行时 context 能完成鉴权吗？
不能。它只提供 Agent 和 Session 等请求标识，鉴权仍由 MCP Server 自己负责。
:::
