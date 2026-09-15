---
title: 权限策略
description: 配置 MCP 工具是直接执行还是等待审批，并设置 Server 默认值和逐工具覆盖。
source: /en/build/permissions
source_hash: 865c449bbb424218d1dd5cca41b061e6213b7bbd65a0f412544047d015964c0b
---

# 权限策略

权限策略决定一个已经暴露的 MCP 工具是直接执行，还是先暂停并等待审批。
在 MCP Server 声明中通过 `permission` 和 `tools` 配置。

权限策略只作用于 MCP 工具。内置工具是否可用由
[`tool_policy`](./tools.md#用-tool_policy-收窄工具集) 控制。应用执行的 custom tool 仍由你的应用决定是否执行。

## 策略取值

| 策略 | 行为 |
|---|---|
| `always_allow` | MCP 工具直接执行，不请求审批。 |
| `always_ask` | 工具在执行前暂停，并创建一条 pending approval。 |

一个 Server 同时省略 `permission` 和 `tools` 时，默认策略是 `always_allow`。

## 设置 Server 默认策略

在 MCP 声明上设置 `permission`，可以为这个 Server 的工具指定同一个默认策略：

```ts
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'github',
      url: 'https://mcp.example.com/github',
      permission: 'always_ask',
    },
  ],
})
```

这个配置会在调用 `github` 暴露的任何工具前请求审批。注意，更新 `mcp` 会整体替换 Server 数组，
因此需要同时带上 Agent 应保留的其他声明。

## 覆盖单个工具

使用 `tools`，可以按原始 MCP 工具名覆盖 Server 默认策略：

```ts
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'github',
      url: 'https://mcp.example.com/github',
      permission: 'always_ask',
      tools: {
        get_issue: { permission: 'always_allow' },
        list_issues: { permission: 'always_allow' },
      },
    },
  ],
})
```

这里的 key 是 MCP Server 返回的名称，例如 `get_issue`，不是加前缀后的
`mcp__github__get_issue`。key 按精确名称匹配，不接受通配符。一个 Server 最多配置 64 条覆盖。

## 工具可用与执行审批是两件事

这些配置在不同阶段生效：

| 配置 | 它回答的问题 |
|---|---|
| MCP Server 上的 `toolFilter` | 这个 Server 的哪些原始工具会暴露出来？ |
| Agent 上的 `tool_policy` | 哪些工具对 Agent 可用？ |
| MCP Server 上的 `permission` 和 `tools` | 一个已暴露的 MCP 调用是否需要审批？ |

从 `toolFilter` 移除工具后，模型不能再选择它。设置 `always_ask` 不会隐藏工具，
而是在模型选择它以后、实际执行以前暂停调用。

## 处理 pending approval

等待审批的 MCP 调用会产生一个 `phase: 'blocked'` 的 `agent.tool` 事件。
先列出这个 Agent 的 pending approval，再处理选中的记录：

```ts
const approvals = await zc.listApprovals(agentId, { status: 'pending' })

for (const approval of approvals) {
  if (!approval.approval_id) continue

  console.log(approval.tool_name, approval.arguments_preview)

  await zc.resolveApproval(agentId, approval.approval_id, {
    decision: 'allow-once',
    resolvedBy: 'user_42',
  })
}
```

注意，运行时 decision 使用连字符，而配置项使用下划线：

| Decision | 作用 |
|---|---|
| `allow-once` | 只允许这一次调用。 |
| `allow-always` | 在当前 Session 剩余时间内，允许匹配这条 approval scope 的调用。 |
| `deny` | 拒绝这次调用，不执行工具。 |

如果 approval record 包含 `allowed_decisions`，你的 UI 只应提供其中列出的选项。
`resolvedBy` 是可选 metadata，用于记录作出决定的人或服务。

resolve 请求可能返回 `202` 和 `signaled: true`，而记录仍然是 `status: 'pending'`。
这表示处理结果已经进入投递流程。继续读取事件流，直到工具进入 `end`，并收到本回合的 `run.finished`。

Session 事件也会提供 `agent.approval`，并接受 `user.tool_confirmation`。
REST approval record 和 Session event payload 的字段名、大小写风格不同，请使用当前接口返回的 id 和字段名。
详见[事件与流式](./events.md#usertool_confirmation)。

## Custom tool 由应用控制

权限策略不会执行或审批 `custom_tools`。Agent 发出 `agent.custom_tool_use` 后，
你的应用先决定是否执行请求，再返回 `user.custom_tool_result` 或调用 `resolveCustomToolCall()`。

## 相关

- [MCP Server](./mcp.md)——连接和选择远程工具。
- [工具](./tools.md)——配置内置工具和应用执行的工具。
- [事件与流式](./events.md)——跟踪 blocked 调用和回合结束。

## 检查你的理解

::: details Server 没有配置 permission 时会怎样？
它的 MCP 工具使用 `always_allow`。
:::

::: details `always_ask` 会向模型隐藏工具吗？
不会。工具仍然可用，只是在执行前暂停并等待审批。
:::

::: details 权限策略会作用于 custom tool 吗？
不会。custom tool 由你的应用执行，你的应用决定是否处理每次请求。
:::
