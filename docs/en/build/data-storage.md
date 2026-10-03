---
description: Use the agent_db tool for Agent-owned structured data; direct database inspection is unavailable in production.
---

# Agent Database

Agent Database gives an Agent its own managed libSQL database. The Agent uses `agent_db`
to create tables, write rows, and query them during a task. Ask the Agent to query its data
and return the result in a Session response or publish a report as an Artifact.

The database belongs to the Agent across its sessions. A new Session or `actor.ref` does not
create a separate database. Use [an Agent per user](./per-user-agents.md) when users must not
share agent-owned data.

## Before you begin

These examples reuse the SDK client and running Agent from [Quickstart](../get-started/quickstart.md). For curl, use the environment variables from [Authentication](../get-started/authentication.md).

The Agent's tool policy must allow `agent_db`. The production database viewer is unavailable,
independently of this working tool. Complete
[Quickstart](../get-started/quickstart.md), then reuse its running Agent and API Session.

Run the following blocks in Bash on your backend, with curl 7.76+ and jq 1.6+. The key must
authorize that Agent, including its project scope where applicable; see
[Authentication](../get-started/authentication.md).

```bash
export AGENT_ID='your-existing-agent-id'
export SESSION_ID='your-existing-session-id'
```

## Use Agent Database

The first `agent_db` call provisions the Agent's database when database support is available.
The tool accepts a non-empty `sql` string and optional positional `args`, defaulting to `[]`.
The Agent does not choose a hostname, database name, or credential.

### Ask the agent to create a table

Send a task that explicitly selects Agent Database:

::: code-group

```ts [TypeScript]
const receipt = await client.postEvents(agentId, sessionId, [
  {
    "type": "user.message",
    "content": "Use agent_db to create a sales table with month TEXT PRIMARY KEY and amount INTEGER NOT NULL. Insert or replace January=100, February=120, and March=80 using SQL parameters, then query the total. Use Agent Database, not a workspace SQLite file.",
    "idempotency_key": "agent-db-sales-01"
  }
])
console.log(receipt.events[0]?.accepted)
```

```python [Python]
receipt = await client.post_events(agent_id, session_id,
    [
        {
            "type": "user.message",
            "content": "Use agent_db to create a sales table with month TEXT PRIMARY KEY and amount INTEGER NOT NULL. Insert or replace January=100, February=120, and March=80 using SQL parameters, then query the total. Use Agent Database, not a workspace SQLite file.",
            "idempotency_key": "agent-db-sales-01"
        }
    ],
)
if not receipt or receipt[0].get("accepted") is not True:
    raise RuntimeError("The message was not accepted")
```

```bash [curl]
curl -sS --fail-with-body \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{
    "type":"user.message",
    "content":"Use agent_db to create a sales table with month TEXT PRIMARY KEY and amount INTEGER NOT NULL. Insert or replace January=100, February=120, and March=80 using SQL parameters, then query the total. Use Agent Database, not a workspace SQLite file.",
    "idempotency_key":"agent-db-sales-01"
  }]}'
```

:::

Check `receipt.events[0].accepted` in TypeScript or `receipt[0]["accepted"]` in Python,
then read the [event stream](./events.md#streaming-a-turn) from the last processed cursor
for this existing Session until the new turn's `run.finished`. Inspect the `agent_db` results for the table, rows, and total.
An accepted message alone does not prove that the tool ran or provisioned a database.

For example, after creating the table, the Agent can insert a row with these tool arguments:

```json
{"sql":"INSERT INTO sales (month, amount) VALUES (?, ?)","args":["April",90]}
```

This is a tool input, not a public SQL request body. Schema initialization and data changes
are performed through the Agent's tool calls.

### Database viewer availability

The production database viewer is unavailable. Its catalog and table-row requests return
404 even when `agent_db` has created data successfully. The published SDK contains viewer
methods, but they are not a supported production integration path. Changing pagination or
creating another table does not enable the viewer.

To inspect data now, ask the Agent to query it with `agent_db` and return the result through
[Session events](./events.md), or create and publish a report through [Artifacts](./files.md).
These are Agent-mediated results, not a direct database query API for your application.

## Other data sources

A SQLite file in `/workspace` is a workspace file, separate from Agent Database. The database
viewer does not inspect it. The default sandbox's `psql` and `redis-cli` connect to services
you provide; installing clients does not create servers or configure credentials. See
[Cloud sandbox reference](./cloud-sandbox-reference.md#databases) and
[Files and artifacts](./files.md).

Agent Database stores structured rows; it does not create a managed document index or RAG
API. Connect an existing application database or retrieval service through
[custom tools](./tools.md#application-executed-custom-tools) or [MCP](./mcp.md).
See [Retrieval and data connections](./retrieval.md) for that integration pattern.
