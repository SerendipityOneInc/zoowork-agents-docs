---
description: Configure tool approvals, MCP defaults, per-call confirmation, and pending-approval resolution.
---

# Permission policies

A permission policy determines whether an exposed tool runs immediately or waits for approval.
Use `tool_policy.permissions` for tools such as `exec`, and `permission` / `tools` on an MCP
server for that server's defaults and overrides. Tool availability is still a separate check: an
approval policy does not enable a hidden tool.

For custom tools, the platform can gate the request before it reaches your application. Your
application must still authorize and execute the actual operation.

Examples reuse the client and Agent from [Quickstart](../get-started/quickstart.md). Python calls run inside an async function. For curl, complete the environment setup in [Authentication](../get-started/authentication.md).

## Policy values

| Policy | Behavior |
|---|---|
| `always_allow` | The exposed tool runs without asking for approval. |
| `always_ask` | The call pauses before execution and creates a pending approval. |

Tools without a permission entry keep their default behavior. When an MCP declaration omits
both `permission` and `tools`, its effective default is `always_allow`. `auto` is not a supported
permission value.

## Ask before a built-in tool runs

Preserve the Agent's existing policy, then add an approval requirement for `exec`:

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

Every PUT that includes `tool_policy` replaces the whole policy. Reading and merging avoids
accidentally removing other settings. If an existing hand-written rule already matches `exec`,
it takes precedence over this permission entry; review it before relying on the new entry.

## Set the server default

Set `permission` on the MCP declaration to apply one policy to the server's tools:

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

This configuration asks before every tool exposed by `github`. Remember that updating `mcp`
replaces the complete server array; include the other declarations the Agent should retain.

## Override individual tools

Use `tools` to override the server default for exact native MCP tool names:

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

The keys are the names reported by the MCP server, such as `get_issue`, not the prefixed name
`mcp__github__get_issue`. Keys do not accept wildcards. One server declaration can contain up
to 64 overrides.

## Resolve a pending approval

A tool call waiting for approval appears as an `agent.tool` event with `phase: 'blocked'`.
List pending approvals, show the authorized user the tool and arguments, and ask them to
select a call and a decision. `requestApprovalDecision()` below is your application's UI
function, not an SDK method. It returns an `approvalId` and one of `allow-once`, `allow-always`,
or `deny`. Present only records this user may review and decisions allowed by that record.

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

Runtime decisions use hyphens, unlike the underscore-separated configuration values:

| Decision | Effect |
|---|---|
| `allow-once` | Allow this call. |
| `allow-always` | Allow the matching approval scope for the rest of the Session. |
| `deny` | Reject this call without running the tool. |

When `allowed_decisions` is present on the approval record, offer only those decisions in your
UI. `resolvedBy` is optional metadata identifying the person or service that made the decision.

A resolve request can return `202` with `signaled: true` while the record still says
`status: 'pending'`. This means the resolution was accepted for delivery. Keep reading the
event stream until the tool reaches `end` and the turn reaches `run.finished`.

Session events also expose `agent.approval` and accept `user.tool_confirmation`. Use the id and
field names from the interface you are handling; the REST approval record and Session event
payload use different casing. See [Events and streaming](./events.md#user-tool-confirmation).

## Require confirmation for every call

Use `requireConfirmation: true` with `always_ask` on an individual MCP tool when each call
needs a fresh decision:

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

Include any other MCP declarations the Agent should retain. This tool's approval offers only
`allow-once` and `deny`; a previous `allow-always` does not satisfy it. A blocking rule still
blocks the call, and an ordinary allow rule does not remove the confirmation requirement.

`requireConfirmation` must be a boolean. Setting it to `true` with `always_allow` is rejected.
The application controlling the Agent configuration can remove the setting, so it remains a
call policy rather than an organization-level access-control system.

## Availability and approval are separate

These settings act at different stages:

| Setting | Question it answers |
|---|---|
| `toolFilter` on an MCP server | Which native tools from this server are exposed? |
| `tool_policy.allow` / `deny` on the Agent | Which tools are available to the Agent? |
| `tool_policy.permissions` on the Agent | Does a matching exposed call require approval? |
| `permission` and `tools` on an MCP server | Does an exposed MCP call require approval? |

Removing a tool from `toolFilter` prevents the model from selecting it. Setting
`always_ask` leaves the tool available but pauses each selected call before execution.

### Which policy takes precedence?

Ordinary call rules are considered in this order:

1. Hand-written `tool_policy.rules`.
2. Entries in `tool_policy.permissions`.
3. Exact MCP tool overrides.
4. The MCP server default.

The first matching ordinary rule decides the call. Per-call confirmation adds a separate
check after that decision: it keeps a block and requires fresh confirmation for an allowed
call that matches the required tool.

## Session grants and timeouts

An `allow-always` decision grants the matching rule for the rest of the Session. When the rule
is a server-wide default, that grant can cover other tools from the same server. It does not
change the Agent's stored policy.

Generated `always_ask` rules wait up to ten minutes and deny the call on timeout. This deadline
is separate from a custom tool's result timeout.

## Custom tools use application control

`tool_policy` can hide a custom tool or require approval before the request is emitted. When
the Agent emits `agent.custom_tool_use`, your application decides whether to run the actual
operation before returning `user.custom_tool_result` or calling `resolveCustomToolCall()`.
Platform approval does not replace your application's user authorization or business checks.

## Related

- [MCP servers](./mcp.md) - connect and select remote tools.
- [Tools](./tools.md) - configure built-in and application-executed tools.
- [Events and streaming](./events.md) - follow blocked calls and turn completion.
