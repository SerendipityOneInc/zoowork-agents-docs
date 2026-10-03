---
description: Read Session state and transcripts, retrieve run output, list Sessions, and archive or delete them.
---

# Session operations

Once a Session exists, use these operations to inspect its work or manage its lifecycle.
See [Start a session](./sessions.md) for creation and first input, and
[Events and streaming](./events.md) for the durable event log.

All operations are scoped to an Agent. Use the backend `client` from
[Authentication](../get-started/authentication.md) and the Agent and Session IDs saved in
[Start a session](./sessions.md). Python `await` examples run inside an async function.

## Read a session

::: code-group

```ts [TypeScript]
const s = await client.getSession(agentId, sessionId)
```

```python [Python]
s = await client.get_session(agent_id, session_id)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Example response:

```json
{
  "session_id": "0123456789abcdef0123456789abcdef",
  "session_key": "api:0123456789abcdef0123456789abcdef",
  "channel": "api",
  "run_status": "succeeded",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "metadata": { "source": "docs-example" },
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
| `pending_approvals` | Count of tool calls waiting on approval. Read the records with `listApprovals()`. |
| `status` | A legacy Session field; the current `getSession()` path returns `null`. See below. |

::: info Read run state from `run_status`
`status` is a legacy Session field and may be `null`. Use `run_status` to read or poll the
state of the most recent run.
:::

Read the latest run state together with the pending counters:

| What you read | What to do |
|---|---|
| `run_status: null` | There is no latest run to inspect. |
| `run_status: "running"` | Continue reading events. |
| `run_status: "awaiting_approval"`, `pending_approvals > 0` | Read and resolve the pending [approvals](./permissions.md). |
| `run_status: "awaiting_approval"`, `pending_custom_tool_calls > 0` | Execute and return the pending [custom tool results](./tools.md#application-executed-custom-tools). |
| `succeeded`, `failed`, or `aborted` | The latest run ended. Inspect its events and output; a yielded run can still have continuing task work. |

The same waiting state is used for approvals and application-executed custom tools. Do not
assume every `awaiting_approval` needs a permission decision. A 202 resolve receipt confirms
acceptance, rather than proving the run has resumed or the tool has executed.

Responses may carry additional fields beyond those listed. Ignore what you do not recognize
rather than failing on it.

## The transcript: `getSession({ history: true })`

Passing `history: true` adds the at-rest transcript, read from the session's stored
conversation rows:

::: code-group

```ts [TypeScript]
import { messageText } from '@zoowork-ai/sdk'

const s = await client.getSession(agentId, sessionId, { history: true, limit: 20 })
for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  const msg = row.entry.message as { role?: string }
  console.log(row.seq, msg.role, messageText(row.entry.message))
}
```

```python [Python]
from zoowork import message_text

s = await client.get_session(agent_id, session_id, history=True, limit=20)
for row in s.get("history", []):
    if row["entry_type"] != "message":
        continue
    message = row["entry"]["message"]
    print(row["seq"], message.get("role"), message_text(message))
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID?history=true&limit=20" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Each entry is `{ seq, entry_type, entry, created_at }`. For `entry_type: 'message'` the
conversation lives at `entry.message` as `{ role, content }`, where `content` is an array of
blocks and only `{ type: 'text', text }` blocks carry text. `messageText()` handles both the
array and the plain-string form.

`limit` is the number of most recent rows to return, default 100, maximum 500. Rows come back
in ascending `seq` order.

Example assistant row:

```json
{
  "seq": 2,
  "entry_type": "message",
  "entry": {
    "type": "message",
    "message": {
      "role": "assistant",
      "model": "litellm/gpt-5.6-terra",
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
        { "type": "text", "text": "Your display name is Ada." }
      ],
      "stopReason": "stop"
    }
  },
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

The transcript also includes:

- **Token usage.** `entry.message.usage` carries the token counts of that model message.
  The example above has `0` cost values. Do not use those values as a billing contract;
  use the [Usage API](../reference/usage.md) for consumption reporting.
- **The model that actually answered.** `model` is what the agent is configured with;
  `responseModel` is what served the request. A deployment can map a configured alias onto a
  substitute, so the two differ in the sample above. Trust `responseModel` when the answer
  feeds billing, evaluation, or a compliance record.

This is the transcript, not the event log. It holds conversational messages, not
`run.started` / `agent.tool` / `run.finished`. Use it to recover an answer whose events you
missed; use `listEvents` when you want the event stream. Other `entry_type` values exist
(session anchors, compaction markers, model changes); filter for `message` and skip the rest.

### Usage is not a session budget

Transcript token counts and the [Usage API](../reference/usage.md) help you observe consumption.
They do not enforce a spending limit on an individual session. The public session API does not
accept a `budget` or `max_list_cost` cap, pause at a dollar limit, or resume after you raise one.

A client timeout only stops your application from reading. A scheduled turn's execution
timeout is also different from a spending cap. Use [interrupts](./events.md#user-interrupt)
when your application needs to stop current work, and account for work already in flight.

## Read output for one run

When a [webhook](./webhooks.md) or saved event gives you a run ID, fetch the output of that
specific run rather than reading an entire conversation. Use `getRunOutput()` /
`get_run_output()` or the HTTP endpoint:

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/runs/$RUN_ID/output?limit=50" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

| Response field | Meaning |
|---|---|
| `run` | `run_id`, `session_id`, `status`, `terminal_outcome`, `started_at`, and `finished_at`. |
| `items` | Output entries with `seq`, `kind`, `source`, optional `text`, and `artifacts`. `kind` is `assistant`, `outbound`, or `attachment`. |
| `has_more` / `next_cursor` | Continue with `?cursor=...` while another page remains. `limit` defaults to 50 and is capped at 200. |
| `output_complete` | True only when the run is terminal and this page reaches the end of its output. |

A failed run may have partial output. An artifact reference can have `artifact_id: null`
when it is not registered as a downloadable artifact. Use registered IDs with the
[Artifacts methods](../reference/typescript-sdk.md) instead of assuming every output file has
a download URL.

`output_complete` describes this run's output. It does not establish that a business task
passed evaluation or that all asynchronous work finished. Follow
[task correlation on yielded turns](./events.md#when-a-turn-yields) when work spans runs.

## Store Session metadata

A Session's `metadata` is written when you call `createSession()`. The SDK has no
`patchSession`, and `PATCH` on a Session returns `405`.

Store each `session_id` beside the record it belongs to in your application. Add correlation
fields to `metadata` at creation; you cannot add them later. Session listing does not provide
an arbitrary metadata query.

### User attribution

Initial and later `user.message` events can carry `actor: { ref }` on API Sessions.
Choose the ref from authenticated backend state. `metadata.user_id` does not select it;
attribution does not authorize access, isolate files, or remove prior context. IM Sessions
reject caller actor. See [Message input rules](./events.md#user-message).

## List sessions

Session listing is scoped to one Agent. Store Agent ids in your application when you need to
find Sessions across several Agents.

Per-agent listing has two compatible lanes. `listSessions(agentId, { page })` keeps the old
numeric page: 50 rows, newest by `updated_at`, with `page` starting at 1. Python calls the same
lane with `list_sessions(agent_id, page=...)`.

Use `listSessionPage()` / `list_session_page()` when you need filters or resumable scanning:

::: code-group

```ts [TypeScript]
let cursor: string | undefined
do {
  const page = await client.listSessionPage(agentId, {
    cursor, limit: 100, runtimeModes: ['active'],
    includeArchived: false, includeDeleted: true,
  })
  for (const session of page.sessions) console.log(session.session_id)
  cursor = page.next_cursor ?? undefined
} while (cursor)
```

```python [Python]
cursor = "sls1:0"
while cursor is not None:
    page = await client.list_session_page(
        agent_id, cursor=cursor, limit=100, runtime_modes=["active"],
        include_archived=False, include_deleted=True,
    )
    for session in page.sessions:
        print(session["session_id"])
    cursor = page.next_cursor
```

```bash [curl]
curl -G "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'cursor=sls1:0' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'runtime_modes=active' \
  --data-urlencode 'include_archived=false' \
  --data-urlencode 'include_deleted=true'
```

:::

The curl request reads one page; continue with its `next_cursor`.

The initial cursor is `sls1:0`. Treat every cursor as opaque and keep all filters unchanged;
the cursor is bound to the Agent and filter scope, and invalid reuse returns
`400 invalid_cursor`. `limit` is 1–100. `runtime_modes` accepts `active`, `preview`,
`authoring`, and `evaluation`. Each row has `list_cursor`, so a consumer that stops partway
through a page can resume after the last processed row. `next_cursor` is null at the end.

Deleted Sessions are omitted by default. Set `includeDeleted: true` in TypeScript or
`include_deleted=True` in Python when a reconciliation job needs deletion tombstones. Those
rows carry `deleted: true`, and the page confirms the mode with `includes_deleted: true`.
The option is part of the cursor scope: keep it unchanged while continuing from a cursor.
Tombstones identify deleted Session ids; do not treat them as readable Session resources.

## Archive a session

Archive when you want to stop new input while keeping readable history:

::: code-group

```ts [TypeScript]
await client.archiveSession(agentId, sessionId)
```

```python [Python]
await client.archive_session(agent_id, session_id)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/archive" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

An in-flight run returns `409 session_running`. Send `user.interrupt`, observe its terminal
`run.finished`, then archive. Afterwards reads keep working, while new events return
`409 session_archived`. Repeating archive keeps the first archive timestamp.

## Delete a session

::: code-group

```ts [TypeScript]
await client.deleteSession(agentId, sessionId)
```

```python [Python]
await client.delete_session(agent_id, session_id)
```

```bash [curl]
curl -X DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Deletion sends a cancellation request for any in-flight run before hiding the session. If
that request fails, deletion fails too. After a successful delete, public session reads
return 404. Transcripts and events are retained for audit: this is a soft delete, not a
promise to physically erase every stored record or workspace file.

Neither lifecycle operation changes the application boundaries above: your application
still stores its Agent/session mapping, and public session metadata remains write-once.

Sessions separate conversation history. For application-user file and memory isolation, see
[An agent per user](./per-user-agents.md).

## SDK calls

::: code-group

```ts [TypeScript]
const output = await zc.getRunOutput(agentId, sessionId, runId, { limit: 50 })
const approvals = await zc.listApprovalPage(agentId, { sessionId, limit: 50 })
const calls = await zc.listCustomToolCallPage(agentId, { sessionId, limit: 50 })
```

```python [Python]
output = await client.get_run_output(agent_id, session_id, run_id, limit=50)
approvals = await client.list_approval_page(agent_id, session_id=session_id, limit=50)
calls = await client.list_custom_tool_call_page(agent_id, session_id=session_id, limit=50)
```

:::

Page methods preserve `has_more` and `next_cursor`. Existing list methods still return arrays. Detail helpers `getApproval` / `get_approval` and `getCustomToolCall` / `get_custom_tool_call` can retrieve terminal actions. An output page is complete only when `output_complete` is true; an artifact reference can have a null ID.
