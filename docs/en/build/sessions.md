---
description: Create a Session, select its Agent configuration, send the first message, and continue the conversation.
---

# Start a session

A Session is a persistent conversation with one Agent. Create the Session, then send a
`user.message` to start work. You can combine those steps with `initial_events`.
The conversation stays on the server, so later messages do not need to resend its history.

Sessions belong to Agents. Store `agent_id` and `session_id` beside your application's
conversation ID; every Session call uses both. A Session separates conversation history,
while Sessions on the same Agent share its workspace by default. See
[An agent per user](./per-user-agents.md) when users need separate file workspaces.

## Prerequisites

Use a backend [API key](../get-started/authentication.md) and an existing Agent.
A newly created Agent is stopped: start it before creating a Session, or creation returns
`409 agent_not_running`. API readiness uses `status.desired_state`, rather than channel health.
See [Agent lifecycle](./agents.md).

The SDK examples use the `client` configured in [Authentication](../get-started/authentication.md).
Use your Agent ID as `agentId` in TypeScript, `agent_id` in Python, or `AGENT_ID` in curl.
Run Python `await` examples inside an async function. Start the Agent:

::: code-group

```ts [TypeScript]
await client.startAgent(agentId)
```

```python [Python]
await client.start_agent(agent_id)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

The default Cloud sandbox is managed on demand. You do not need to create an Environment
for this example; custom dependencies belong in the [Agent's Environment](./environments.md).

## Create a session

::: code-group

```ts [TypeScript]
const session = await client.createSession(agentId, {
  metadata: { source: 'my-app', conversation_id: 'conversation-42' },
})
const sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id, {
    "metadata": {"source": "my-app", "conversation_id": "conversation-42"},
})
session_id = session["session_id"]
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"metadata":{"source":"my-app","conversation_id":"conversation-42"}}'
```

:::

For curl, save the response's `session_id` as `SESSION_ID`.

An empty Session waits for input. `session_id` is opaque; `api:` belongs to its
`session_key`, not its ID. There is no top-level `/sessions` collection: HTTP creation is
`POST /agents/{agent_id}/sessions` relative to the `/service/v1` base.

`metadata` is an application-owned JSON object. Set it at creation for correlation;
it does not select a user identity or provide access control. See
[Session operations](./session-operations.md#store-session-metadata) for its write-once behavior.

### Idempotency-Key

The optional third argument to TypeScript's `createSession`, or Python's
`idempotency_key` keyword argument to `create_session`, becomes the `Idempotency-Key` header.
Retry a lost create response with the same key to recover the same Session. Give later
input events their own stable `idempotency_key`. See [Errors and retries](../reference/errors.md).

### Choose a configuration snapshot

Omitting `runtime_mode` lets subsequent turns resolve the active Agent configuration.
To pin the current active configuration at Session creation, set `runtime_mode: "active"`
through the SDK or HTTP:

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"runtime_mode":"active","metadata":{"source":"my-app"}}'
```

| Create request | Configuration selection |
|---|---|
| Omit `runtime_mode` | Resolve the active Agent configuration for later turns. |
| Set `runtime_mode: "active"` | Pin the current active configuration at creation. |

Neither form accepts caller-supplied `config_version`. Other runtime modes have different
selection rules. These forms select a saved configuration; they do not introduce
Session-local `model`, `system`, `tools`, `mcp_servers`, `skills`, or Environment overrides.
Change [Agent configuration](./agents.md) for those settings.

### Include the first message

Use `initial_events` instead of the empty create request above when the first message is ready:

::: code-group

```ts [TypeScript]
const seeded = await client.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'My display name is Ada.' }],
})
```

```python [Python]
seeded = await client.create_session(agent_id, {
    "initial_events": [{"type": "user.message", "content": "My display name is Ada."}],
})
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{"type":"user.message","content":"My display name is Ada."}]}'
```

:::

Use this response's Session ID for later calls if you choose this form. Only `user.message` is accepted here, with at most 50 events. `content` must be a non-empty
string. Post interrupts and tool replies after the Session exists. Message actor rules are
explained with [message inputs](./events.md#user-message).

## Send work and read the response

For the empty Session created above, send the first message:

::: code-group

```ts [TypeScript]
await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'My display name is Ada.', idempotency_key: 'conversation-42-turn-1' },
])
```

```python [Python]
await client.post_events(agent_id, session_id, [{
    "type": "user.message", "content": "My display name is Ada.",
    "idempotency_key": "conversation-42-turn-1",
}])
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.message","content":"My display name is Ada.","idempotency_key":"conversation-42-turn-1"}]}'
```

:::

The 202 receipt confirms queuing, not completed execution. Read saved events or connect to
the stream to observe the response. The following helper reads one ordinary turn:

::: code-group

```ts [TypeScript]
import { assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

async function readTurn(sessionId: string, cursor?: string) {
  let text = ''
  let outcome: string | undefined
  for await (const ev of client.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
    cursor = ev.cursor ?? cursor
    text += assistantText(ev)
    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
  return { text, cursor, outcome }
}

const first = await readTurn(sessionId)
console.log(first.outcome, first.text)
```

```python [Python]
from contextlib import aclosing
from zoowork import assistant_text, is_run_finished, run_outcome

async def read_turn(session_id: str, cursor: str | None = None):
    text = ""
    outcome = None
    async with aclosing(client.stream_events(agent_id, session_id, cursor=cursor)) as stream:
        async for event in stream:
            cursor = event.cursor or cursor
            text += assistant_text(event)
            if is_run_finished(event):
                outcome = run_outcome(event)
                break
    return {"text": text, "cursor": cursor, "outcome": outcome}

first = await read_turn(session_id)
print(first["outcome"], first["text"])
```

```bash [curl]
curl -N "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream'
```

:::

The SDK readers break after one `run.finished`; curl prints raw SSE frames and stays open
until you stop it. Save the last SSE `id:` value for resuming. `run.finished` ends one turn,
while the Session and stream can remain open. A turn that
yields to asynchronous work can also end successfully. Read
[termination and yielded turns](./events.md#turn-outcomes) before treating it as task completion.

## Continue the conversation {#multi-turn}

Send the next message to the same Session. Resume from the last event cursor you consumed:

::: code-group

```ts [TypeScript]
await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'What is my display name?', idempotency_key: 'conversation-42-turn-2' },
])
const second = await readTurn(sessionId, first.cursor)
console.log(second.text) // mentions Ada
```

```python [Python]
await client.post_events(agent_id, session_id, [{
    "type": "user.message", "content": "What is my display name?",
    "idempotency_key": "conversation-42-turn-2",
}])
second = await read_turn(session_id, first["cursor"])
print(second["text"])
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.message","content":"What is my display name?","idempotency_key":"conversation-42-turn-2"}]}'

curl -N -G "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream' \
  --data-urlencode "cursor=$EVENT_CURSOR"
```

:::

In curl, `EVENT_CURSOR` is the last processed SSE `id:` value from the first turn.
Store the cursor after successful processing, keeping it opaque. See
[Events and streaming](./events.md) for timeouts, reconnection, interrupts, and tool responses.
Use [Session operations](./session-operations.md) to retrieve state and history, list Sessions,
or archive and delete them.

## SDK calls

::: code-group

```ts [TypeScript]
const session = await client.createSession(agentId, { runtime_mode: 'active', idle_compaction: false })
```

```python [Python]
session = await client.create_session(agent_id, {"runtime_mode": "active", "idle_compaction": False})
```

:::

Explicit active mode pins the current configuration at creation. Omission resolves the active configuration on later turns. `idle_compaction` accepts true, false or null; omission preserves the server default.
