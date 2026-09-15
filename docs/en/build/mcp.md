---
description: Connect an Agent to remote MCP servers, select tools, choose when they load, and pass runtime context.
---

# MCP servers

An MCP server gives an Agent tools that run on remote infrastructure. Declare each server in
the Agent's `resource.mcp` array. The platform reads its tool catalog, exposes the selected
tools to the model, and executes calls against the remote endpoint.

Use an [application-executed custom tool](./tools.md#application-executed-custom-tools) when
your own application should run the operation and return its result. Use MCP when the platform
should call the remote server directly.

## Connect a server

The following configuration exposes the `quote` and `inventory` tools from one server:

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

`mcp` is part of the Agent configuration. An update replaces the complete array, so include
every server the Agent should keep using.

Each declaration accepts these fields:

| Field | Purpose |
|---|---|
| `name` | Server name used in generated tool names. It must not contain underscores. |
| `url` | Absolute URL of the remote MCP endpoint. |
| `transport` | `streamable-http` or `sse`. The default is `streamable-http`. |
| `toolFilter` | Exact native tool names to expose. Omit it to expose the complete catalog. |
| `exposure` | `deferred` or `direct`; controls when tool definitions enter model context. |
| `context` | Opts into Agent and Session identifiers on tool calls. |
| `permission` | Default approval policy for tools from this server. |
| `tools` | Approval-policy overrides for exact native tool names. |

See [Permission policies](./permissions.md) for `permission` and `tools`.

## Select MCP tools

`toolFilter` contains the names reported by the MCP server, before ZooWork adds a prefix.
When `pricing` exposes a native tool named `quote`, the model and event stream see it as:

```text
mcp__pricing__quote
```

Omit `toolFilter` to expose every tool in the catalog. Use it when an Agent needs only part of
a server, especially when the server may add more tools later.

The Agent's [`tool_policy`](./tools.md#narrowing-the-tool-set-with-tool_policy) can further
limit the combined tool surface by matching the prefixed name.

## Choose when tools load

`exposure` controls when the model receives MCP tool definitions.

| Value | Behavior |
|---|---|
| `deferred` | Default. Tools stay behind `tool_search` and `tool_describe` until the model loads them. |
| `direct` | Tool definitions are included in the first model request. |

A deferred tool that has been loaded remains available on later turns in the same Session.
Use `direct` for a small set of tools needed on nearly every turn. Use `deferred` for larger
catalogs to keep the initial context smaller.

## Pass runtime context

MCP calls can include identifiers for the current Agent and Session:

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

`meta: true` adds `_meta["ai.zooclaw/context"]` to each MCP tool call. `headers: true` adds
the corresponding `x-zooclaw-*` HTTP headers. The context contains `agentId`, `sessionId`, and
`computerId`, plus `runId`, `turn`, `configVersion`, and `actorUid` when available.

Both settings default to `false`. Catalog discovery carries no runtime context because it
happens before an individual tool call. Treat these identifiers as request context, not as
proof that the caller is authorized.

## Connection requirements

Configure a remote HTTP endpoint that is publicly reachable and accepts unauthenticated
requests from the platform. The public API connects through `streamable-http` or SSE and does
not attach stored credentials.

The URL cannot use loopback, private-network, or cloud-metadata addresses. Redirects are also
rejected. These checks apply when the platform resolves the server catalog.

## Handle connection errors

If the platform cannot load a server catalog, that server's tools are absent from the turn.
The event stream can include `agent.error` with one of these `kind` values:

- `mcp_connection_failed`: the endpoint could not be reached.
- `mcp_authentication_failed`: the endpoint rejected the request.

The payload also includes `server`, `errorMessage`, and may include `reason`. Preserve unknown
`reason` values so your integration remains forward-compatible. A catalog error does not prove
that a business tool call ran, so do not replay business operations from this event alone.

## Related

- [Permission policies](./permissions.md) - decide which MCP calls require approval.
- [Tools](./tools.md) - configure built-in and application-executed tools.
- [Events and streaming](./events.md) - observe MCP calls and connection errors.

## Check your understanding

::: details Where is an MCP server configured?
In the Agent's `resource.mcp` array. There is no separate MCP resource to create for each
Session.
:::

::: details What is the difference between `toolFilter` and `tool_policy`?
`toolFilter` selects native tools from one MCP server. `tool_policy` limits the Agent's combined
tool surface after MCP tool names receive their `mcp__<server>__<tool>` prefix.
:::

::: details Does runtime context authenticate the caller?
No. It supplies request coordinates such as Agent and Session ids. Authorization remains the
MCP server's responsibility.
:::
