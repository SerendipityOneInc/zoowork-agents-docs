# Sessions

A session is one conversation with one agent. You create it, post `user.message` events
into it, and read the agent's work back out as events or as a transcript. The agent keeps
the conversation server-side - you never resend prior turns.

Every session route is nested under an agent:

```
POST   /agents/{agent_id}/sessions
GET    /agents/{agent_id}/sessions/{session_id}
POST   /agents/{agent_id}/sessions/{session_id}/events
GET    /agents/{agent_id}/sessions/{session_id}/events
```

The SDK mirrors that nesting in its signatures, so `agentId` is the first argument of every
session call:

```ts
createSession(agentId, input, idempotencyKey?)
getSession(agentId, sessionId, opts?)
postEvents(agentId, sessionId, events)
listEvents(agentId, sessionId, opts?)
```

In Claude Managed Agents sessions are a top-level resource with the agent named in the body,
so code ported from Claude will not compile here until you thread the agent id through -
see [Porting from Claude](/en/reference/from-claude-managed-agents).

All examples on this page use one client:

```ts
import {
  createZooclawClient,
  ZooclawError,
  assistantText,
  isRunFinished,
  runOutcome,
  messageText,
  type SessionEvent,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const agentId = process.env.AGENT_ID!
```

## Precondition: the agent must be running

`createSession` fails on an agent that is not running:

```
409  error.type = "agent_not_running"
```

A newly created agent comes back stopped, so you have to call `startAgent` yourself. Gate on
`status.desired_state === 'running'`; `status.actual_state` reports chat-channel connectivity,
and an API-only agent has no channels, so it stays at `activating` forever and polling it
never returns.

```ts
const agent = await zc.getAgent(agentId)
if (agent.status?.desired_state !== 'running') {
  await zc.startAgent(agentId)
}
```

`startAgent` takes well under a second. It returns a `warnings` array; an API-only agent
reports `channel_routes_reload_failed` on every start because it has no chat-channel routes
to reload. That is expected noise, not a failure.

Match on `error.type`, never on the message text:

```ts
try {
  await zc.createSession(agentId, {
    initial_events: [{ type: 'user.message', content: 'Hello.' }],
  })
} catch (e) {
  if (e instanceof ZooclawError && e.type === 'agent_not_running') {
    await zc.startAgent(agentId)
    // retry
  } else {
    throw e
  }
}
```

## Create a session

```ts
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Summarize the attached brief.' }],
  metadata: { source: 'my-app', tenant: 'acme' },
})

console.log(session.session_id)   // "ses_example"
console.log(session.session_key)  // "api:example"
```

Creating with `initial_events` starts the first turn immediately - there is no separate
"send" step for the opening message.

**`initial_events` accepts only `user.message`.** No other event type is valid there; post
everything else with `postEvents` after the session exists. The API accepts at most 50
initial events. `content` is verified as a plain string.

`metadata` is an arbitrary JSON object stored with the session and echoed back by
`getSession`. It is yours to use for correlation - a tenant id, a request id, the name of
the surface the conversation came from. Nothing in the platform interprets it.

### Idempotency-Key

`createSession` takes an optional third argument, sent as the `Idempotency-Key` header:

```ts
const session = await zc.createSession(
  agentId,
  { initial_events: [{ type: 'user.message', content: userInput }] },
  `chat-${incomingMessageId}`,
)
```

This protects against the retry that follows a timeout or a dropped connection: if you never
saw the response but the server did create the session, replaying the same key returns the
existing session instead of creating a second one and running the opening turn twice. Derive
the key from something stable in your own system, not from a random value generated at call
time. Reusing a key with a different request body is a conflict, not a replay.

The event write path has no idempotency key. `postEvents` retried after a timeout can deliver
the same message twice; de-duplicate on your side before you retry.

## Multi-turn

To continue a conversation, post another `user.message` to the same session. Do not resend
the history - the agent holds it server-side.

```ts
async function runTurn(sessionId: string, after = 0) {
  let text = ''
  let lastSeq = after
  let outcome: string | undefined
  for await (const ev of zc.streamEvents(agentId, sessionId, { after })) {
    lastSeq = ev.seq
    text += assistantText(ev)
    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
  return { text, lastSeq, outcome }
}

// Turn 1 - opens with the session.
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'My display name is Ada.' }],
})
const first = await runTurn(session.session_id)
console.log(first.outcome, first.text)   // "succeeded" ...

// Turn 2 - same session, new message. Resume the stream from the last seq you saw.
await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'What is my display name?' },
])
const second = await runTurn(session.session_id, first.lastSeq)
console.log(second.text)                 // mentions "Ada"
```

`postEvents` returns `202` with one entry per event: `{ id?, type?, accepted? }`. Acceptance
means the event was queued, not that the turn has finished. A turn ends when you see
`run.finished`, whose `payload.status` is `succeeded`, `failed`, or `aborted`. The event
stream is session-scoped and does not close between turns - see
[Events and streaming](/en/build/events).

The write path accepts four event types: `user.message`, `user.interrupt`, `system.message`,
and `user.tool_confirmation`.

## Read a session

```ts
const s = await zc.getSession(agentId, session.session_id)
```

Observed response:

```json
{
  "session_id": "ses_example",
  "session_key": "api:example",
  "channel": "api",
  "run_status": "succeeded",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "metadata": { "source": "sdk-capability-probe" },
  "archived": false,
  "status": null,
  "pending_approvals": 0
}
```

| Field | Meaning |
|---|---|
| `session_id` | The id you pass to every other session call. |
| `session_key` | Channel-qualified key. Sessions you create through the API are `api:<session_id>`. |
| `channel` | `api` for sessions created through this API. |
| `run_status` | The state of the most recent run - this is the field you want. |
| `updated_at` | ISO timestamp of the last change. |
| `metadata` | Exactly what you passed to `createSession`. |
| `archived` | Boolean. |
| `pending_approvals` | Count of tool calls waiting on an approval. |
| `status` | Always `null`. See below. |

::: danger `status` is null - read `run_status`
`status` comes back as `null` on every read, including sessions whose last run finished
successfully. It is not a state machine you can poll. The live field is `run_status`
(observed value: `"succeeded"`). Code that branches on `session.status` will take the same
branch forever.
:::

Responses may carry additional fields beyond those listed. Ignore what you do not recognize
rather than failing on it.

## The transcript: `getSession({ history: true })`

Passing `history: true` adds the at-rest transcript, read from the session's stored
conversation rows:

```ts
const s = await zc.getSession(agentId, session.session_id, { history: true, limit: 20 })

for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  const msg = row.entry.message as { role?: string }
  console.log(row.seq, msg.role, messageText(row.entry.message))
}
```

Each entry is `{ seq, entry_type, entry, created_at }`. For `entry_type: 'message'` the
conversation lives at `entry.message` as `{ role, content }`, where `content` is an array of
blocks and only `{ type: 'text', text }` blocks carry text. `messageText()` handles both the
array and the plain-string form.

`limit` is the number of most recent rows to return, default 100, maximum 500. Rows come back
in ascending `seq` order.

An observed assistant row:

```json
{
  "seq": 2,
  "entry_type": "message",
  "entry": {
    "type": "message",
    "message": {
      "role": "assistant",
      "model": "litellm/claude-sonnet-5",
      "usage": {
        "input": 15212,
        "output": 40,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 15252,
        "cost": { "input": 0, "output": 0, "total": 0 }
      },
      "content": [
        { "type": "text", "text": "" },
        { "type": "thinking", "thinking": "..." },
        { "type": "text", "text": "\n\nPROBE-ONE" }
      ],
      "stopReason": "stop"
    }
  },
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

Two things this buys you that nothing else does:

- **Token usage.** `entry.message.usage` is the only place a turn's token counts are exposed.
  Note that `usage.cost` is `0` on staging - do not build a spend display on it.
- **The model that actually answered.** `model` is what the agent is configured with;
  `responseModel` is what served the request. On staging these differ, because staging maps
  some models to a substitute. Trust `responseModel`.

This is the transcript, not the event log. It holds conversational messages, not
`run.started` / `agent.tool` / `run.finished`. Use it to recover an answer whose events you
missed; use `listEvents` when you want the event stream. Other `entry_type` values exist
(session anchors, compaction markers, model changes); filter for `message` and skip the rest.

## `listEvents` and pagination

`listEvents` returns the durable event log for a session, normalized to a single
`SessionEvent` shape (`seq`, `eventType`, `payload`, `runId`, `turn`, `createdAt`).

```ts
const events = await zc.listEvents(agentId, session.session_id, {
  types: ['agent.assistant'],
})
```

::: warning One page per call - long sessions truncate silently
The server returns **100 events by default and at most 500**, and `listEvents` returns one
page. There is no `has_more` flag and no error: a session with 900 events answers with the
first 100 and looks complete. Anything that reconstructs a whole conversation must page.
:::

`listAllEvents` is that paging loop. It walks the `after` cursor - the `seq` of the last event
it received - until a page comes back shorter than the limit it asked for:

```ts
const all: SessionEvent[] = await zc.listAllEvents(agentId, session.session_id)
```

It exists because of the truncation above, and it is stricter than the obvious loop in two
places: events at or below the cursor are dropped, so a page boundary cannot duplicate an
event, and the walk stops if the highest `seq` in a page fails to advance the cursor, so a
server that ignored `after` returns a duplicate page instead of spinning forever. `pageSize`
is the per-request `limit` (default and maximum 500); `after` and `types` mean what they mean
on `listEvents`.

`seq` is a durable, monotonic per-session sequence, so the same cursor also resumes an SSE
stream (`streamEvents({ after })`). `types` filters server-side and takes a list of event
types; it composes with `after` and `limit`.

## Not in the SDK

::: danger Not supported
`ZooclawClient` has no `patchSession`. `PATCH` on a session answers `405` through the gateway -
its catch-all registers GET/POST/PUT/DELETE only, so PATCH is not proxied at all - which makes
a session's `metadata` write-once, at `createSession`.

Keep your own record of the `session_id` values you create - store them alongside whatever
they belong to in your application - and put anything you need to search on into `metadata`
at create time, because you cannot add it later.
:::

There is also no top-level session resource, so there is no way to list sessions across
agents. See [Not supported](/en/reference/not-supported) for the full boundary.

Per-agent listing and lifecycle do have methods - `listSessions(agentId, { page })`,
`archiveSession(agentId, sessionId)`, `deleteSession(agentId, sessionId)` - and none of them
changes the two paragraphs above: you still fan out across agents yourself, and `metadata` is
still write-once. The [capability matrix](/en/reference/capabilities) records how far each of
the three has been driven.
