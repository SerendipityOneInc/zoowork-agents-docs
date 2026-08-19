# Core concepts

ZooClaw Managed Agents has three primitives. Everything you build sits on top of them.

| Primitive | What it is | Addressed as |
|---|---|---|
| **Agent** | A persistent, versioned configuration plus a lifecycle. | `agent_id` |
| **Session** | A persistent conversation belonging to one agent. | `agent_id` + `session_id` |
| **Event** | One durable, sequenced thing that happened in a session. | `seq` within a session |

There is no separate Run resource. A run exists inside a session and you observe it through
events (`run.started`, `run.finished`), but you never create, fetch, or list one.

Sandbox templates are a separate optional resource called an Environment. You pin one on the
agent if you need custom packages or a network allowlist; you do not interact with it at
runtime. See [Environments](/en/build/environments).

All examples on this page use the TypeScript SDK:

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...
```

See [Authentication](/en/get-started/authentication) for where the key comes from.

## Agent

An agent is a configuration object that outlives any conversation. You create it once and reuse
it across sessions, users, and days.

### What it owns

The configuration you submit is the **declared** config. It holds:

- `name` and `model` (`{ primary: 'litellm/...' }`)
- `persona.docs[]` - the instruction documents the model reads every turn (`AGENTS.md`,
  `SOUL.md`, `IDENTITY.md`, ...)
- `tool_policy` - which built-in tools the agent may use; `{}` means the full manifest
- `labels` - free-form string key/values for your own bookkeeping
- `skills` (at create time), `mcp` declarations, `system_prompt`, `outcome`, `sandbox.scope`,
  `environment_id` / `environment_version`

It also owns a `status` block, which is state the server maintains and you only read.

`POST /agents` answers with a flat create receipt. `GET` and `PUT` answer with a projection:
configuration under `declared`, version under `status.config_version`. Read the version as
`agent.status?.config_version ?? agent.config_version` and one expression works for both. See
[Agents](/en/build/agents) for the two shapes side by side.

### Lifecycle

```text
createAgent() --> [stopped] --startAgent()--> [running] --stopAgent()--> [stopped]
                                                  |
                                            deleteAgent()
```

A newly created agent is **stopped**. Nothing about the create call starts it, and until
`startAgent()` returns, `createSession()` fails with `409 agent_not_running`. See
[Quickstart](/en/get-started/quickstart).

```ts
const { warnings } = await zc.startAgent(agentId)
// warnings is informational, e.g. channel_routes_reload_failed on an API-only agent
```

`stopAgent()` is the same shape. The `warnings` array is informational; do not retry on it.

`deleteAgent()` is a soft delete: it does not stop the agent, cancel in-flight work, delete
schedules, or release its sandbox. Call `stopAgent()` first. See [Agents](/en/build/agents).

### `desired_state` vs `actual_state`

The `status` block carries two state fields. They mean completely different things, and only
one of them gates the API.

| Field | Values | What it tells you |
|---|---|---|
| `desired_state` | `running` \| `stopped` \| `deleted` | Whether the API will accept session calls. **This is the one you wait on.** |
| `actual_state` | `activating` \| `active` \| `degraded` \| `error` \| `stopped` \| `deleting` | Chat-channel connectivity. Nothing to do with API readiness. |

`actual_state` reports whether the agent's chat-channel routes are connected. An agent you
drive only through the API has no channels, so it stays at `activating` forever. And `running`
is not a member of the `actual_state` enum at all - so the natural-looking loop below never
returns:

```ts
// WRONG - hangs forever on an API-only agent
while ((await zc.getAgent(agentId)).status?.actual_state !== 'running') {
  await new Promise((r) => setTimeout(r, 1000))
}
```

Poll `desired_state` instead. It flips to `running` in well under a second, and the SDK has
the loop already:

```ts
await zc.waitUntilRunning(agentId)
```

`waitUntilRunning()` polls `desired_state` on a 30-second budget, 500 ms apart, and throws a
`ZooclawError` with `status === 408` and `type === 'timeout'` if the agent never gets there.
See [Agents](/en/build/agents).

A full turn completes normally on an agent whose `actual_state` never leaves `activating`.

### `config_version`

`config_version` is a monotonic integer describing which rendered configuration snapshot is in
effect. A turn that is already running keeps its snapshot; the next turn picks up the new one.

What it is not is a receipt. Every successful `PUT` bumps it, including a PUT whose body is
byte-identical to the current configuration, and `updateAgent()` takes no expected-version
parameter, so you cannot use `config_version` to deduplicate retries or to detect "did my write
land". After a write times out, `getAgent()` and compare `declared` instead. See
[Errors](/en/reference/errors).

`upgradeSystemPrompt()` is the one call that does take an expected version: it requires
`expected_config_version` and answers `409 config_version_changed` if the agent has moved on.

`updateAgent()` merges one level deep per section: sections you omit are preserved. Two sections
are the exception and are replaced wholesale on every write - `tool_policy`, where `{}` clears
it back to the full tool manifest, and `system_prompt`, where a partial write replaces the whole
pin and drops whatever the previous declaration carried. See [Tools](/en/build/tools).

## Session

A session is a persistent conversation that belongs to exactly one agent. The path is nested,
and so is the SDK signature:

```ts
const session = await zc.createSession(agentId, {
  metadata: { source: 'my-app' },
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
session.session_id  // 'ses_...'
session.session_key // 'api:...'
```

`POST /agents/{agent_id}/sessions`. Every session call carries the agent id first:
`createSession(agentId, input)`, `postEvents(agentId, sessionId, events)`,
`listEvents(agentId, sessionId, opts)`, `streamEvents(agentId, sessionId, opts)`.

`createSession` accepts an `Idempotency-Key` as a third argument; retrying with the same key
converges on the first session rather than creating a second one. See
[Errors](/en/reference/errors).

### What it owns

The session owns the conversation history, server-side. You do not assemble a message array,
you do not manage a context window, and you do not resend prior turns. Post the new user
message and the agent already has the rest.

Two read surfaces:

```ts
// The event log - what happened, in order.
const events = await zc.listEvents(agentId, session.session_id)

// The at-rest transcript - the conversation itself.
const s = await zc.getSession(agentId, session.session_id, { history: true, limit: 100 })
s.history?.forEach((row) => {
  // row.entry_type === 'message' -> row.entry.message is { role, content }
})
```

Use `listEvents` when you want the event stream. Use `getSession({ history: true })` to recover
an answer whose events you missed.

### Lifecycle

A session is created, accumulates turns for as long as you keep posting to it, and stays
readable afterwards. It does not expire at the end of a turn.

`ZooclawClient` has no `patchSession`, so a session's `metadata` is write-once at
`createSession` - put anything you will need to search on in there when you create it. See
[Sessions](/en/build/sessions).

Per-agent listing and lifecycle do have methods - `listSessions(agentId)`,
`archiveSession(agentId, sessionId)`, `deleteSession(agentId, sessionId)`. There is still no
top-level session collection, so keep your own `session_id` records for anything you need to
reach across agents.

A session you create through the API and a conversation the same agent is having inside the
ZooClaw app are two separate conversations. API sessions carry a `session_key` beginning with
`api:`; app conversations live on a different channel. They do not share history, and the model
in one cannot see what was said in the other. Prototyping an agent's persona in the app is
useful; expecting the API session to remember that chat is not.

## Event

An event is the unit of everything that happens inside a session. The log is append-only and
durably sequenced by `seq`, a monotonic per-session integer. `seq` is what makes the stream
resumable: every SSE frame carries it in the `id:` line, and `?after=<seq>` replays from there
server-side.

Reach into `payload` as little as possible. The SDK ships typed readers for the shapes that
matter, and they return an empty value for events of the wrong type:

```ts
import {
  assistantText, // text of an agent.assistant event
  thinkingText,  // text of an agent.thinking event
  toolCall,      // the tool call carried by an agent.tool event
  isRunFinished, // true for run.finished
  runOutcome,    // 'succeeded' | 'failed' | 'aborted' for run.finished
} from '@zooclaw-agents/sdk'
```

### Events you write

Four inbound types, and everything else is rejected: `user.message` starts a turn,
`user.interrupt` aborts the in-flight run, `system.message` is an out-of-band note the model
reads on the following turn (its field is `text`, not `content`), and `user.tool_confirmation`
resolves a pending tool approval. See [Events and streaming](/en/build/events) for the body
shapes.

```ts
const res = await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'What changed in the report?' },
])
res.events[0]?.accepted // true
```

`postEvents` answers `202` with `{ events: [...] }` - one `{ id, type, accepted }` entry per
submitted event.

`user.interrupt` against a live run is accepted (`accepted: true`) and that run ends with
`run.finished` carrying `status: 'aborted'`. With no run in flight it returns
`accepted: false` - a no-op, not an error, and not something to retry.

::: warning Not yet verified
The approval loop has not been driven end to end. Treat human-in-the-loop approval as
unavailable for now: an agent blocked on an approval will time the turn out. See
[Capabilities](/en/reference/capabilities).
:::

Only `content` as a plain string has been verified for `user.message`. Rich content blocks are
untested.

### Events you read

The outbound vocabulary is larger. It is exported as `SESSION_EVENT_TYPES`.

| Type | Meaning |
|---|---|
| `run.started` | A turn began. |
| `run.finished` | A turn ended. `payload.status` is `succeeded` \| `failed` \| `aborted`. |
| `agent.lifecycle` | Internal phase marker inside the run. |
| `agent.item` | A new item was added to the turn. |
| `agent.thinking` | Reasoning text; read with `thinkingText(e)`. |
| `agent.assistant` | Assistant message; read with `assistantText(e)`. |
| `agent.tool` | A tool call. Read with `toolCall(e)`. |
| `agent.approval` | A tool call is waiting on approval. |
| `agent.error` | An error inside the run. |
| `chat.delta` | Preview frames on a non-durable lane. The SDK stream skips them. |
| `chat.final`, `chat.aborted`, `chat.error` | Chat-channel terminal frames. |
| `agent.plan`, `agent.command_output`, `agent.patch`, `agent.compaction` | Further detail about what the agent did during the run. |
| `attachment.created` | An attachment was produced. |
| `message.outbound` | A message was dispatched to a chat channel. |

We have observed `run.*`, `agent.lifecycle`, `agent.item`, `agent.thinking`, `agent.assistant`
and `agent.tool` in ordinary API turns. The remaining types are in the vocabulary and pass
through the SDK unchanged, but did not appear in our runs. Unknown types are never thrown on -
the API may add types within a version, so switch on `eventType` with a default branch.

`agent.tool` has three phases, not two:

| Phase | Meaning |
|---|---|
| `start` | The call began; `args` is populated. |
| `end` | The call returned; `isError` and `resultPreview` are populated. |
| `blocked` | The call is waiting on an approval and has **not** run. |

An `agent.tool` event with `isError: true` is still followed by `run.finished` with
`succeeded`. Never infer turn success from the absence of tool errors - read `runOutcome(e)`.

### Two wire shapes

REST spells the fields in snake_case (`event_type`, `run_id`, `created_at`) and SSE in camelCase
(`eventType`, `runId`, `createdAt`); neither carries a top-level `type` field. The SDK
normalizes both into one `SessionEvent`, and exports `normalizeEvent` for the case where you
call the HTTP API directly. See [Events and streaming](/en/build/events).

::: warning listEvents returns one page
The server default is 100 events and the maximum is 500. `listEvents` returns a single page -
a long session silently truncates with no error. Use `zc.listAllEvents(agentId, sessionId)`,
which walks the pages for you.
:::

## How a turn works

A turn is one user message and everything the agent does in response. You start it by writing
an event; you know it is over when you read `run.finished`.

```text
you                                    ZooClaw
 |
 |-- postEvents(user.message) --------> 202 { accepted: true }
 |                                        |
 |                                        run.started
 |                                        agent.lifecycle
 |                                        agent.item
 |<-- streamEvents(...) ----------------- agent.thinking
 |                                        agent.assistant
 |                                        agent.tool   phase: start   \  repeats
 |                                        agent.tool   phase: end     /  per call
 |                                        agent.lifecycle
 |<-- run.finished { status: succeeded } -+
 |
 |  ... the stream stays open. Post the next user.message on the same session.
```

Do not hardcode the order or the count - `run.finished` is the only reliable terminator.

Driving one turn end to end:

```ts
import { assistantText, isRunFinished, runOutcome } from '@zooclaw-agents/sdk'

const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Summarize today in one sentence.' }],
})

const ctl = new AbortController()
setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: string | undefined
let lastSeq = 0

for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
  lastSeq = ev.seq
  text += assistantText(ev)
  if (isRunFinished(ev)) {
    outcome = runOutcome(ev) // 'succeeded' | 'failed' | 'aborted'
    break
  }
}
ctl.abort()

console.log(outcome, text)
```

The next turn goes to the same session, and the stream picks up where you stopped:

```ts
await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'Now say it in French.' },
])

for await (const ev of zc.streamEvents(agentId, session.session_id, { after: lastSeq })) {
  if (isRunFinished(ev)) break
}
```

Passing `after: lastSeq` is also how you recover from a dropped connection: reconnect with the
last `seq` you processed and the server resumes from there. The SDK does not reconnect on your
behalf.

The stream is session-scoped, not turn-scoped. It does not close when `run.finished` arrives -
break out of the loop yourself - and the server closes it once the session goes idle.

## Where to go next

- [Quickstart](/en/get-started/quickstart) - key to first reply.
- [Agents](/en/build/agents) - the full configuration surface.
- [Sessions](/en/build/sessions) - session options and reads.
- [Events and streaming](/en/build/events) - payload shapes, resume, and filtering.
- [Errors](/en/reference/errors) - matching on `ZooclawError.type`.
- [Not supported](/en/reference/not-supported) - check here before designing around a capability.
