---
description: Connect an Agent to remote MCP servers, select tools, choose when they load, and pass runtime context.
---

# MCP servers

A Model Context Protocol (MCP) server gives an Agent tools that run on remote infrastructure. Declare each server in
the Agent's `resource.mcp` array. The platform reads its tool catalog, exposes the selected
tools to the model, and executes calls against the remote endpoint.

Use an [application-executed custom tool](./tools.md#application-executed-custom-tools) when
your own application should run the operation and return its result. Use MCP when the platform
should call the remote server directly.

Examples reuse the client and Agent from [Quickstart](../get-started/quickstart.md). Python calls run inside an async function. For curl, complete the environment setup in [Authentication](../get-started/authentication.md).

## Connection requirements

Configure a remote HTTP endpoint that is publicly reachable and accepts unauthenticated
requests from the platform. The public API connects through `streamable-http` or SSE and does
not attach stored credentials.

The URL cannot use loopback, private-network, or cloud-metadata addresses. Redirects are also
rejected. These checks apply to catalog discovery and tool execution.

The public API does not provide MCP credential provisioning, automatic OAuth setup, or a
managed private-network tunnel. Runtime context is not a substitute for authentication. For
a private or authenticated service your backend already accesses, use an
[application-executed custom tool](./tools.md#application-executed-custom-tools).

## Connect a server

The following configuration exposes the `quote` and `inventory` tools from one server:

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

`mcp` is part of the Agent configuration. An update replaces the complete array, so include
every server the Agent should keep using.

Each declaration accepts these fields:

| Field | Purpose |
|---|---|
| `name` | Unique server name matching `^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$`. It must not contain underscores. |
| `url` | Absolute URL of the remote MCP endpoint. |
| `transport` | `streamable-http` or `sse`. The default is `streamable-http`. |
| `toolFilter` | Up to 64 exact native tool names to expose. Omit it to expose the complete catalog. |
| `exposure` | `deferred` or `direct`; controls when tool definitions enter model context. |
| `context` | Opts into Agent and Session identifiers on tool calls. |
| `permission` | Default approval policy for tools from this server. |
| `tools` | Up to 64 approval-policy overrides for exact native tool names, including optional `requireConfirmation`. |

See [Permission policies](./permissions.md) for `permission` and `tools`.

An Agent can declare up to 16 MCP servers. Keep server names short: the complete tool name
`mcp__<server>__<tool>` must match `^[a-zA-Z0-9_-]{1,64}$`. A native tool whose prefixed name
exceeds that limit is omitted from the catalog.

## Select MCP tools

`toolFilter` contains the names reported by the MCP server, before ZooWork adds a prefix.
When `pricing` exposes a native tool named `quote`, the model and event stream see it as:

```text
mcp__pricing__quote
```

Omit `toolFilter` to expose every tool in the catalog. Use it when an Agent needs only part of
a server, especially when the server may add more tools later.

The Agent's [`tool_policy`](./tools.md#narrowing-the-tool-set-with-tool-policy) can further
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

`meta: true` adds `_meta["ai.zooclaw/context"]` to each MCP tool call. `headers: true` adds
the corresponding `x-zooclaw-*` HTTP headers. The context contains `agentId`, `sessionId`, and
`computerId`, plus `runId`, `turn`, `configVersion`, and `actorUid` when available.

Both settings default to `false`. Catalog discovery carries no runtime context because it
happens before an individual tool call. Treat these identifiers as request context, not as
proof that the caller is authorized.

## Handle connection errors

If the platform cannot load a server catalog, that server's tools are absent from the turn.
The event stream can include `agent.error` with one of these `kind` values:

- `mcp_connection_failed`: the endpoint could not be reached.
- `mcp_authentication_failed`: the endpoint rejected the request.

The payload also includes `server`, `errorMessage`, and may include `reason`. Preserve unknown
`reason` values so your integration remains forward-compatible. A catalog error does not prove
that a business tool call ran, so do not replay business operations from this event alone.

## Refresh a catalog after a server change

A successful catalog is pinned to the Agent's configuration version. Starting another Session
with the same configuration does not discover tools added to that server later.

Temporary connection failures keep an error catalog for a bounded period. The default is
five minutes, but the deployment can use a different value. After it expires, the next catalog
resolution retries the server. Permanent failures remain pinned until the Agent uses a new
configuration version.

After fixing a permanent error or changing the server's tool set, update the Agent's MCP
configuration to create a new version. Include the complete server array. Do this when the
configuration changes, rather than issuing a PUT on every turn: even an identical PUT bumps
`config_version`. See [Agents](./agents.md#every-put-bumps-the-version).

## Catalog limits

The platform reads the server's full `tools/list` response before applying `toolFilter`.
Selecting two tools does not make an oversized server catalog acceptable.

| Limit | Maximum |
|---|---|
| Tools returned by one server | 128 |
| `tools/list` pages per server | 8 |
| Input schema per tool | 64 KiB |
| Serialized catalog per server | 256 KiB |
| Combined tools across the Agent's admitted catalogs | 256 |
| Combined serialized catalogs | 1 MiB |

Tool descriptions longer than 32 KiB are truncated. Oversized input schemas or catalogs fail
catalog discovery rather than being partially accepted. Combined budgets are applied in
server-name order. When a server exceeds a budget, its tools are absent and a connection
error can be reported.

Expose a smaller catalog from your MCP server when it exceeds these limits. `toolFilter`
controls exposure after discovery; it does not reduce the server's discovery budget.

## Related

- [Permission policies](./permissions.md) - decide which MCP calls require approval.
- [Tools](./tools.md) - configure built-in and application-executed tools.
- [Connect a knowledge base](./retrieval.md) - expose document search through MCP or a custom tool.
- [Events and streaming](./events.md) - observe MCP calls and connection errors.
