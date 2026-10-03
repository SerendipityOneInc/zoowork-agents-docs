---
title: 权限策略
description: 配置工具审批、MCP 默认策略、逐次确认，以及 pending approval 的处理。
source: /en/build/permissions
source_hash: 9055af066f027ee44fa97db60978014ace9b61ac07f92c7ff10220cce11ac4d4
---

# 权限策略

权限策略决定一个已暴露的工具是直接执行，还是先等待审批。`exec` 等工具使用
`tool_policy.permissions`；MCP Server 的默认策略和覆盖使用 `permission` / `tools`。
工具可用范围仍是另一层检查：审批策略不会启用已隐藏的工具。

对于 custom tool，平台可以在请求到达应用前进行检查。应用仍须授权并执行实际操作。

示例复用[快速开始](../get-started/quickstart.md)中的 client 和 Agent。Python 调用在 async 函数中运行。curl 先完成[鉴权](../get-started/authentication.md)中的环境变量设置。

## 策略取值

| 策略 | 行为 |
|---|---|
| `always_allow` | 已暴露的工具直接执行，不请求审批。 |
| `always_ask` | 工具在执行前暂停，并创建一条 pending approval。 |

没有 permission 条目的工具保留默认行为。一个 MCP 声明同时省略 `permission` 和 `tools` 时，
默认策略是 `always_allow`。`auto` 不是支持的 permission 值。

## 内置工具执行前请求审批

保留 Agent 已有的 policy，再给 `exec` 加上审批要求：

::: code-group

```ts [TypeScript]
const agent = await zc.getAgent(agentId)
const policy = (agent.declared?.tool_policy ?? {}) as Record<string, unknown>
const permissions = (policy.permissions ?? {}) as Record<string, unknown>

await zc.updateAgent(agentId, {
  tool_policy: {
    ...policy,
    permissions: { ...permissions, exec: 'always_ask' },
  },
})
```

```python [Python]
agent = await client.get_agent(agent_id)
policy = dict(agent.get("declared", {}).get("tool_policy") or {})
permissions = dict(policy.get("permissions") or {})
policy["permissions"] = {**permissions, "exec": "always_ask"}
await client.update_agent(agent_id, {"tool_policy": policy})
```

```bash [curl]
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
jq '{tool_policy: ((.declared.tool_policy // {}) |
  .permissions = ((.permissions // {}) + {exec:"always_ask"}))}' <<<"$agent" |
  curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' --data-binary @-
```

:::

每次包含 `tool_policy` 的 PUT 都会整体替换这个 policy。先读取再合并，可以避免意外移除其他设置。
如果已有手写 rule 匹配 `exec`，它优先于这里的 permission 条目；依赖新条目前先检查那条 rule。

## 设置 Server 默认策略

在 MCP 声明上设置 `permission`，可以为这个 Server 的工具指定同一个默认策略：

::: code-group

```ts [TypeScript]
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

```python [Python]
await client.update_agent(agent_id,
    {
        "mcp": [
            {
                "name": "github",
                "url": "https://mcp.example.com/github",
                "permission": "always_ask"
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
      "name": "github",
      "url": "https://mcp.example.com/github",
      "permission": "always_ask"
    }
  ]
}
JSON
```

:::

这个配置会在调用 `github` 暴露的任何工具前请求审批。注意，更新 `mcp` 会整体替换 Server 数组，
因此需要同时带上 Agent 应保留的其他声明。

## 覆盖单个工具

使用 `tools`，可以按原始 MCP 工具名覆盖 Server 默认策略：

::: code-group

```ts [TypeScript]
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

```python [Python]
await client.update_agent(agent_id,
    {
        "mcp": [
            {
                "name": "github",
                "url": "https://mcp.example.com/github",
                "permission": "always_ask",
                "tools": {
                    "get_issue": {
                        "permission": "always_allow"
                    },
                    "list_issues": {
                        "permission": "always_allow"
                    }
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
      "name": "github",
      "url": "https://mcp.example.com/github",
      "permission": "always_ask",
      "tools": {
        "get_issue": {
          "permission": "always_allow"
        },
        "list_issues": {
          "permission": "always_allow"
        }
      }
    }
  ]
}
JSON
```

:::

这里的 key 是 MCP Server 返回的名称，例如 `get_issue`，不是加前缀后的
`mcp__github__get_issue`。key 按精确名称匹配，不接受通配符。一个 Server 最多配置 64 条覆盖。

## 处理 pending approval

等待审批的工具调用会产生一个 `phase: 'blocked'` 的 `agent.tool` 事件。
列出 pending approvals，向有权审批的用户展示工具和参数，再让用户选择调用和 decision。
下面的 `requestApprovalDecision()` 是你的应用 UI 函数，不是 SDK 方法。
它返回 `approvalId` 和 `allow-once`、`allow-always`、`deny` 之一。
只展示这个用户有权处理的记录，以及该记录允许的 decisions。

::: code-group

```ts [TypeScript]
import { requestApprovalDecision } from './approval-ui.js'

const approvals = await zc.listApprovals(agentId, { status: 'pending' })
const { approvalId, decision } = await requestApprovalDecision(approvals)
const approval = approvals.find((item) => item.approval_id === approvalId)
if (!approval) throw new Error('Select a pending approval')
if (Array.isArray(approval.allowed_decisions) && !approval.allowed_decisions.includes(decision)) {
  throw new Error('This decision is not allowed for the selected call')
}

await zc.resolveApproval(agentId, approvalId, {
  decision,
  resolvedBy: 'user_42',
})
```

```python [Python]
from approval_ui import request_approval_decision

approvals = await client.list_approvals(agent_id, status="pending")
approval_id, decision = await request_approval_decision(approvals)
approval = next((item for item in approvals if item["approval_id"] == approval_id), None)
if approval is None:
    raise ValueError("Select a pending approval")
allowed = approval.get("allowed_decisions")
if isinstance(allowed, list) and decision not in allowed:
    raise ValueError("This decision is not allowed for the selected call")
await client.resolve_approval(
    agent_id, approval_id, decision=decision, resolved_by="user_42",
)
```

```bash [curl]
approvals=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/approvals?status=pending" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
printf '%s\n' "$approvals" | jq .
# Set these only after the authorized user selects a call and an allowed decision.
APPROVAL_ID='the-selected-approval-id'
DECISION='allow-once'
jq -n --arg decision "$DECISION" '{decision:$decision,resolvedBy:"user_42"}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/approvals/$APPROVAL_ID/resolve" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' --data-binary @-
```

:::

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
详见[事件与流式](./events.md#user-tool-confirmation)。

## 每次调用都要求确认

单个 MCP 工具需要每次作出新决定时，在 `always_ask` 旁设置 `requireConfirmation: true`：

::: code-group

```ts [TypeScript]
await zc.updateAgent(agentId, {
  mcp: [{
    name: 'documents',
    url: 'https://mcp.example.com/documents',
    tools: {
      delete_document: {
        permission: 'always_ask',
        requireConfirmation: true,
      },
    },
  }],
})
```

```python [Python]
await client.update_agent(agent_id,
    {
        "mcp": [
            {
                "name": "documents",
                "url": "https://mcp.example.com/documents",
                "tools": {
                    "delete_document": {
                        "permission": "always_ask",
                        "requireConfirmation": True
                    }
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
      "name": "documents",
      "url": "https://mcp.example.com/documents",
      "tools": {
        "delete_document": {
          "permission": "always_ask",
          "requireConfirmation": true
        }
      }
    }
  ]
}
JSON
```

:::

提交时包含 Agent 应保留的其他 MCP 声明。这个工具的审批只提供 `allow-once` 和 `deny`，
以前的 `allow-always` 不能代替这次确认。Block rule 仍然阻止调用，普通 allow rule 也不会移除确认要求。

`requireConfirmation` 必须是布尔值。与 `always_allow` 同时设置为 `true` 会被拒绝。
控制 Agent 配置的应用仍可移除这个设置，所以它是一条调用策略，不是组织级访问控制系统。

## 工具可用与执行审批是两件事

这些配置在不同阶段生效：

| 配置 | 它回答的问题 |
|---|---|
| MCP Server 上的 `toolFilter` | 这个 Server 的哪些原始工具会暴露出来？ |
| Agent 上的 `tool_policy.allow` / `deny` | 哪些工具对 Agent 可用？ |
| Agent 上的 `tool_policy.permissions` | 一个匹配的已暴露调用是否需要审批？ |
| MCP Server 上的 `permission` 和 `tools` | 一个已暴露的 MCP 调用是否需要审批？ |

从 `toolFilter` 移除工具后，模型不能再选择它。设置 `always_ask` 不会隐藏工具，
而是在模型选择它以后、实际执行以前暂停调用。

### 哪条策略优先？

普通调用规则按以下顺序考虑：

1. 手写的 `tool_policy.rules`。
2. `tool_policy.permissions` 条目。
3. 精确的 MCP 工具覆盖。
4. MCP Server 默认策略。

第一条匹配的普通 rule 决定调用。逐次确认在这个决定之后增加一层检查：
它保留 block，并对匹配 required 工具的已允许调用要求重新确认。

## Session grant 与 timeout

`allow-always` 在当前 Session 剩余时间内授权匹配的 rule。
如果 rule 是 Server 默认策略，授权可能覆盖同一个 Server 的其他工具，不会修改 Agent 存储的 policy。

生成的 `always_ask` rules 最多等待十分钟，超时后拒绝调用。
这个期限与 custom tool 的结果 timeout 是两回事。

## Custom tool 由应用控制

`tool_policy` 可以隐藏 custom tool，或要求在请求发出前审批。
Agent 发出 `agent.custom_tool_use` 后，应用先决定是否执行实际操作，
再返回 `user.custom_tool_result` 或调用 `resolveCustomToolCall()`。
平台审批不能代替应用对用户的授权和业务检查。

## 相关

- [MCP Server](./mcp.md)——连接和选择远程工具。
- [工具](./tools.md)——配置内置工具和应用执行的工具。
- [事件与流式](./events.md)——跟踪 blocked 调用和回合结束。
