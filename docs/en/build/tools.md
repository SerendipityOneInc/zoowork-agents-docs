# Tools

An agent runs inside a managed sandbox with a built-in tool set already available to the
model. You do not register tools, and you do not implement them. You choose how much of the
built-in set the agent may reach, and you observe what it actually called by reading
`agent.tool` events off the session stream.

## Client-executed custom tools do not exist

::: danger Not supported
There is no way to have the agent call a function in your process.

- No `{ type: 'custom' }` tool definition on the agent or the session.
- No `user.custom_tool_result` event, and no other write-side event that returns a tool
  result to the model.
- No callback, no webhook, no polling handshake that hands you a pending tool call to
  execute.

The session write side accepts exactly four event types: `user.message`,
`user.interrupt`, `user.tool_confirmation`, and `system.message`. A tool result is not
among them.

If your design is "the agent calls my function, my code queries my database, I hand the
answer back", that loop is not available. Pick one of the two paths below instead.
:::

This is the gap most likely to reshape a design. Code ported from a platform with
client-executed tools has nothing to compile against here.

### What to do instead

**Put the data in the prompt.** You control every turn, so you can fetch from your own
systems first and send the result as text. Both write paths work:

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const rows = await myDatabase.lookup(customerId) // your code, your process

await zc.postEvents(agentId, sessionId, [
  {
    type: 'user.message',
    content: `Customer record:\n${JSON.stringify(rows)}\n\nSummarize the open issues.`,
  },
])
```

`system.message` is the out-of-band variant. It is not shown as a user turn, and the model
reads it on the following turn:

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'system.message', text: 'Operator note: the user is on the enterprise plan.' },
])
```

Note the field name: `system.message` carries `text`, while `user.message` carries
`content`.

This covers the common case where you know in advance what the agent needs. It does not
cover the case where the model decides mid-turn that it wants something from you. For that,
the only path is a remote MCP server.

**Expose your capability as a remote MCP server.** See [Remote MCP servers](#remote-mcp-servers)
below. It works, and it is unauthenticated-only.

## The built-in tool set

The tool manifest is defined by the platform, not by your code. It is not enumerated here,
because a list we cannot verify is worse than no list: you would design against names that
may not match what your deployment ships.

Observe the real set instead. Run a turn that needs tools and read the tool names off the
event stream:

```ts
import { createZooclawClient, toolCall, isRunFinished } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

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
cursor for you. See [Events and streaming](/en/build/events).
:::

## Narrowing the tool set with `tool_policy`

`tool_policy` lives on the agent resource. An empty object means the full manifest, so a
plain agent has every built-in tool. A non-empty object is read as an allow/deny policy that
narrows the surface.

```ts
await zc.createAgent({
  resource: {
    name: 'research-bot',
    model: { primary: 'litellm/claude-sonnet-5' },
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
policy on every turn. See [Errors and retries](/en/reference/errors).

**The identifiers are platform-defined.** `read` and `web_search` above come from the
platform's own request examples. Confirm the names your deployment uses by running a turn and
reading `toolCall(ev).toolName`, as shown above.

::: warning Not yet verified
We have exercised `tool_policy: {}` (the default) end to end. We have not verified that a
non-empty allow/deny policy takes effect on a live run, so treat a narrowed policy as
unconfirmed until you have watched `agent.tool` events for a turn that should have been
blocked.
:::

The agent resource also accepts `sandbox: { scope: 'agent' | 'session' }`. The field is
accepted by the API; we have not exercised either value, so it is not documented further
here. What is *installed* in the sandbox is governed by the
[Environment](/en/build/environments), not by `tool_policy`.

## Reading tool activity

One tool call produces a sequence of `agent.tool` events that share a `toolCallId`, one per
phase: `start`, `end`, and `blocked`. Pair `start` and `end` by `toolCallId`, not by
adjacency. When the model issues several calls concurrently, their events interleave. What
each phase carries is in [Events and streaming](/en/build/events).

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

The one way to give an agent a capability you wrote is to run a remote MCP server and declare
it on the agent. The declaration goes in `resource.mcp` on `createAgent`, and in the same
position on `updateAgent`. It is a typed field, `mcp?: McpServerDeclaration[]`, so the entry
shape is checked at compile time.

```ts
await zc.updateAgent(agentId, {
  mcp: [
    {
      name: 'pricing',              // appears in every tool name; no underscores
      url: 'https://mcp.example.com/pricing',
      transport: 'streamable-http', // or 'sse'; this is the default
      toolFilter: ['quote'],        // omit to expose all of the server's tools
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
- The catalog is pinned per `config_version`, so changing the declaration takes effect on the
  next turn, not the current one.
- A server that fails its catalog probe does not fail the run. It pins an empty catalog and
  emits `agent.error` with `kind: 'mcp_connection_failed'`, so the turn proceeds without those
  tools.
- It is declared on the agent and nowhere else: there is no MCP resource of its own, and no
  session-level override.

::: danger Public servers only
`credential` names a stored bearer token, but there is nowhere to store one - the credential
endpoint answers 404 through the gateway, by design. A server that requires authentication
cannot be made to work today. Declare unauthenticated servers only.
:::

This path is server-hosted, unauthenticated, and pinned per `config_version`. Do not design a
product around it as a drop-in replacement for client-executed tools.

## Human approval is not usable end to end

`agent.tool` has a third phase, `blocked`: the call is waiting on an approval and has not run,
and an `end` event still follows once the approval resolves.

::: warning Not yet verified
A run that blocks on an approval nobody answers does not wait for you. The turn times out.

`ZooclawClient` does have `listApprovals` and `resolveApproval`, but they drive the separate
approvals REST resource, not the `user.tool_confirmation` event loop.

See the [capability matrix](/en/reference/capabilities) for the current status of this surface.
:::

## Related

- [Events and streaming](/en/build/events) - the event vocabulary, the `seq` resume cursor, and
  `run.finished`.
- [Skills](/en/build/skills) - packaged capabilities attached to an agent, which are a different
  mechanism from tools.
- [Environments](/en/build/environments) - what is installed in the sandbox the tools run in.
- [Not supported](/en/reference/not-supported) - the full list of gaps, including this one.
