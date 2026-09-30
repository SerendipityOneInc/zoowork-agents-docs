---
description: See the Agent's basic tools, configure custom and MCP tools, and control tool availability.
---

# Tools

An Agent comes with a managed [cloud sandbox](./cloud-sandbox-reference.md) and basic tools
for files, commands, and web access. These are **tools the Agent calls during a run**. The SDK
can allow or deny them through the Agent's `tool_policy`, but it does not directly invoke a
model tool by name. The separate SDK `exec(agentId, args)` method runs a command in an
agent-scope sandbox outside the Agent's tool loop. To reach your own systems, declare
application-executed custom tools or connect [MCP servers](./mcp.md).

## Basic Agent tools

These names are on the default tool surface for an active Agent with an empty `tool_policy`.
Visibility does not guarantee a call will succeed: the sandbox backend or web proxy must also
be available, and file access and network requests remain subject to their respective limits.

| Tool | What the Agent can do | Boundary |
|---|---|---|
| `read` | Read a sandbox file. | Relative paths resolve under `/workspace`. |
| `write` | Create or replace a sandbox file. | Writes must stay within declared writable roots. |
| `edit` | Change text in an existing sandbox file. | The same writable-root limit applies. |
| `apply_patch` | Apply a patch to sandbox files. | The same writable-root limit applies. |
| `exec` | Run a command in the sandbox. | The Environment controls installed software and sandbox network access. |
| `process` | Continue or stop a command started by `exec`. | Requires a process from the current Agent runtime. |
| `web_fetch` | Fetch and extract an HTTP(S) page. | Uses the platform proxy; it does not control a browser. |
| `web_search` | Search the web. | Uses the configured platform search service. |
| `web_image_search` | Search for images. | Uses the configured platform search service. |

See the [cloud sandbox reference](./cloud-sandbox-reference.md) for installed software and
resource sizes. Sandbox `networking` governs commands such as `curl` in `exec`; `web_fetch` and the
search tools use platform services outside that sandbox network path. Use `tool_policy` to
remove those web tools from the Agent's tool surface when necessary.

## Application-executed custom tools

Declare a custom tool when the model should pause mid-turn, ask your application to do some
work, and continue with the result. The platform publishes the declaration to the model but
does not execute the tool itself.

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
`signaled: false`. Unknown calls return 404, another Agent's call returns 403, and a stopped run
returns 409. If result signaling is not configured in the current environment, the endpoint
returns 501.

## Observe tool calls

The event stream records tools the Agent actually called. It does not enumerate every tool
available to that Agent. Use it to audit calls and to confirm the exact names observed in your
deployment.

Run a turn that needs tools and read the tool names from the event stream:

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

`tool_policy` lives on the Agent resource. An empty object applies no policy restriction;
runtime and configuration gates still decide which tools are visible. A non-empty object is
read as an allow/deny policy that narrows the surface.

ZooWork uses `allow` and `deny` names in `tool_policy`; it does not use a per-tool
`enabled` setting.

### Disable selected tools

For a new Agent, hide the three web tools while leaving other tools subject to their
normal runtime gates:

```ts
await zc.createAgent({
  resource: {
    name: 'report-agent-no-web-tools',
    tool_policy: { deny: ['web_fetch', 'web_search', 'web_image_search'] },
  },
})
```

For an existing Agent, replace its policy to hide one tool:

```ts
await zc.updateAgent(agentId, {
  tool_policy: { deny: ['web_search'] },
})
```

The update replaces the **entire** previous `tool_policy`. Include any other rules you
still need in the submitted object.

### Allow only selected tools

An `allow` list narrows the ordinary tool surface. This policy admits `read`, `write`,
and `exec` from that surface, subject to their normal runtime gates:

```ts
await zc.createAgent({
  resource: {
    name: 'report-agent',
    tool_policy: { allow: ['read', 'write', 'exec'] },
  },
})
```

If a name appears in both `allow` and `deny`, `deny` wins.
Special system turns can add contextual tools outside the ordinary surface.

These examples control the Agent's model tool surface. Denying web tools does not stop a
sandbox command started through `exec` from accessing the network; set the Environment's
`networking` policy for sandbox egress.

### Restore the default tool surface

To remove all policy restrictions and return to the runtime's default tool surface, send
`{}`:

```ts
await zc.updateAgent(agentId, { tool_policy: {} })
```

The default still depends on runtime and deployment configuration. Every PUT that names
`tool_policy` replaces that policy as a whole; omitting it preserves the existing policy.

Two more things to know before you rely on it.

**Every PUT bumps `config_version`**, including one that changes nothing, so do not re-PUT the
policy on every turn. See [Errors and retries](../reference/errors.md).

**The identifiers are platform-defined.** The table above lists the basic names. A turn's
`agent.tool` events confirm names actually called, but the absence of a name from those events
does not mean the tool was unavailable.

### Tool-name patterns

Policy entries accept three forms:

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

The agent resource also accepts `sandbox: { scope: 'agent' | 'session' }`. The field is
independent from tool availability. What is installed in the sandbox is governed by the
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

## Tool results and run outcomes

An `agent.tool` event with `isError: true` is still followed by `run.finished` with
`payload.status === 'succeeded'`. Gate on `runOutcome()` for the turn outcome, and treat
`isError` as diagnostics.

## Related

- [MCP servers](./mcp.md) - connect tools that run on remote MCP infrastructure.
- [Permission policies](./permissions.md) - choose which MCP calls require approval.
- [Events and streaming](./events.md) - the event vocabulary, the opaque resume cursor, and
  `run.finished`.
- [Skills](./skills.md) - packaged capabilities attached to an agent, which are a different
  mechanism from tools.
- [Environments](./environments.md) - what is installed in the sandbox the tools run in.

## Check your understanding

::: details Does `tool_policy` control approvals?
No. It controls which tools are available to the Agent. MCP approval behavior is configured
separately through [permission policies](./permissions.md).
:::

::: details When should I use a custom tool instead of MCP?
Use a custom tool when your application executes the operation and returns the result while the
run waits. Use MCP when the platform should call a remote MCP server directly.
:::

::: details How do I read tool and run results?
Read the tool event's `isError` for the call result and `runOutcome()` for the turn result. A
run can succeed after the model handles a tool error.
:::
