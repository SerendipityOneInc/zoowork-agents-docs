---
description: Control built-in tools, declare application and MCP tools, and observe their events.
---

# Tools

An agent runs inside a managed sandbox with a built-in tool set already available to the
model. You choose how much of that set it may reach. You may also declare custom tools that
your application executes, or remote MCP servers that the platform calls. Observe built-in
and MCP activity through `agent.tool`; custom calls use `agent.custom_tool_use`.

## Application-executed custom tools

Declare a custom tool when the model should pause mid-turn, ask your application to do some
work, and continue with the result. The platform publishes the declaration to the model but
does not execute the tool itself.

::: warning Source-reviewed, not deployment-verified
The SDK types, methods, events, validation rules, and public routes below are covered by
offline contract tests. This review did not run the loop against a live deployment.
:::

### Declare the tool

`resource.custom_tools` is replace-on-write. A declaration has a name, description, object
JSON Schema, and optional result timeout:

```ts
const agent = await zc.createAgent({
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

The corresponding Python resource uses the same wire fields:

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

An Agent accepts at most 32 custom tools. `name` matches
`^[a-zA-Z0-9_-]{1,64}$`, must be unique, and cannot shadow a built-in, MCP, memory, or
runtime-reserved tool. `description` is non-empty and at most 4 KiB. `input_schema` must
have `type: 'object'` and is at most 16 KiB. `timeoutMs` defaults to 600,000 ms and is at
most 86,400,000 ms. Invalid declarations return `400 invalid_request`.

### Execute and return a result

The requested event is `agent.custom_tool_use`. The TypeScript `customToolUse()` helper and
Python `custom_tool_use()` helper expose its `callId`, name, input, and timeout:

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

`listCustomToolCalls(agentId, { status: 'pending' })` and
`list_custom_tool_calls(agent_id, status="pending")` recover pending work after an
application restart. `pending` is the only list filter.

The Session API is the other result path: post a `user.custom_tool_result` event with
`custom_tool_use_id` (or `call_id`), `content`, optional `is_error`, and a stable
`idempotency_key`. Result content contains 1–16 text, JSON, or base64 image blocks. Text is
limited to 256 KiB total; one image to 4 MiB of base64; all blocks together to 8 MiB. Images
accept PNG, JPEG, GIF, or WebP.

While waiting, `run_status` is `awaiting_approval`. Check
`pending_custom_tool_calls` rather than assuming that status means a normal approval. A
pending REST resolution returns `202` with `signaled: true`; the row remains pending until
the run consumes it. An already completed, timed-out, or cancelled call returns `200` with
`signaled: false`. Unknown calls return 404, another Agent's call returns 403, a stopped run
returns 409, and a deployment without result signaling returns 501.

## The built-in tool set

The tool manifest is defined by the platform, not by your code. It is not enumerated here,
because a list we cannot verify is worse than no list: you would design against names that
may not match what your deployment ships.

Observe the real set instead. Run a turn that needs tools and read the tool names off the
event stream:

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

`toolCall(ev)` returns `undefined` for every event that is not `agent.tool`, so it doubles
as the type guard.

To audit a session after the fact, filter the REST read instead:

```ts
const toolEvents = await zc.listAllEvents(agentId, sessionId, { types: ['agent.tool'] })
```

::: warning `listEvents` returns one page
`listEvents` answers a single page - 100 events by default, 500 at most - and a long session
truncates silently: there is no error, no `has_more`, and no total. `listAllEvents` walks the
cursor for you. See [Events and streaming](./events.md).
:::

## Narrowing the tool set with `tool_policy`

`tool_policy` lives on the agent resource. An empty object means the full manifest, so a
plain agent has every built-in tool. A non-empty object is read as an allow/deny policy that
narrows the surface.

```ts
await zc.createAgent({
  resource: {
    name: 'research-bot',
    model: { primary: 'litellm/gpt-5.6-terra' },
    tool_policy: { allow: ['read', 'web_search'] },
  },
})
```

Three things to know before you rely on it.

**It is replace-on-write.** Every other section of the agent document is merged per section
by `updateAgent`, so omitting a section preserves it. `tool_policy` is the exception: each
PUT replaces it wholesale. To restore the full manifest, send `{}`:

```ts
await zc.updateAgent(agentId, { tool_policy: {} })
```

**Every PUT bumps `config_version`**, including one that changes nothing, so do not re-PUT the
policy on every turn. See [Errors and retries](../reference/errors.md).

**The identifiers are platform-defined.** `read` and `web_search` above come from the
platform's own request examples. Confirm the names your deployment uses by running a turn and
reading `toolCall(ev).toolName`, as shown above.

### Tool-name patterns

Source review shows that policy entries have three supported forms:

- `*` matches every tool.
- `read` matches that exact tool name.
- `mcp__pricing__*` matches every tool whose name starts with `mcp__pricing__`.

Only one trailing `*` has prefix semantics. Other placements such as `mcp__*__quote` or
`*search` match nothing. The same matching rules apply to `allow`, `deny`, rule `match` and
`afterRules`, plus deferred MCP `pinned` entries. `alsoAllow` is deliberately narrower: its
entries are always exact names. When several policy rules could apply, the first matching rule
wins.

This matters for MCP because one server exposes several native names under the common
`mcp__<server>__` prefix. Use an exact entry for one MCP tool and a trailing-prefix entry only
when you intend to cover every tool from that server.

::: warning Not yet verified
We have exercised `tool_policy: {}` (the default) end to end. We have not verified that a
non-empty allow/deny policy takes effect on a live run, so treat a narrowed policy as
unconfirmed until you have watched `agent.tool` events for a turn that should have been
blocked.
:::

The agent resource also accepts `sandbox: { scope: 'agent' | 'session' }`. The field is
accepted by the API; we have not exercised either value, so it is not documented further
here. What is *installed* in the sandbox is governed by the
[Environment](./environments.md), not by `tool_policy`.

## Reading tool activity

One tool call produces a sequence of `agent.tool` events that share a `toolCallId`, one per
phase: `start`, `end`, and `blocked`. Pair `start` and `end` by `toolCallId`, not by
adjacency. When the model issues several calls concurrently, their events interleave. What
each phase carries is in [Events and streaming](./events.md).

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

## A failing tool does not fail the run

An `agent.tool` event with `isError: true` is still followed by `run.finished` with
`payload.status === 'succeeded'`. Gate on `runOutcome()` for the turn outcome, and treat
`isError` as diagnostics.

## Remote MCP servers

Use a remote MCP server when the capability should run on server-managed infrastructure.
Declare it on the agent through `resource.mcp` on `createAgent`, and in the same position on
`updateAgent`. It is a typed field, `mcp?: McpServerDeclaration[]`, so the entry shape is
checked at compile time. Use `custom_tools` instead when your application owns execution and
can return the result while the run waits.

```ts
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'pricing',              // appears in every tool name; no underscores
      url: 'https://mcp.example.com/pricing',
      transport: 'streamable-http', // or 'sse'; this is the default
      toolFilter: ['quote'],        // omit to expose all of the server's tools
      exposure: 'deferred',         // default; use 'direct' for the first model request
      context: { meta: true },      // opt in to runtime identifiers in MCP request metadata
      permission: 'always_ask',     // default for this server's tools
      tools: {
        quote: { permission: 'always_allow' }, // exact native MCP tool name
      },
    },
  ],
})
```

- Only **remote HTTP** servers are in scope. There is no stdio server inside the sandbox, and
  no OAuth flow.
- The `url` must be absolute and publicly reachable: loopback addresses, private ranges, cloud
  metadata addresses and redirects are refused.
- MCP tools surface to the model, and to you, under the name `mcp__<server>__<tool>`. That
  prefix in a `toolCall(ev).toolName` is how you confirm the server was actually reached.
- `exposure` controls when those tools enter the model context. Omit it or set `deferred` to
  keep them behind `tool_search` / `tool_describe` until loaded. Set `direct` to declare them
  on the first model request. There is no `auto` value. Once a deferred tool is loaded, it
  remains available on later turns in that same Session. These loading details are
  source-reviewed, not deployment-verified here.
- Healthy catalogs remain pinned per `config_version`. Source-reviewed failure behavior:
  transient failed catalogs can expire, allowing a later catalog resolution to probe again.
  Expiry is deployment-configured, not a periodic retry or recovery guarantee.
- A failed probe can leave the turn without that server's tools and emit `agent.error` with
  `kind: 'mcp_connection_failed'` or `'mcp_authentication_failed'`, `server`, `errorMessage`
  and optional `reason`. Preserve unknown reasons. These additions are not live-verified
  here and do not justify automatic retries of business tool calls.
- It is declared on the agent and nowhere else: there is no MCP resource of its own, and no
  session-level override.

### Runtime context is opt-in

An MCP declaration may opt into runtime identifiers through `context.meta`,
`context.headers`, or both. Both default to `false` when omitted.

`meta: true` adds an `_meta["ai.zooclaw/context"]` object to each MCP tool call. `headers: true`
adds the corresponding `x-zooclaw-*` HTTP headers. The context contains `agentId`, `sessionId`
and `computerId`, plus `runId`, `turn`, `configVersion` and `actorUid` when available. Treat
these values as request context, not authorization: authenticate the caller independently.

Catalog discovery does not carry runtime context because it happens before a tool call has a
Session context. HTTP intermediaries can also remove custom headers, so prefer `meta` when the
MCP server must work through an intermediary. These details are source-reviewed and have not
been verified against a deployment.

### Approval defaults and per-tool overrides

`permission` sets a server-wide default of `always_ask` or `always_allow`. `tools` overrides
that default for exact native MCP tool names, before the `mcp__<server>__<tool>` prefix is added.
Wildcard keys are not accepted in `tools`, and a declaration may carry at most 64 overrides.
When both fields are omitted, the effective default is `always_allow`.

`toolFilter` and permissions solve different problems: the filter decides which server tools
are exposed; permissions decide whether an exposed call asks for approval. An allow-always
decision made against the server-wide wildcard applies to every tool from that server for the
rest of the Session. Use an exact per-tool policy when that broader scope is not intended.

These fields are source-reviewed. The end-to-end approval flow remains unverified, so the
warning below still applies.

::: danger Public servers only
`credential` names a stored bearer token, but there is nowhere to store one - the credential
endpoint answers 404 through the gateway, by design. A server that requires authentication
cannot be made to work today. Declare unauthenticated servers only.
:::

This path is server-hosted, unauthenticated, and pinned per `config_version`. Do not design a
product around it as a drop-in replacement for client-executed tools.

## Human approval needs deployment verification

`agent.tool` has a third phase, `blocked`: the call is waiting on an approval and has not run,
and an `end` event still follows once the approval resolves.

::: warning Not yet verified
The approval round trip and turn-budget behavior have not been verified here. Do not enable
a dangerous capability assuming an untested approval flow will gate it. Source-reviewed
fields include `requested_at`, `arguments_preview`, `allowed_decisions` and optional
timeout/resolution fields. A 202 receipt with `signaled: true` can still be `pending`;
acceptance is not completed tool execution.

`ZooworkClient` does have `listApprovals` and `resolveApproval`, but they drive the separate
approvals REST resource, not the `user.tool_confirmation` event loop.

See the [capability matrix](../reference/capabilities.md) for the current status of this surface.
:::

## Related

- [Events and streaming](./events.md) - the event vocabulary, the opaque resume cursor, and
  `run.finished`.
- [Skills](./skills.md) - packaged capabilities attached to an agent, which are a different
  mechanism from tools.
- [Environments](./environments.md) - what is installed in the sandbox the tools run in.
- [Not supported](../reference/not-supported.md) - the full list of gaps, including this one.
