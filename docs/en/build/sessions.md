---
description: Create, continue, list, archive, and delete sessions, then read their transcripts.
---

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
  createZooworkClient,
  assistantText,
  isRunFinished,
  runOutcome,
  messageText,
  type SessionEvent,
} from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

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
running the opening turn twice. [Errors and retries](../reference/errors.md) has the rules for
choosing and reusing a key.

The event write path takes a per-event key instead of a header: give each event an
`idempotency_key` (any stable string) and a `postEvents` retried after a timeout will not
deliver it twice.

## Multi-turn

To continue a conversation, post another `user.message` to the same session. Do not resend
the history - the agent holds it server-side.

```ts
async function runTurn(sessionId: string, cursor?: string) {
  let text = ''
  let outcome: string | undefined
  for await (const ev of zc.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
    cursor = ev.cursor ?? cursor
    text += assistantText(ev)
    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
  return { text, cursor, outcome }
}

// Turn 1 - opens with the session.
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'My display name is Ada.' }],
})
const first = await runTurn(session.session_id)
console.log(first.outcome, first.text)   // "succeeded" ...

// Turn 2 - same session, new message. Resume the stream from the last cursor you saw.
await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'What is my display name?' },
])
const second = await runTurn(session.session_id, first.cursor)
console.log(second.text)                 // mentions "Ada"
```

`postEvents` returns `202` and an object wrapping the per-event results - the array is under
`events`, not the response itself. An accepted event comes back as the full event object the
history will show (with its `seq`); a `user.interrupt` with no run in flight comes back as
`{ id, type, accepted: false }`. Acceptance means the event was queued, not that the turn has
finished. A turn ends when you see `run.finished`, whose `payload.status` is `succeeded`,
`failed`, or `aborted` - see [Events and streaming](./events.md).

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
  Note that every field of `usage.cost` is currently `0` - do not build a spend display on it.
- **The model that actually answered.** `model` is what the agent is configured with;
  `responseModel` is what served the request. A deployment can map a configured alias onto a
  substitute, so the two differ in the sample above. Trust `responseModel` when the answer
  feeds billing, evaluation, or a compliance record.

This is the transcript, not the event log. It holds conversational messages, not
`run.started` / `agent.tool` / `run.finished`. Use it to recover an answer whose events you
missed; use `listEvents` when you want the event stream. Other `entry_type` values exist
(session anchors, compaction markers, model changes); filter for `message` and skip the rest.

## `listEvents` and pagination

`listEvents` returns the durable event log for a session — your own inputs (`user.message`
and friends) included, so the whole conversation reconstructs from this one surface —
normalized to a single `SessionEvent` shape (`seq`, `eventType`, `payload`, `runId`, `turn`,
`createdAt`, plus `id` and `processedAt` where the server sends them).

```ts
const events = await zc.listEvents(agentId, session.session_id, {
  types: ['user.message', 'agent.assistant'],
})
```

::: warning One page per call
The server returns **100 events by default and at most 500**, and `listEvents` returns one
page without the page's `has_more`/`next_cursor` fields. Anything that reconstructs a whole
conversation should use `listAllEvents`, or page by hand with `listEventsPage`.
:::

`listAllEvents` is that paging loop. It follows the server's `next_cursor` until `has_more`
is false (and falls back to walking `after` on servers without cursor pagination):

```ts
const all: SessionEvent[] = await zc.listAllEvents(agentId, session.session_id)
```

It is stricter than the obvious loop: it de-duplicates across page boundaries, and it stops
rather than spinning if the cursor fails to advance. `pageSize` is the per-request `limit`
(default and maximum 500); `types` means what it means on `listEvents`.

Passing `after` — here or on `listEvents`/`streamEvents` — selects the deprecated
engine-only lane: no user inputs, no pagination flags. Keep it for old stored cursors only.
`seq` is durable and strictly increasing but not necessarily contiguous; to resume an SSE
stream use each streamed event's `cursor` token (`streamEvents({ cursor })`). `types` filters
server-side and composes with `cursor` and `limit`.

## Not in the SDK

::: danger Not supported
`ZooworkClient` has no `patchSession`, and `PATCH` on a session answers `405`, which makes a
session's `metadata` write-once, at `createSession`.

Keep your own record of the `session_id` values you create - store them alongside whatever
they belong to in your application - and put anything you need to search on into `metadata`
at create time, because you cannot add it later.
:::

There is also no top-level session resource, so there is no way to list sessions across
agents. See [Not supported](../reference/not-supported.md) for the full boundary.

Per-agent listing and lifecycle do have methods - `listSessions(agentId, { page })`,
`archiveSession(agentId, sessionId)`, `deleteSession(agentId, sessionId)` - and none of them
changes the two paragraphs above: you still fan out across agents yourself, and `metadata` is
still write-once.

One last boundary: a session isolates conversation history, not files - every session of an agent
shares one `/workspace`. When a multi-user product needs file and memory isolation, see
[An agent per user](./per-user-agents.md).
