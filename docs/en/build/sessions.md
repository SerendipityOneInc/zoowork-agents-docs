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

There is no top-level `/sessions` collection: a session exists only under its agent, and the
agent id threads through every call. Code written against an API where sessions are top-level
will not compile here until you pass the agent id through.

All examples on this page use one client:

```ts
import {
  createZooclawClient,
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

## Create a session

```ts
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Summarize the attached brief.' }],
  metadata: { source: 'my-app', tenant: 'acme' },
})

console.log(session.session_id)   // "ses_example"
console.log(session.session_key)  // "api:ses_example"
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

`createSession` takes an optional third argument, sent as the `Idempotency-Key` header.
Replaying the same key returns the existing session instead of creating a second one and
running the opening turn twice. [Errors and retries](/en/reference/errors) has the rules for
choosing and reusing a key.

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

`postEvents` returns `202` and an object wrapping the per-event results:
`{ events: [{ id?, type?, accepted? }] }` - the array is under `events`, not the response
itself. Acceptance means the event was queued, not that the turn has finished. A turn ends
when you see `run.finished`, whose `payload.status` is `succeeded`, `failed`, or `aborted` -
see [Events and streaming](/en/build/events).

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
  "session_key": "api:ses_example",
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
| `pending_approvals` | Count of tool calls waiting on an approval. Expect `0` - the approval loop is not verified. |
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
      "responseModel": "qwen35-122B",
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
  `responseModel` is what served the request. A deployment can map a configured alias onto a
  substitute, so the two differ in the sample above. Trust `responseModel` when the answer
  feeds billing, evaluation, or a compliance record.

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

It exists because of the truncation above, and it is stricter than the obvious loop: it
de-duplicates across page boundaries, and it stops rather than spinning if the cursor fails to
advance. `pageSize` is the per-request `limit` (default and maximum 500); `after` and `types`
mean what they mean on `listEvents`.

`seq` is a durable, monotonic per-session sequence, so the same cursor also resumes an SSE
stream (`streamEvents({ after })`). `types` filters server-side and takes a list of event
types; it composes with `after` and `limit`.

## Not in the SDK

::: danger Not supported
`ZooclawClient` has no `patchSession`, and `PATCH` on a session answers `405`, which makes a
session's `metadata` write-once, at `createSession`.

Keep your own record of the `session_id` values you create - store them alongside whatever
they belong to in your application - and put anything you need to search on into `metadata`
at create time, because you cannot add it later.
:::

There is also no top-level session resource, so there is no way to list sessions across
agents. See [Not supported](/en/reference/not-supported) for the full boundary.

Per-agent listing and lifecycle do have methods - `listSessions(agentId, { page })`,
`archiveSession(agentId, sessionId)`, `deleteSession(agentId, sessionId)` - and none of them
changes the two paragraphs above: you still fan out across agents yourself, and `metadata` is
still write-once.
