---
description: Control whether MCP tools run immediately or wait for approval, with server defaults and per-tool overrides.
---

# Permission policies

A permission policy determines whether an exposed MCP tool runs immediately or waits for an
approval. Configure it on an MCP server declaration with `permission` and `tools`.

Permission policies apply to MCP tools. Built-in tool availability is controlled by
[`tool_policy`](./tools.md#narrowing-the-tool-set-with-tool_policy). Application-executed
custom tools remain under your application's control.

## Policy values

| Policy | Behavior |
|---|---|
| `always_allow` | The MCP tool runs without asking for approval. |
| `always_ask` | The call pauses before execution and creates a pending approval. |

When a server declaration omits both `permission` and `tools`, its effective default is
`always_allow`.

## Set the server default

Set `permission` on the MCP declaration to apply one policy to the server's tools:

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

This configuration asks before every tool exposed by `github`. Remember that updating `mcp`
replaces the complete server array; include the other declarations the Agent should retain.

## Override individual tools

Use `tools` to override the server default for exact native MCP tool names:

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

The keys are the names reported by the MCP server, such as `get_issue`, not the prefixed name
`mcp__github__get_issue`. Keys do not accept wildcards. One server declaration can contain up
to 64 overrides.

## Availability and approval are separate

These settings act at different stages:

| Setting | Question it answers |
|---|---|
| `toolFilter` on an MCP server | Which native tools from this server are exposed? |
| `tool_policy` on the Agent | Which tools are available to the Agent? |
| `permission` and `tools` on an MCP server | Does an exposed MCP call require approval? |

Removing a tool from `toolFilter` prevents the model from selecting it. Setting
`always_ask` leaves the tool available but pauses each selected call before execution.

## Resolve a pending approval

An MCP call waiting for approval appears as an `agent.tool` event with `phase: 'blocked'`.
List pending approvals for the Agent and resolve the selected record:

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
payload use different casing. See [Events and streaming](./events.md#usertool_confirmation).

## Custom tools use application control

Permission policies do not execute or approve `custom_tools`. When the Agent emits
`agent.custom_tool_use`, your application decides whether to run the requested operation before
returning `user.custom_tool_result` or calling `resolveCustomToolCall()`.

## Related

- [MCP servers](./mcp.md) - connect and select remote tools.
- [Tools](./tools.md) - configure built-in and application-executed tools.
- [Events and streaming](./events.md) - follow blocked calls and turn completion.

## Check your understanding

::: details What happens when a server has no permission configuration?
Its MCP tools use `always_allow`.
:::

::: details Does `always_ask` hide a tool from the model?
No. The tool remains available. Its call pauses for approval before execution.
:::

::: details Do permission policies apply to custom tools?
No. Your application owns custom-tool execution and decides whether to run each request.
:::
