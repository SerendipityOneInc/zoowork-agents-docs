---
description: Use the agent_db tool for agent-owned structured data and inspect its tables through the public API.
---

# Agent Database

Agent Database gives an Agent its own managed libSQL database. The Agent uses `agent_db`
to create tables, write rows, and query them during a task. Your application can inspect
existing tables through a read-only public API.

The database belongs to the Agent across its sessions. A new Session or `actor.ref` does not
create a separate database. Use [an Agent per user](./per-user-agents.md) when users must not
share agent-owned data.

## Before you begin

These examples reuse the SDK client and running Agent from [Quickstart](../get-started/quickstart.md). For curl, use the environment variables from [Authentication](../get-started/authentication.md).

The deployment must provide the `agent_db` tool and the database viewer; they can be
available independently. The Agent's tool policy must allow `agent_db`. Complete
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
const receipt = await zc.postEvents(agentId, sessionId, [
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

Check the receipt's `events[0].accepted`, then read the [event stream](./events.md#streaming-a-turn)
until `run.finished`. Inspect the `agent_db` results for the table, rows, and total.
An accepted message alone does not prove that the tool ran or provisioned a database.

For example, after creating the table, the Agent can insert a row with these tool arguments:

```json
{"sql":"INSERT INTO sales (month, amount) VALUES (?, ?)","args":["April",90]}
```

This is a tool input, not a public SQL request body. Schema initialization and data changes
are performed through the Agent's tool calls.

### Inspect existing tables

Read the Agent's database catalog:

```bash
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/database" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

A ready response contains `status: "ready"` and `tables`, with each table's `name` and `kind`.
If no database has been provisioned, the response is:

```json
{"status":"not_provisioned"}
```

The viewer does not provision a database. If viewer support is unavailable, the request can
return `404`. First check that the same key can read the Agent before interpreting that
response as a database availability result.

Once `sales` exists, read its rows:

```bash
curl -sS --fail-with-body --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/database/tables/sales/rows" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'limit=20' \
  --data-urlencode 'offset=0'
```

The response contains `status`, `table`, `schema`, `columns`, `rows`, `limit`, and `offset`.
`limit` defaults to 100 and accepts integers from 1 through 100. `offset` defaults to 0
and must be a non-negative integer. An unknown table returns `404`; invalid pagination
returns `400`; a database removed during inspection can return `409 database_unavailable`.

These endpoints are read-only and do not expose arbitrary SQL execution or writes.
Use `getAgentDatabase()` / `get_agent_database()` and table-row helpers, or HTTP.

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

## SDK calls

::: code-group

```ts [TypeScript]
const catalog = await zc.getAgentDatabase(agentId)
const page = await zc.getAgentDatabaseRows(agentId, 'results', { limit: 100, offset: 0 })
```

```python [Python]
catalog = await client.get_agent_database(agent_id)
page = await client.get_agent_database_rows(agent_id, "results", limit=100, offset=0)
```

:::

These read-only helpers never provision a missing database. Preserve `status: "not_provisioned"` and unknown fields.
