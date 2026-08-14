# Events and streaming

Everything an agent does inside a session is an event. You drive the session by posting a
small set of inbound events, and you observe it by reading the outbound event log, either as
a durable list or as a live SSE stream.

The event log is per session. Each event carries a `seq` that is monotonic within that
session and never reused. `seq` is the only cursor you need: it drives history paging and it
drives stream resume.

```ts
import {
  createZooclawClient,
  assistantText,
  isRunFinished,
  runOutcome,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  process.stdout.write(assistantText(ev))
  if (isRunFinished(ev)) {
    console.log(`\nturn ${runOutcome(ev)}`)
    break
  }
}
```

## The event envelope

The SDK normalizes every event, from either transport, into one shape:

```ts
interface SessionEvent {
  /** Durable per-session sequence. Use as the `after` cursor when resuming. */
  seq: number
  eventType: SessionEventType | string
  payload: Record<string, unknown>
  runId?: string
  turn?: number
  createdAt?: string
}
```

| Field | Type | Notes |
|---|---|---|
| `seq` | `number` | Monotonic within the session, assigned server-side. `-1` if the frame carried no sequence at all, which should not happen on the durable stream. |
| `eventType` | `string` | One of the values in the table below. Typed as `SessionEventType \| string` on purpose: unknown types pass through instead of throwing, because the API is Developer Preview and may add types within a version. |
| `payload` | `Record<string, unknown>` | Type-specific body, always an object. Always `{}` rather than `undefined` when absent. Its keys are camelCase. |
| `runId` | `string \| undefined` | The turn's run. All events of one turn share it. |
| `turn` | `number \| undefined` | Turn index within the session. |
| `createdAt` | `string \| undefined` | ISO 8601 timestamp. |

There is no top-level `type` field, no `stop_reason`, and no `session.status_*` event. If you
are porting code that switches on `event.type`, switch on `event.eventType` instead.

`payload` is deliberately loose. Read the fields you need and ignore the rest; the server adds
fields within a version.

## The wire underneath

::: warning The two transports disagree on spelling
The same event comes back in two different shapes depending on where you read it.

| | REST `GET .../events` | SSE `GET .../events/stream` |
|---|---|---|
| sequence | `seq` | `seq`, and also the SSE `id:` line |
| event type | `event_type` | `eventType` |
| run | `run_id` | `runId` |
| turn | `turn` | `turn` |
| body | `payload` | `payload` |
| timestamp | `created_at` | `createdAt` |
| extra | | `version`, `engine`, `sessionId` |

REST is snake_case. SSE is camelCase. **Neither carries a top-level `type`.**

The SDK absorbs this in `normalizeEvent`, so `listEvents` and `streamEvents` return the same
`SessionEvent` and you never see the difference. If you call the HTTP API directly, you must
write both mappings.
:::

A raw SSE frame looks like this:

```
id: 42
data: {"version":1,"engine":"zooclaw","sessionId":"ses_...","seq":42,"runId":"run_...","turn":0,"eventType":"agent.assistant","payload":{"message":{"role":"assistant","content":[{"type":"text","text":"Hi."}]},"segment":1},"createdAt":"2026-08-06T09:12:44.001Z"}
```

The server also writes `: ping` comment lines every 20 seconds as a keepalive. A conforming SSE
parser ignores them; the SDK's does.

`normalizeEvent` is exported, so you can reuse it if you have your own transport:

```ts
import { normalizeEvent } from '@zooclaw-agents/sdk'

const ev = normalizeEvent(JSON.parse(frameData), sseIdLine) // sseIdLine is the seq fallback
```

## The event vocabulary

These are the outbound event types, the full contents of `SESSION_EVENT_TYPES`. It is a fixed
list of 19; the `types=` filter on history rejects anything outside it with
`400 invalid_request`.

### `run.*` - turn bookkeeping

| Type | Fires | `payload` |
|---|---|---|
| `run.started` | A turn begins, before any model call. | `trigger`, `inboundMessageId`, `agentId` |
| `run.finished` | The turn is over. This is the last event of the turn. | `status`: `succeeded` \| `failed` \| `aborted` |

### `agent.*` - what happened inside the turn

| Type | Fires | `payload` |
|---|---|---|
| `agent.lifecycle` | Bookends the agent loop inside a turn. | `phase`: `start` \| `end`. Scheduled agents can also emit `phase: 'heartbeat-skipped'` with `reason`, `scheduleId`, `firedAt`. |
| `agent.assistant` | One assistant message segment is committed. | `message` (`{ role, content[] }`), `segment` (1-based step index), optional `artifacts`. Use `assistantText()`. |
| `agent.thinking` | Reasoning text for the segment just committed. | `text` |
| `agent.tool` | A tool call changes phase. See [Tool call phases](#tool-call-phases). | `phase`, `toolCallId`, `toolName`; `args` on start; `isError`, `resultPreview`, `executionStarted` on end; `policyId`, `deniedReason` on blocked. |
| `agent.item` | Internal loop markers, not conversation. | `kind`: `assistant_segment` (with `phase`, `segment`) or `llm_request` (captured provider request/response). Safe to ignore when rendering a chat. |
| `agent.plan` | Reserved in the vocabulary. The core loop does not emit it. | - |
| `agent.approval` | A tool call needs approval, or that approval resolved. | `phase`: `requested` \| `resolved`; `approvalId`, `toolCallId`, `toolName`, `arguments`, optional `stake`, `timeoutAt`; on `resolved`, `resolution` plus optional `resolvedBy`, `resolutionChannel`. |
| `agent.command_output` | A command-running tool produced stdout/stderr, at result granularity. | `toolCallId`, `toolName`, plus the captured output fields. |
| `agent.patch` | An `apply_patch` tool call succeeded. | `toolCallId` plus the patch summary. |
| `agent.compaction` | History was compacted to fit the context window. | `firstKeptEntryId`, `tokensBefore`, `reason` |
| `agent.error` | An error occurred inside the turn. | `errorMessage`, sometimes `kind` (for example `mcp_connection_failed`) and `server`. Not by itself a verdict on the turn; read `run.finished`. |

### Other

| Type | Fires | `payload` |
|---|---|---|
| `attachment.created` | A tool produced a file or attachment. | `source`, `toolName`, `toolCallId`, `index`, plus the storage reference fields. |
| `message.outbound` | The agent sent a proactive message (message tool, schedule announce, or heartbeat) rather than replying in-session. | `source`, `sourceRef`, `delivery`, `text`, `action`, `index`, `computerId`, `agentId`, optional `card`, `artifacts`. |

### `chat.*` - not on the durable log

`chat.delta`, `chat.final`, `chat.aborted`, and `chat.error` are members of the vocabulary but
are **not written to the durable event log**. They live on a separate per-run preview lane, and
the only way to see anything from it is the `?deltas=` query parameter described at the end of
this page. Do not build turn logic on them; a turn is bounded by `run.started` and
`run.finished`.

::: warning Not yet verified
The arc we have observed repeatedly on live sessions is `run.started`, `agent.lifecycle`,
`agent.item`, `agent.thinking`, `agent.assistant`, `agent.tool` (start/end), `agent.lifecycle`,
`run.finished`.

`agent.approval`, `agent.command_output`, `agent.patch`, `agent.compaction`,
`attachment.created`, and `message.outbound` are in the vocabulary and the engine emits them,
but we have not driven one end to end through this API. Treat their payload fields as a guide,
not a contract, and code defensively.
:::

## Inbound events

There are exactly four event types you can post. Anything else is rejected with
`400 invalid_event` and a message naming the four.

```ts
const res = await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'Summarize the last three findings.' },
])
// res.events -> [{ id?: string, type?: string, accepted?: boolean }]
```

`postEvents` returns `202` with one entry per submitted event. `accepted` is the field that
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

`createSession(agentId, { initial_events })` accepts `user.message` and nothing else, up to 50
entries.

::: warning Not yet verified
Only a plain string `content` has been exercised. Rich content blocks are not accepted by the
parser today, so send strings.
:::

### `user.interrupt`

Aborts the run that is currently in flight.

```json
{ "type": "user.interrupt" }
```

No other fields. With a live run, it comes back `accepted: true` and the turn ends with
`run.finished` `status: 'aborted'`. With **no** run in flight it comes back `accepted: false`.
That is a no-op, not an error, and the HTTP status is still `202`.

```ts
const r = await zc.postEvents(agentId, sessionId, [{ type: 'user.interrupt' }])
if (r.events[0]?.accepted === false) {
  // nothing was running; not a failure
}
```

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

::: warning Not yet verified
We have not driven an approval end to end. The accepted body above is read from the request
parser, but no live pending approval has been created and resolved through this route, and a
turn that blocks on an approval nobody answers will time out. Do not build a demo around
human-in-the-loop approval.
:::

### `system.message`

Injects an out-of-band note that the model reads on the following turn - state your
application owns, pushed in without appearing as a user turn.

```json
{ "type": "system.message", "text": "Operator note: the user's plan is Enterprise." }
```

`text` must be a non-empty string. Verified: the note is in context on the next turn, not the
current one, so post it before the `user.message` it should affect.

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'system.message', text: "Operator note: the user's plan is Enterprise." },
  { type: 'user.message', content: 'Which limits apply to me?' },
])
```

## Streaming a turn

`streamEvents` is an async generator over the live session stream.

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

::: danger The stream is session-scoped and does not close when a turn ends
`run.finished` is the end of the *turn*, not the end of the *stream*. The connection stays open
waiting for the next turn, and the server only drops it when the connection goes idle long
enough.

If you `for await` to completion, or `await` an array collected from the generator, you will
wait until the server times the connection out. Always `break` on `isRunFinished(ev)`.
:::

A complete single turn, with a wall-clock budget so a stuck run cannot hang your process:

```ts
import {
  createZooclawClient,
  assistantText,
  thinkingText,
  toolCall,
  isRunFinished,
  runOutcome,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const session = await zc.createSession(agentId, {
  metadata: { source: 'docs-example' },
  initial_events: [{ type: 'user.message', content: 'What can you do? One sentence.' }],
})

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined
let lastSeq = 0

try {
  for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
    lastSeq = ev.seq

    const think = thinkingText(ev)
    const tool = toolCall(ev)
    if (think) console.log(`[${ev.seq}] thinking: ${think.slice(0, 60)}`)
    else if (tool) console.log(`[${ev.seq}] tool ${tool.toolName} ${tool.phase}`)
    else console.log(`[${ev.seq}] ${ev.eventType}`)

    text += assistantText(ev)

    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break // required: the stream will not end on its own
    }
  }
} finally {
  clearTimeout(budget)
  ctl.abort() // releases the HTTP connection
}

console.log(outcome, text.trim())
```

Notes on the mechanics:

- Aborting the `signal` ends the generator cleanly. The SDK swallows the abort rather than
  throwing, so you do not need a `catch` for your own cancellation.
- The generator drops any event whose `seq` is at or below the highest it has already yielded,
  so a boundary event replayed on reconnect is not delivered twice.
- `streamEvents` never requests the delta preview lane, so everything it yields is durable.
- For a multi-turn session, open a new stream per turn with `after: lastSeq`, or keep one
  stream open and keep counting `run.finished` events. The first is easier to reason about.

## Resuming

This is the part of the API that is stronger than the alternative you may be used to.

Every durable frame carries its `seq` in the SSE `id:` line. Pass `{ after: lastSeq }` and the
server replays the log from `lastSeq + 1` before continuing live. This is **server-side
resume**: no client-side buffer, no de-duplication pass, no gap when the reconnect takes a
while.

```ts
for await (const ev of zc.streamEvents(agentId, sessionId, { after: 128 })) {
  // first event delivered is seq 129, even if the turn finished minutes ago
}
```

On a platform without server-side resume, the only recovery after a dropped connection is to
re-list history and de-duplicate by event id yourself; here the server replays from your
cursor and the reconnect costs nothing.

If you call the HTTP endpoint directly, either `?after=<seq>` or the standard `Last-Event-ID`
request header works; the server resumes from whichever is higher. Browser `EventSource` sends
`Last-Event-ID` automatically because the server writes the `id:` line.

### A reconnect loop that survives a dropped connection

The SDK does not reconnect for you. Sixteen lines does it:

```ts
import {
  ZooclawError,
  assistantText,
  isRunFinished,
  runOutcome,
  type ZooclawClient,
} from '@zooclaw-agents/sdk'

async function runTurnWithResume(
  zc: ZooclawClient,
  agentId: string,
  sessionId: string,
  startSeq = 0,
  maxAttempts = 6,
): Promise<{ outcome?: 'succeeded' | 'failed' | 'aborted'; text: string; lastSeq: number }> {
  let lastSeq = startSeq
  let text = ''

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      for await (const ev of zc.streamEvents(agentId, sessionId, { after: lastSeq })) {
        lastSeq = ev.seq
        text += assistantText(ev)
        if (isRunFinished(ev)) {
          const outcome = runOutcome(ev)
          return { ...(outcome ? { outcome } : {}), text, lastSeq }
        }
      }
      // The generator returned without run.finished: the server closed the
      // connection. Nothing is lost - reconnect from lastSeq.
    } catch (e) {
      // 4xx is a real problem (bad id, archived session, expired key). Retrying
      // will not fix it.
      if (e instanceof ZooclawError && e.status >= 400 && e.status < 500) throw e
    }
    await new Promise((r) => setTimeout(r, Math.min(1_000 * 2 ** attempt, 15_000)))
  }

  return { text, lastSeq }
}
```

Persist `lastSeq` next to your session id. It is valid across process restarts, so a worker that
crashes mid-turn picks the turn back up exactly where it stopped.

### The history read uses the same cursor

`listEvents` reads the same durable log over REST.

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

`limit` defaults to **100** server-side and is capped at **500**, and the call returns **one
page**. A long session truncates with no error and no flag, so page it yourself:

```ts
async function listAllEvents(zc: ZooclawClient, agentId: string, sessionId: string) {
  const all: SessionEvent[] = []
  let after = 0
  for (;;) {
    const page = await zc.listEvents(agentId, sessionId, { after, limit: 500 })
    all.push(...page)
    if (page.length < 500) break
    after = page[page.length - 1]!.seq
  }
  return all
}
```

`types` filters server-side and must contain only vocabulary members; an unknown one is
`400 invalid_request`.

```ts
const replies = await zc.listEvents(agentId, sessionId, { types: ['agent.assistant'] })
```

The text assembled from the REST replay is byte-identical to the text assembled from the
stream.

## Helpers

All exported from `@zooclaw-agents/sdk`. Each one is a pure function over a `SessionEvent` and
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

**`isRunFinished(e)`** - `true` for `run.finished`. Your loop exit condition.

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
const s = await zc.getSession(agentId, sessionId, { history: true, limit: 50 })
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

## Turn outcomes

A turn ends with exactly one `run.finished`. Its `payload.status` is one of:

| `status` | Meaning |
|---|---|
| `succeeded` | The loop ran to completion. |
| `failed` | The turn errored out. Usually preceded by an `agent.error` carrying `errorMessage`. |
| `aborted` | A `user.interrupt` landed on the live run. |

::: danger A failed tool does not fail the run
An `agent.tool` event with `phase: 'end'` and `isError: true` is still followed by
`run.finished` with `status: 'succeeded'`. The model saw the tool error, worked around it, and
produced an answer. That is a successful turn.

The inverse also holds: **do not infer success from the absence of tool errors**. Read
`runOutcome()` and nothing else.
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

## Tool call phases

One tool call produces multiple `agent.tool` events that share a `toolCallId`.

| `phase` | Meaning | Carries |
|---|---|---|
| `start` | The call was dispatched. | `args` |
| `end` | The call returned. | `isError`, `resultPreview`, `executionStarted` |
| `blocked` | The call is **waiting on an approval and has not run**. | `policyId`, `deniedReason` |

Two rules:

1. **Pair by `toolCallId`, not by adjacency.** When calls run concurrently, the `start` and
   `end` of one call are separated by events belonging to others.
2. **`blocked` is pending, not complete.** It means an approval gate stopped the call before
   execution. The matching `agent.approval` event carries the request, and an `end` still
   follows once the approval resolves. Rendering `blocked` as a finished call will show your
   user a tool that never ran as if it had.

```ts
const pending = new Map<string, ToolCall>() // toolCallId -> latest state

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  const tool = toolCall(ev)
  if (tool) {
    if (tool.phase === 'end') pending.delete(tool.toolCallId)
    else pending.set(tool.toolCallId, tool) // start AND blocked are both in flight
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

Two things make it different from what you may expect:

- Preview frames carry **no `id:` line**. They are not part of the durable cursor and never
  replay. A reconnect re-derives them from the next `run.started`.
- The frame body is `{ "type": "event_delta", "runId", "turn", "deltaText", "replace": true }`.
  **`replace: true` means snapshot-replace, not prefix-append.** Each frame carries the current
  full text, not the newly added fragment.

So the concatenation you would write for a prefix-append delta stream produces duplicated text
here. Assign, do not append:

```js
// correct for this API
if (frame.type === 'event_delta') previewText = frame.deltaText

// wrong: duplicates on every frame
if (frame.type === 'event_delta') previewText += frame.deltaText
```

Requesting `deltas` on a deployment without the preview backend configured returns
`501 not_configured` before the stream opens, so you get a normal JSON error rather than a
stream that stays silent.

::: warning Not yet verified
The frame shape and the snapshot-replace semantics above are read from the server
implementation. We have not exercised `?deltas=` against a live deployment, and we do not know
whether it is enabled on the deployment you are using. For finished text, use `agent.assistant`
events, which are durable, resumable, and verified.
:::
