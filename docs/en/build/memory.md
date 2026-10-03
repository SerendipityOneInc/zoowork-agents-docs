---
description: Let an enabled agent save and retrieve durable facts across sessions, with agent and actor memory scopes.
---

# Agent memory

Memory tools let an enabled agent save durable facts and retrieve them in later sessions.
Use them for preferences, project conventions, and lessons that should outlive the current
conversation. The agent searches memory through a tool; a new session does not automatically
load every saved fact into its prompt.

Memory requires deployment support and a tool policy that permits the relevant tools.

## Save a preference and retrieve it later

These examples reuse the SDK client and running Agent from [Quickstart](../get-started/quickstart.md). For curl, use the environment variables from [Authentication](../get-started/authentication.md).

Use a running agent from [Quickstart](../get-started/quickstart.md) whose Memory tools are
available. Run these Bash examples on your backend with curl 7.76+ and jq 1.6+:

```bash
export AGENT_ID='your-existing-agent-id'
```

The key must authorize the Agent, including its project scope where applicable; see
[Authentication](../get-started/authentication.md). These examples omit `actor` and use the
Agent owner's private `user_agent` memory.

### 1. Ask the agent to save a fact

::: code-group

```ts [TypeScript]
let session = await zc.createSession(agentId, {
  "initial_events": [
    {
      "type": "user.message",
      "content": "I prefer CSV reports with ISO 8601 dates. Save this preference in user_agent memory with memory_create."
    }
  ]
})
let sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id,
    {
        "initial_events": [
            {
                "type": "user.message",
                "content": "I prefer CSV reports with ISO 8601 dates. Save this preference in user_agent memory with memory_create."
            }
        ]
    },
)
session_id = session["session_id"]
```

```bash [curl]
session=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{
    "type":"user.message",
    "content":"I prefer CSV reports with ISO 8601 dates. Save this preference in user_agent memory with memory_create."
  }]}')
SESSION_ID=$(jq -er '.session_id' <<<"$session")
```

:::

Read the event stream and inspect the Memory tool result:

::: code-group

```ts [TypeScript]
import { isRunFinished } from '@zoowork-ai/sdk'

for await (const event of zc.streamEvents(agentId, sessionId)) {
  console.log(event)
  if (isRunFinished(event)) break
}
```

```python [Python]
from zoowork import is_run_finished

async for event in client.stream_events(agent_id, session_id):
    print(event)
    if is_run_finished(event):
        break
```

```bash [curl]
curl -N -sS --fail-with-body \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream'
```

:::

Wait for `run.finished`, check `payload.status`, then press Ctrl+C. A successful message or
assistant reply alone does not prove that the fact was saved. Confirm the `memory_create`
result; if the tool is unavailable, the request cannot establish persistent memory.

### 2. Ask from a new session

Create a new session under the same Agent. Omit `actor` again to use the owner's memory:

::: code-group

```ts [TypeScript]
session = await zc.createSession(agentId, {
  "initial_events": [
    {
      "type": "user.message",
      "content": "Use memory_search on my user_agent memory to find my report format preferences, then describe the format you would use."
    }
  ]
})
sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id,
    {
        "initial_events": [
            {
                "type": "user.message",
                "content": "Use memory_search on my user_agent memory to find my report format preferences, then describe the format you would use."
            }
        ]
    },
)
session_id = session["session_id"]
```

```bash [curl]
session=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{
    "type":"user.message",
    "content":"Use memory_search on my user_agent memory to find my report format preferences, then describe the format you would use."
  }]}')
SESSION_ID=$(jq -er '.session_id' <<<"$session")
```

:::

Read this session's event stream using the command above. Look for `memory_search` and its
result before treating the answer as recalled memory. The prompt asks the model to search;
it is not a deterministic management call. Both sessions use the owner's memory because
neither message supplies an `actor`.

## Choose a memory scope

| Scope | Contains | Who can write it |
|---|---|---|
| `agent` | Facts safe for all users of this agent. | The owner's direct turns and authorized system activity. Other actors cannot edit this shared scope. |
| `user_agent` | Facts about the current actor interacting with this agent. | The current actor in a supported direct conversation. |

A direct turn can search the agent scope and its own actor's scope. Group turns can search
shared agent memory but cannot write it or use another user's memory. Without a usable actor
identity, user-scoped memory operations are refused.

For API sessions, send a stable `actor: { ref }` when one agent serves several application
users. Your backend must map an authenticated user to that ref. Omit `actor` to use the
agent owner. `metadata.user_id` does not select the actor. See [Events](./events.md#user-message)
for the accepted ref format.


For example, your backend can send this event for an authenticated application user:

```json
{"type":"user.message","content":"Use memory_search to find my report preferences.","actor":{"ref":"customer-42"}}
```

Use the same ref on later messages and sessions for that user. A different ref selects a
different `user_agent` scope and cannot read `customer-42`'s private memories through it.
Do not trust a ref supplied by an unauthenticated client.

::: warning Attribution is not authorization
`actor.ref` selects memory attribution. It does not authorize Agent/session access, erase an
existing transcript, or isolate `/workspace`. Authorize each request in your application.
Use [separate agents](./per-user-agents.md) when users must not share files.
:::

## Memory tool contract

These tools run inside the agent's loop. The arguments below are tool inputs, not HTTP
request bodies or SDK method calls.

| Tool | Arguments |
|---|---|
| `memory_create` | `content: string`, `scope: 'agent' \| 'user_agent'`. |
| `memory_search` | `query: string`, optional `scope: 'all' \| 'agent' \| 'user_agent'`, optional positive integer `maxResults`. |
| `memory_update` | `memoryId: string`, positive integer `expectedVersion`, `content: string`. |
| `memory_delete` | `memoryId: string`, positive integer `expectedVersion`. |

A create input might be:

```json
{"content":"Prefer CSV reports with ISO 8601 dates.","scope":"user_agent"}
```

Memory content is limited to 4,096 characters and 16 KiB of UTF-8 data. Search returns 8
results by default and accepts at most 20. Search may narrow the requested scope according
to the turn's identity and conversation type; `all` never grants access to another actor's
private memory.

Updates and deletes use a version from the current record. A write against a changed version
can fail with `MEMORY_VERSION_CONFLICT`; search again and use the current result before retrying.
An update whose content is already unchanged can return the saved result without a new write.
Use the ID and current version returned by the Memory tools. These tools run through
the Agent; the public SDK does not provide `memoryCreate()` or related methods.

## Capability boundaries

These are Agent-managed tools, not public memory-store, mount, or SDK CRUD endpoints.
See [Current API boundaries](../reference/not-supported.md).

A Session transcript, workspace file, or [Agent Database](./data-storage.md) is separate
from Memory. Creating or deleting a Session is not a memory management operation, and
`actor.ref` does not create private file or database storage.

## Memory and context compaction

When Memory is available and writes are permitted, the runtime can preserve useful facts
before compacting conversation context. It uses the same Memory tools to keep facts and
lessons, resolve contradictions, and avoid duplicates. This does not guarantee that every
statement is saved or that every turn searches Memory.
