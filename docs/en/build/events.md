---
description: Send Session events, stream responses, interpret turn termination, and resume from durable cursors.
---

# Session event stream

Send user events to start or continue work, then read saved events or the live SSE stream.
Events flow in two directions: `user.*` and `system.message` are inputs; Agent and run events
report responses, tool activity, and execution progress. Inputs are echoed on the durable log.

The log belongs to one Session. Its `seq` increases without reuse, but gaps are normal.
Resume with opaque cursor tokens from streamed events or list pages, rather than deriving
one from a sequence number. See [Start a session](./sessions.md) if you need to create it first.

Use the `client` configured in [Authentication](../get-started/authentication.md) and your
Agent and Session IDs. Python `await` examples run inside an async function.

## Send events {#inbound-events}

There are exactly five event types you can post. Anything else is rejected with
`400 invalid_event` and a message naming the five.

::: code-group

```ts [TypeScript]
const receipt = await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Summarize the last three findings.' },
])
console.log(receipt.events)
```

```python [Python]
receipts = await client.post_events(agent_id, session_id, [
    {"type": "user.message", "content": "Summarize the last three findings."},
])
print(receipts)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.message","content":"Summarize the last three findings."}]}'
```

:::

`postEvents` returns an object with an `events` array; Python `post_events` returns that
array directly. The HTTP response is `202` with one entry per submitted event. `accepted` is the field that
matters.

### `user.message`

Appends a user turn and starts a run.

```json
{ "type": "user.message", "content": "Hello", "idempotency_key": "optional", "attachments": [] }
```

| Field | Required | Rules |
|---|---|---|
| `content` | yes | Must be a **non-empty string**. Anything else is `400 invalid_event`. |
| `attachments` | no | Must be an array if present. |
| `idempotency_key` | no | Non-empty string. Used as the delivery dedup key, so a retry with the same key converges instead of duplicating the message. |
| `actor` | no | `{ ref: string }` on API sessions only. `ref` is 1–200 ASCII characters from `[A-Za-z0-9._:@+-]`. Omit the whole object to use the owner. |

`createSession(agentId, { initial_events })` accepts `user.message` and nothing else, up to 50
entries.

::: warning Memory attribution is not access control
Your backend must map an authenticated application user to a stable opaque `actor.ref` and
authorize the session.
`metadata.user_id` does not set the actor. It does not isolate sandbox files or remove prior
context. IM sessions reject `actor`; `actor.token`, unknown actor keys and malformed refs
return HTTP 400. Never accept a supplied actor as proof of identity.
:::

## Streaming a turn

`streamEvents` is an async generator over the live session stream.

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

::: info A Session stream can carry multiple turns
`run.finished` is the end of the *turn*, not the end of the *stream*. The connection stays open
waiting for the next turn, and the server only drops it when the connection goes idle long
enough.

If you `for await` to completion, or `await` an array collected from the generator, you will
wait until the server times the connection out. Break on `isRunFinished(ev)` when you only
need the current turn. A successful `run.finished` can also have
`turnEndReason: "yielded"` and `outputType: "not_required"`: the turn ended while task work
continues. Check [turn outcomes and yielded work](#turn-outcomes) before presenting completion.
:::

The examples below assume the message above is the first turn in a **new Session**. They
then send a second message and reuse the first turn's cursor. For an existing Session, load
its last processed cursor before sending another message and pass it to the first read too.
Without a cursor, the stream replays from the beginning, including old `run.finished` events.
These examples use one outstanding turn at a time; autonomous or concurrent runs need their
own run correlation and the [turn-outcome checks](#turn-outcomes).

::: code-group

```ts [TypeScript]
import { assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

async function readOneTurn(startCursor?: string) {
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 120_000)
  let cursor = startCursor
  let text = ''
  try {
    for await (const ev of client.streamEvents(agentId, sessionId, {
      cursor: startCursor, signal: ctl.signal,
    })) {
      text += assistantText(ev)
      cursor = ev.cursor ?? cursor // Save after processing, alongside the Session ID.
      if (isRunFinished(ev)) {
        if (!cursor) throw new Error('Missing resume cursor')
        if (runOutcome(ev) !== 'succeeded') throw new Error(`run ${runOutcome(ev)}`)
        return { text, cursor }
      }
    }
    throw new Error('Read ended before run.finished; reconnect from the saved cursor')
  } finally {
    clearTimeout(timeout)
    ctl.abort()
  }
}

// First message in a new Session: replay starts at the beginning.
const first = await readOneTurn()
console.log(first.text)
// Persist first.cursor before sending a follow-up. One outstanding turn at a time.
const receipt = await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Explain the second finding in more detail.' },
])
if (receipt.events[0]?.accepted !== true) throw new Error('Message was not accepted')
const second = await readOneTurn(first.cursor)
console.log(second.text)
// Persist second.cursor for the next turn.
```

```python [Python]
import asyncio
from contextlib import aclosing
from zoowork import assistant_text, is_run_finished, run_outcome

async def read_one_turn(start_cursor=None):
    text = ""
    cursor = start_cursor
    async with aclosing(client.stream_events(
        agent_id, session_id, cursor=start_cursor,
    )) as stream:
        async for event in stream:
            text += assistant_text(event)
            cursor = event.cursor or cursor  # Save after processing with the Session ID.
            if is_run_finished(event):
                if not cursor:
                    raise RuntimeError("Missing resume cursor")
                if run_outcome(event) != "succeeded":
                    raise RuntimeError(f"run {run_outcome(event)}")
                return text, cursor
    raise RuntimeError("Read ended before run.finished; reconnect from the saved cursor")

# First message in a new Session; one outstanding turn at a time.
text, cursor = await asyncio.wait_for(read_one_turn(), timeout=120)
print(text)
# Persist cursor before sending a follow-up.
receipts = await client.post_events(agent_id, session_id, [
    {"type": "user.message", "content": "Explain the second finding in more detail."},
])
if not receipts or receipts[0].get("accepted") is not True:
    raise RuntimeError("Message was not accepted")
text, cursor = await asyncio.wait_for(read_one_turn(cursor), timeout=120)
print(text)
# Persist cursor for the next turn.
```

```bash [curl]
# Existing Session: EVENT_CURSOR is the last processed SSE id, saved by your app.
curl -N --max-time 120 --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream' \
  --data-urlencode "cursor=$EVENT_CURSOR"
```

:::

For a new Session only, omit the curl `cursor` parameter. Save each processed SSE `id:` for later reads.

These snippets keep the cursor in memory. In a service, persist processed event state and its cursor after each event, so timeout or process restart does not discard the checkpoint.

Notes on the mechanics:

- Aborting the stream closes your read connection. It does not send `user.interrupt`, stop
  the server's run, or enforce a spending cap. To stop work, post an interrupt and observe the
  terminal event on a new or resumed stream.
- In TypeScript, aborting the `signal` ends the generator cleanly. Python
  `asyncio.wait_for` raises `asyncio.TimeoutError` on timeout and `aclosing` closes the stream.
  Curl prints raw frames until its timeout or until you stop it; it does not break on
  `run.finished`.
- The generator drops any event whose `seq` is at or below the highest it has already yielded,
  within that generator. A new generator has no application checkpoint; pass the saved cursor.
- Everything `streamEvents` yields is durable.
- For a multi-turn session, open a new stream per turn with the last `cursor` you saw, or keep
  one stream open and keep counting `run.finished` events. The first is easier to reason about.

### Existing Session without a saved cursor

There is no current-tail cursor helper. REST events and `postEvents` receipts do not carry
an event cursor, and the final REST page has `next_cursor: null`. Do not derive an opaque
cursor from `seq`, or switch to the deprecated `after` lane to work around this.

If you already processed a turn and retained its verified `run.finished` webhook, its
`data.event_cursor` can supply that turn's checkpoint when present. It is not a query for the
current tail, and resuming after it skips the preceding output; do not use it to skip unread work.

Preserve a cursor from the first streamed turn. If it was lost, replay the durable stream
and reconstruct state using your application's recorded inputs/runs; do not treat the first
replayed `run.finished` as a new answer. Starting a new Session is an alternative only when
you intentionally want a new conversation. A new stream without a cursor does not start at “now”.

## Turn outcomes

A turn ends with exactly one `run.finished`. Its `payload.status` is one of:

| `status` | Meaning |
|---|---|
| `succeeded` | The turn ended successfully. Check `turnEndReason` for a yield. |
| `failed` | The turn errored out. Usually preceded by an `agent.error` carrying `errorMessage`. |
| `aborted` | The turn was cancelled, including by a `user.interrupt`. |

::: info Read the run outcome independently from tool results
An `agent.tool` event with `phase: 'end'` and `isError: true` is still followed by
`run.finished` with `status: 'succeeded'`. The model saw the tool error, worked around it, and
produced an answer. That is a successful turn.

Use `runOutcome()` for the turn result rather than deriving it from individual tool events.
:::

```ts
if (isRunFinished(ev)) {
  const outcome = runOutcome(ev)
  if (outcome !== 'succeeded') {
    // the turn itself failed or was aborted
  }
  break
}
```

If you want to surface tool trouble to your user, collect it separately as you stream, and
report it alongside the outcome rather than instead of it.

### When a turn yields

Asynchronous work can outlive the turn that started it. A yielded turn can end with
`status: "succeeded"`, `turnEndReason: "yielded"`, and `outputType: "not_required"` while
the task is still waiting. This is an ended turn, not a final answer for the task.

```ts
if (isRunFinished(ev)) {
  if (ev.payload.turnEndReason === 'yielded') {
    // Persist ev.cursor and the task correlation fields, then keep observing.
  } else {
    // This run ended; inspect its outcome and output.
  }
}
```

| Optional payload field | Use |
|---|---|
| `taskRunId` | Correlates runs belonging to the continuing task. |
| `parentRunId` | Identifies the preceding run in the continuation lineage. |
| `waitingOn` | Summary of asynchronous work the yielded turn is waiting for. |
| `waitingOnComplete` | Whether that summary is complete. False must not be treated as an empty wait list. |

Persist these fields with the event cursor. Follow subsequent runs and inspect their terminal
outcome and [run output](./session-operations.md#read-output-for-one-run). The output endpoint's
`output_complete` is scoped to a run; it does not make a yielded task complete.

These observability fields do not provide a public API for configuring subagent rosters,
advisors, or session threads. See [Not supported](../reference/not-supported.md) for those
boundaries. For business-quality checks on scheduled results, see
[Scheduled outcomes](./schedules.md#evaluate-a-scheduled-result).

## Resuming

Every durable frame carries its resume token in the SSE `id:` line, and the SDK hands it back
as `ev.cursor`. Pass `{ cursor }` and the server replays the log from right after that event
before continuing live. This is **server-side resume**: no client-side buffer, no
de-duplication pass, no gap when the reconnect takes a while.

::: code-group

```ts [TypeScript]
for await (const ev of client.streamEvents(agentId, sessionId, { cursor: savedCursor })) {
  savedCursor = ev.cursor ?? savedCursor
}
```

```python [Python]
from contextlib import aclosing

async with aclosing(client.stream_events(agent_id, session_id, cursor=saved_cursor)) as stream:
    async for event in stream:
        saved_cursor = event.cursor or saved_cursor
```

```bash [curl]
curl -N -G "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream' \
  --data-urlencode "cursor=$EVENT_CURSOR"
```

:::

Use the stored token as `savedCursor`, `saved_cursor`, or `EVENT_CURSOR` above.
When calling the public HTTP endpoint, use `?cursor=`. The public gateway does not forward
`Last-Event-ID`, so browser EventSource's automatic header replay is not sufficient. `{ after: seq }` still resumes the deprecated engine-only lane —
keep it for old stored cursors only.

### A reconnect loop that survives a dropped connection

The SDK does not reconnect automatically. Reconnect from the last processed cursor:

```ts
import {
  ZooworkError,
  assistantText,
  isRunFinished,
  runOutcome,
  type ZooworkClient,
} from '@zoowork-ai/sdk'

async function runTurnWithResume(
  client: ZooworkClient,
  agentId: string,
  sessionId: string,
  startCursor?: string,
  maxAttempts = 6,
): Promise<{ outcome?: 'succeeded' | 'failed' | 'aborted'; text: string; cursor?: string }> {
  let cursor = startCursor
  let text = ''

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      for await (const ev of client.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
        cursor = ev.cursor ?? cursor
        text += assistantText(ev)
        if (isRunFinished(ev)) {
          const outcome = runOutcome(ev)
          return { ...(outcome ? { outcome } : {}), text, ...(cursor ? { cursor } : {}) }
        }
      }
      // The generator returned without run.finished: the server closed the
      // connection. Nothing is lost - reconnect from the last cursor.
    } catch (e) {
      // 4xx is a real problem (bad id, archived session, expired key). Retrying
      // will not fix it.
      if (e instanceof ZooworkError && e.status >= 400 && e.status < 500) throw e
    }
    await new Promise((r) => setTimeout(r, Math.min(1_000 * 2 ** attempt, 15_000)))
  }

  return { text, ...(cursor ? { cursor } : {}) }
}
```

Persist the cursor next to your session id. It is valid across process restarts, so a worker
that crashes mid-turn picks the turn back up exactly where it stopped.

### The history read uses the same cursor

`listEvents` reads the same durable log over REST, and a list page's `next_cursor` is the
same kind of token as a streamed event's `cursor`.

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

`limit` defaults to **100** server-side and is capped at **500**, and the call returns **one
page** without the page's `has_more`/`next_cursor` fields (`listEventsPage` is the same call
keeping them, for paging by hand). The page-returning methods expose the continuation token:

::: code-group

```ts [TypeScript]
const page = await client.listEventsPage(agentId, sessionId, { limit: 100 })
```

```python [Python]
events, has_more, next_cursor = await client.list_events_page(
    agent_id, session_id, limit=100,
)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events?limit=100" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

For all pages, `listAllEvents()` / `list_all_events()` follows the server cursor for you.
In HTTP, keep reading with `next_cursor` while `has_more` is true.

`types` filters server-side on both calls and must contain only vocabulary members; an unknown
one is `400 invalid_request`.

```ts
const replies = await client.listAllEvents(agentId, sessionId, { types: ['agent.assistant'] })
```

`listAllEvents` de-duplicates page boundaries and stops if a cursor does not advance.
Its `pageSize` controls the per-request limit, with default and maximum 500.

The text assembled from the REST replay is byte-identical to the text assembled from the
stream.

## Interrupt and respond to tools {#respond-to-tools}

### `user.interrupt`

Aborts the run that is currently in flight.

```json
{ "type": "user.interrupt" }
```

You can also send an event-level `idempotency_key`. With a live run, it comes back `accepted: true` and the turn ends with
`run.finished` `status: 'aborted'`. With **no** run in flight it comes back `accepted: false`.
That is a no-op, not an error, and the HTTP status is still `202`.

::: code-group

```ts [TypeScript]
const receipt = await client.postEvents(agentId, sessionId, [{ type: 'user.interrupt' }])
if (receipt.events[0]?.accepted === false) console.log('No run was in flight')
```

```python [Python]
receipts = await client.post_events(agent_id, session_id, [{"type": "user.interrupt"}])
if receipts and receipts[0].get("accepted") is False:
    print("No run was in flight")
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.interrupt"}]}'
```

:::

Use the same `idempotency_key` when retrying an interrupt after a transport failure. Its
accepted receipt can be replayed even after the targeted run has ended. Do not replace an
explicit interrupt with a new `user.message` and assume they have identical cancellation
behavior.

### `user.tool_confirmation`

Resolves a pending approval.

```json
{ "type": "user.tool_confirmation", "approval_id": "apr_...", "decision": "allow-once" }
```

| Field | Required | Rules |
|---|---|---|
| `approval_id` | yes | Non-empty string. Comes from `agent.approval` `payload.approvalId`. |
| `decision` | yes | Exactly one of `allow-once`, `allow-always`, `deny`. |

Note the mixed casing: the body is snake_case (`approval_id`) while the event payload you read
it from is camelCase (`approvalId`). Any other shape is `400 invalid_event`.

See [Permission policies](./permissions.md) for server defaults, per-tool overrides, and the
REST approval workflow.

### `user.custom_tool_result`

Returns the result of an application-executed custom tool. Identify the call with
`custom_tool_use_id` or `call_id`, include 1–16 text, JSON, or base64 image blocks in
`content`, and send a stable `idempotency_key` when retry is possible. Optional `is_error`
marks a tool failure. The same operation is available through `resolveCustomToolCall()`;
the complete size, image, lifecycle, and error rules are in
[Tools](./tools.md#application-executed-custom-tools).

### `system.message`

Injects an out-of-band note that the model reads on the following turn - state your
application owns, pushed in without appearing as a user turn.

```json
{ "type": "system.message", "text": "Operator note: the user's plan is Enterprise." }
```

`text` must be a non-empty string. The note enters context on the next turn, so post it before
the `user.message` it should affect.

```ts
await client.postEvents(agentId, sessionId, [
  { type: 'system.message', text: "Operator note: the user's plan is Enterprise." },
  { type: 'user.message', content: 'Which limits apply to me?' },
])
```

## Tool call phases

One tool call produces multiple `agent.tool` events that share a `toolCallId`.

| `phase` | Meaning | Carries |
|---|---|---|
| `start` | The call was proposed; policy and approval checks can still prevent execution. | `args` |
| `end` | The call returned. | `isError`, `resultPreview`, `executionStarted` |
| `blocked` | The call ended without execution. This is terminal; inspect `deniedReason`. | `policyId`, `deniedReason` |

Two rules:

1. **Pair by `toolCallId`, not by adjacency.** When calls run concurrently, the `start` and
   `end` of one call are separated by events belonging to others.
2. **`blocked` is terminal, not an approval wait.** No `end` follows for that blocked call.
   Reasons include policy denial, approval denial (`approval-denied`), approval timeout
   (`approval-timeout`), cancellation (`approval-cancelled`), or interruption (`interrupted`).
   Read `ev.payload.deniedReason`; render the call as ended without execution, not successful. Waiting for a human
   decision is `agent.approval` with `phase: 'requested'`; `phase: 'resolved'` ends that wait.
   An approval resolution alone does not prove tool execution succeeded.

```ts
import { toolCall, isRunFinished, type ToolCall } from '@zoowork-ai/sdk'

// savedCursor is the application's checkpoint for this Session.
const pending = new Map<string, ToolCall>() // toolCallId -> latest state

for await (const ev of client.streamEvents(agentId, sessionId, { cursor: savedCursor })) {
  const tool = toolCall(ev)
  if (tool) {
    if (tool.phase === 'end' || tool.phase === 'blocked') pending.delete(tool.toolCallId)
    else pending.set(tool.toolCallId, tool) // start remains pending
  }
  if (isRunFinished(ev)) break
}

console.log(`${pending.size} tool calls never returned`)
```

`toolCall()` maps any phase it does not recognize to `start`, so if you need the exact wire
value read `ev.payload.phase` directly.

## The `?deltas=` preview lane

The stream endpoint accepts `?deltas=agent.message`, which interleaves incremental preview
frames among the durable ones. The SDK does not expose it and `streamEvents` never requests it,
so this section only concerns direct HTTP callers.

Two things make it different from what you may expect. Preview frames carry **no `id:` line**:
they are not part of the durable cursor and never replay. And their `replace: true` means
**snapshot-replace, not prefix-append** - each frame carries the current full text, so the `+=`
you would write for a prefix-append delta stream duplicates everything already shown. Assign,
do not append.

When preview streaming is unavailable, requesting `deltas` returns `501 not_configured`
before the stream opens. Handle it as a regular JSON error.

For finished text, use `agent.assistant` events, which are durable and resumable.

## Reference details

The following tables describe the normalized SDK shape, wire formats, event catalog, and helpers.
Use the integration flow above before looking up individual fields here.

### The event envelope

The TypeScript SDK normalizes every event, from either transport, into this shape.
Python uses snake_case attributes such as `event_type`, `run_id`, `created_at`, and
`processed_at`; `seq`, `payload`, and `cursor` keep the same names:

```ts
interface SessionEvent {
  /** Durable per-session sequence: strictly increasing, not necessarily contiguous. */
  seq: number
  eventType: SessionEventType | PublicInputEventType | string
  payload: Record<string, unknown>
  runId?: string
  turn?: number
  createdAt?: string
  id?: string
  processedAt?: string | null
  cursor?: string
}
```

| Field | Type | Notes |
|---|---|---|
| `seq` | `number` | Strictly increasing within the session, assigned server-side; gaps are normal. `-1` if the frame carried no sequence at all, which should not happen on the durable stream. |
| `eventType` | `string` | One of the values in the tables below. Typed loosely on purpose: unknown types pass through instead of throwing, because the API is Developer Preview and may add types within a version. |
| `payload` | `Record<string, unknown>` | Type-specific body, always an object. Always `{}` rather than `undefined` when absent. Its keys are camelCase. |
| `runId` | `string \| undefined` | The turn's run. All events of one turn share it. Input events carry none. |
| `turn` | `number \| undefined` | Turn index within the session. |
| `createdAt` | `string \| undefined` | ISO 8601 timestamp. |
| `id` | `string \| undefined` | Event id, when the server sends one. |
| `processedAt` | `string \| null \| undefined` | Input events only: `null` while queued, a timestamp once the agent has consumed it. |
| `cursor` | `string \| undefined` | Resume token, present on streamed events — pass it to `streamEvents({ cursor })`. |

There is no top-level `type` field, no `stop_reason`, and no `session.status_*` event. Read
the event type from `event.eventType` in TypeScript or `event.event_type` in Python.

`payload` is deliberately loose. Read the fields you need and ignore the rest; the server adds
fields within a version.

### The wire underneath

::: info The SDK normalizes wire formats
On the unified lane both transports send the same snake_case object
(`event_type`, `run_id`, `processed_at`, `created_at`), with the SSE `id:` line carrying the
resume token. TypeScript's `normalizeEvent` and Python's `normalize_event` convert these
objects into their SDK's `SessionEvent` shape for both history reads and streaming.

Direct HTTP integrations should also accept camelCase fields from the legacy `after` SSE lane.
Read `event_type` on the unified lane or `eventType` on the legacy lane; neither has a
top-level `type`.
:::

The server writes a `: ping` comment line every 20 seconds as a keepalive, so any socket read
timeout or proxy idle timeout below that kills a healthy stream, and a hand-written parser that
does not skip comment lines hits `JSON.parse('')` and throws - `parseSSE` is exported if you
would rather not write one.

`normalizeEvent` is exported, so you can reuse it if you have your own transport:

```ts
import { normalizeEvent } from '@zoowork-ai/sdk'

const ev = normalizeEvent(JSON.parse(frameData), sseIdLine) // the frame's SSE id value
```

### The event vocabulary

These are the outbound event types, the full contents of `SESSION_EVENT_TYPES` (a fixed list
of 20), plus the five input types under [Your inputs, echoed](#your-inputs-echoed). The
`types=` filter on history accepts both sets and rejects anything else with
`400 invalid_request`.

#### `run.*` - turn bookkeeping

| Type | Fires | `payload` |
|---|---|---|
| `run.started` | A turn begins, before any model call. | `trigger`, `inboundMessageId`, `agentId` |
| `run.finished` | The turn is over. This is the last event of the turn. | `status`: `succeeded` or `failed` or `aborted` |

#### `agent.*` - what happened inside the turn

| Type | Fires | `payload` |
|---|---|---|
| `agent.lifecycle` | Bookends the agent loop inside a turn. | `phase`: `start` or `end`. Scheduled agents can also emit `phase: 'heartbeat-skipped'` with `reason`, `scheduleId`, `firedAt`. |
| `agent.assistant` | One assistant message segment is committed. | `message` (`{ role, content[] }`), `segment` (1-based step index), optional `artifacts`. Use `assistantText()`. |
| `agent.thinking` | Reasoning text for the segment just committed. | `text` |
| `agent.tool` | A tool call changes phase. See [Tool call phases](#tool-call-phases). | `phase`, `toolCallId`, `toolName`; `args` on start; `isError`, `resultPreview`, `executionStarted` on end; `policyId`, `deniedReason` on blocked. |
| `agent.item` | Internal loop markers, not conversation. | `kind`: `assistant_segment` (with `phase`, `segment`) or `llm_request` (captured provider request/response). Safe to ignore when rendering a chat. |
| `agent.plan` | Reserved in the vocabulary. The core loop does not emit it. | - |
| `agent.approval` | A tool call needs approval, or that approval resolved. | `phase`: `requested` or `resolved`; `approvalId`, `toolCallId`, `toolName`, `arguments`, optional `stake`, `timeoutAt`; on `resolved`, `resolution` plus optional `resolvedBy`, `resolutionChannel`. |
| `agent.custom_tool_use` | An application-executed custom tool is requested or resolved. | `phase`: `requested` or `resolved`; `callId`; request fields include `toolCallId`, `name`, `input`, `timeoutAt`; resolved fields include `outcome`, optional `isError`, `resolvedBy`, `resolutionChannel`. Use `customToolUse()`. |
| `agent.command_output` | A command-running tool produced stdout/stderr, at result granularity. | `toolCallId`, `toolName`, plus the captured output fields. |
| `agent.patch` | An `apply_patch` tool call succeeded. | `toolCallId` plus the patch summary. |
| `agent.compaction` | History was compacted to fit the context window. | `firstKeptEntryId`, `tokensBefore`, `reason` |
| `agent.error` | An error occurred inside the turn. | `errorMessage`, sometimes `kind` (for example `mcp_connection_failed` or `mcp_authentication_failed`), `server`, and optional `reason`. Preserve unknown reasons. This event is not a verdict on the turn; read `run.finished`. |

#### Other

| Type | Fires | `payload` |
|---|---|---|
| `attachment.created` | A tool produced a file or attachment. | `source`, `toolName`, `toolCallId`, `index`, plus the storage reference fields. |
| `message.outbound` | The agent sent a proactive message (message tool, schedule announce, or heartbeat) rather than replying in-session. | `source`, `sourceRef`, `delivery`, `text`, `action`, `index`, `computerId`, `agentId`, optional `card`, `artifacts`. |

#### Your inputs, echoed

Your own inputs come back on the same log as `user.message`, `user.interrupt`,
`user.tool_confirmation`, `user.custom_tool_result`, and `system.message` (exported as
`PUBLIC_INPUT_EVENT_TYPES`). A
`user.message` payload is `{ content: [...] }` — text blocks plus
`{ type: 'attachment', mime, name, size }` stubs — and its `processedAt` flips from `null` to
a timestamp once the agent has consumed it. The write-side rules for all five are under
[Inbound events](#inbound-events).

#### Preview events: `chat.*`

`chat.delta`, `chat.final`, `chat.aborted`, and `chat.error` are delivered on a separate
per-run preview lane through the [`?deltas=` query parameter](#the-deltas-preview-lane).
Use the durable `run.started` and `run.finished` events for turn lifecycle logic.

### Helpers

The names below are exported from `@zoowork-ai/sdk`. Python exports the corresponding
`assistant_text`, `thinking_text`, `tool_call`, `is_run_finished`, `run_outcome`, and
`message_text` helpers. Each one is a pure function over a `SessionEvent` and
returns a harmless empty value for events of the wrong type, so you can call them
unconditionally in one loop.

**`assistantText(e)`** - assistant text for an `agent.assistant` event, `''` for anything else.

```ts
text += assistantText(ev)
```

**`thinkingText(e)`** - reasoning text for an `agent.thinking` event, `''` for anything else.

```ts
if (thinkingText(ev)) console.log('thinking:', thinkingText(ev))
```

**`toolCall(e)`** - a `ToolCall` for an `agent.tool` event, `undefined` for anything else.

```ts
const tool = toolCall(ev)
if (tool?.phase === 'end' && tool.isError) console.warn(`${tool.toolName} failed`)
```

**`isRunFinished(e)`** - `true` for `run.finished`. Use it to finish reading one turn, while
checking [yielded turns](#when-a-turn-yields) when the application tracks a longer task.

```ts
if (isRunFinished(ev)) break
```

**`runOutcome(e)`** - `'succeeded' | 'failed' | 'aborted'` for a `run.finished` event,
`undefined` for anything else (and for an unrecognized status).

```ts
const outcome = runOutcome(ev) // undefined unless ev is run.finished
```

**`messageText(message)`** - text of a `{ role, content }` message object. Use it on transcript
rows from `getSession(agentId, sessionId, { history: true })`, where the message sits at
`entry.message` rather than inside an event payload. Handles both the block array and the plain
string form.

```ts
const s = await client.getSession(agentId, sessionId, { history: true, limit: 50 })
const transcript = (s.history ?? [])
  .filter((row) => row.entry_type === 'message')
  .map((row) => messageText(row.entry.message))
```

The `ToolCall` shape:

```ts
interface ToolCall {
  phase: 'start' | 'end' | 'blocked'
  toolName: string
  toolCallId: string
  args?: Record<string, unknown>
  isError?: boolean
  resultPreview?: string
}
```
