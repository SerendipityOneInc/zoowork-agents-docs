# Tools

An agent runs inside a managed sandbox with a built-in tool set already available to the
model. You do not register tools, and you do not implement them. You choose how much of the
built-in set the agent may reach, and you observe what it actually called by reading
`agent.tool` events off the session stream.

Read this page before you design your product, because the most important thing on it is a
gap.

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
below, and read the honesty note there before you build on it.

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
const toolEvents = await zc.listEvents(agentId, sessionId, { types: ['agent.tool'] })
```

::: warning listEvents returns one page
The server default is 100 events and the maximum is 500, and `listEvents` returns a single
page. A long session truncates silently, with no error. Page with the `after` cursor:

```ts
const all = []
let after = 0
for (;;) {
  const page = await zc.listEvents(agentId, sessionId, { after, limit: 500 })
  if (page.length === 0) break
  all.push(...page)
  after = page[page.length - 1]!.seq
}
```
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
  ownership: { owner_uid: 'usr_example', org_id: 'org_example' },
})
```

Three things to know before you rely on it.

**It is replace-on-write.** Every other section of the agent document is merged per section
by `updateAgent`, so omitting a section preserves it. `tool_policy` is the exception: each
PUT replaces it wholesale. To restore the full manifest, send `{}`:

```ts
await zc.updateAgent(agentId, { tool_policy: {} })
```

**Every PUT bumps `config_version`**, including one that changes nothing. Do not use the
version as an idempotency receipt, and do not re-PUT the policy on every turn.

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

One tool call produces a sequence of `agent.tool` events that share a `toolCallId`, one per phase:

| `phase` | Carries | Meaning |
|---|---|---|
| `start` | `args` | The call was issued. |
| `end` | `isError`, `resultPreview` | The call finished. |
| `blocked` | - | The call is waiting on an approval and has **not** run. |

Pair `start` and `end` by `toolCallId`, not by adjacency. When the model issues several
calls concurrently, their events interleave.

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

A typical single turn that uses tools produces this arc, in order:

```
run.started
agent.lifecycle
agent.item
agent.thinking
agent.assistant
agent.tool (start) / agent.tool (end)   x N
agent.lifecycle
run.finished  payload.status = succeeded
```

See [Events and streaming](/en/build/events) for the full event vocabulary and the resume
cursor.

## A failing tool does not fail the run

An `agent.tool` event with `isError: true` is still followed by `run.finished` with
`payload.status === 'succeeded'`. The model sees the error and usually works around it, and
the turn completes normally.

The consequence: **you cannot infer success from the absence of tool errors, and you cannot
infer failure from their presence.** Gate on `run.finished` for the turn outcome, and treat
`isError` as diagnostics.

```ts
import { runOutcome } from '@zooclaw-agents/sdk'

let toolFailures = 0
for await (const ev of zc.streamEvents(agentId, sessionId)) {
  if (toolCall(ev)?.isError) toolFailures += 1
  if (isRunFinished(ev)) {
    console.log(`turn ${runOutcome(ev)}, ${toolFailures} tool errors along the way`)
    break
  }
}
```

## Remote MCP servers

The one way to give an agent a capability you wrote is to run a remote MCP server and declare
it on the agent. The declaration goes in `resource.mcp` on `createAgent`, and in the same
position on `updateAgent`. `AgentResource` accepts unknown keys, so the field passes through
the SDK unchanged.

What we can state:

- Only **remote HTTP** servers are in scope. There is no stdio server inside the sandbox, and
  no OAuth flow.
- MCP tools surface to the model, and to you, under the name `mcp__<server>__<tool>`. That
  prefix in a `toolCall(ev).toolName` is how you confirm the server was actually reached.
- The catalog is pinned per `config_version`, so changing the declaration takes effect on the
  next turn, not the current one.
- There is no MCP REST resource and no credential vault. Session-level MCP overrides are
  rejected.

::: warning Not yet verified
We have not connected a remote MCP server end to end. The declaration field is accepted by the
API, and the platform's own documentation still describes the worker side of this path as not
production-wired.

We are deliberately not printing an example `resource.mcp[]` entry, because we have not run
one and would be guessing at the field names. Budget time to discover the entry schema
yourself, and do not plan a product around this path on the assumption that it is a drop-in
replacement for client-executed tools.
:::

## Human approval is not usable end to end

`agent.tool` has a third phase, `blocked`: the call is waiting on an approval and has not run.
The matching `agent.approval` event carries the request, and an `end` event still follows once
the approval resolves. On the write side, `user.tool_confirmation` is one of the four accepted
event types.

::: warning Not yet verified
The approval loop does not work end to end today, and you should not build a demo on it.

- We have never produced a real pending approval, so nothing on this path has been observed
  working.
- The write-side event and the platform's separate approvals REST resource describe the same
  operation with two different shapes, and they do not line up.
- `ZooclawClient` does have `listApprovals` and `resolveApproval`, but they drive that REST
  resource, not the `user.tool_confirmation` event loop. Without a Temporal signaler the route
  answers `501 not_configured`, and with no real pending approval ever produced to try them
  against, the round trip stays unproven.
- A run that blocks on an approval nobody answers does not wait for you. The turn times out.

If you see `phase: 'blocked'`, treat it as pending and expect the turn to end without the
tool having run. See the [capability matrix](/en/reference/capabilities) for the current status
of this surface.
:::

## Related

- [Events and streaming](/en/build/events) - the event vocabulary, the `seq` resume cursor, and
  `run.finished`.
- [Skills](/en/build/skills) - packaged capabilities attached to an agent, which are a different
  mechanism from tools.
- [Environments](/en/build/environments) - what is installed in the sandbox the tools run in.
- [Not supported](/en/reference/not-supported) - the full list of gaps, including this one.
