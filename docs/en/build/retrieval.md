---
description: Use custom tools or MCP to connect an Agent to your application's knowledge service.
---

# Connect a knowledge base

Give the Agent a search tool when it needs facts from your product documentation, customer
records, or an existing knowledge base. Your service keeps the index and access controls.
The Agent sends a query, receives relevant passages, and uses them in its answer.

This recipe connects an existing search service through tools. It supplies the retrieval step
of a RAG application; it does not create a platform-managed index.

Examples reuse the client and Agent from [Quickstart](../get-started/quickstart.md). Python calls run inside an async function. For curl, complete the environment setup in [Authentication](../get-started/authentication.md).

## Choose an execution path

| Your search service | Use | Where credentials and access checks live |
|---|---|---|
| Your backend already calls it, or it needs private-network access | A custom tool | Your backend. |
| It exposes a publicly reachable MCP endpoint that accepts platform requests without stored credentials | MCP | The MCP service, within the public connection requirements. |

Start with a custom tool when you already have a retriever. You can use the same pattern for
SQL queries, vector search, or a third-party search API without changing your index.

## Retrieve through your application

### 1. Declare a search tool

Create an Agent with a custom tool that accepts a query. Use the persona to tell the Agent
when retrieved facts are required:

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const client = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const agent = await client.createAgent({
  resource: {
    name: 'support-assistant',
    persona: {
      docs: [{
        name: 'AGENTS.md',
        content: 'For product-specific facts, search the support documents first. Cite the returned sources. If the documents do not answer the question, say so.',
      }],
    },
    custom_tools: [{
      name: 'search_knowledge',
      description: 'Search approved support documents for product-specific facts. Returns relevant passages and source identifiers.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    }],
  },
})

await client.startAgent(agent.agent_id)
await client.waitUntilRunning(agent.agent_id)
```

```python [Python]
from zoowork import create_zoowork_client

client = create_zoowork_client()
agent = await client.create_agent(
    {
        "name": "support-assistant",
        "persona": {
            "docs": [
                {
                    "name": "AGENTS.md",
                    "content": "For product-specific facts, search the support documents first. Cite the returned sources. If the documents do not answer the question, say so."
                }
            ]
        },
        "custom_tools": [
            {
                "name": "search_knowledge",
                "description": "Search approved support documents for product-specific facts. Returns relevant passages and source identifiers.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string"
                        }
                    },
                    "required": [
                        "query"
                    ]
                }
            }
        ]
    },
)
await client.start_agent(agent["agent_id"])
await client.wait_until_running(agent["agent_id"])
```

```bash [curl]
agent=$(curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "resource": {
    "name": "support-assistant",
    "persona": {
      "docs": [
        {
          "name": "AGENTS.md",
          "content": "For product-specific facts, search the support documents first. Cite the returned sources. If the documents do not answer the question, say so."
        }
      ]
    },
    "custom_tools": [
      {
        "name": "search_knowledge",
        "description": "Search approved support documents for product-specific facts. Returns relevant passages and source identifiers.",
        "input_schema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string"
            }
          },
          "required": [
            "query"
          ]
        }
      }
    ]
  }
}
JSON
)
AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

The platform declares the tool to the model. Your application executes it when the Agent
requests it. Tool selection is model-directed; the description and persona guide that choice.

### 2. Execute the request and return passages

In this example, `searchSupportDocuments()` / `search_support_documents()` is **your application function**, imported from
your own service. It should return a small array of passages, each with a document identifier,
text, and a source URL when available. It must apply your application's access checks using
trusted request context rather than a user or tenant id supplied by the model.

::: code-group

```ts [TypeScript]
import { customToolUse, isRunFinished } from '@zoowork-ai/sdk'
import { searchSupportDocuments } from './knowledge-service.js'

const session = await client.createSession(agent.agent_id, {
  initial_events: [{
    type: 'user.message',
    content: 'What response time does our Enterprise support plan provide?',
  }],
})

for await (const ev of client.streamEvents(agent.agent_id, session.session_id)) {
  const call = customToolUse(ev)
  if (call?.phase === 'requested' && call.name === 'search_knowledge') {
    const query = call.input?.query
    let result: unknown
    if (typeof query !== 'string' || query.trim() === '') {
      result = { error: 'A non-empty query is required.' }
    } else {
      try {
        const passages = await searchSupportDocuments(query)
        result = { passages }
      } catch {
        result = { error: 'Document search is temporarily unavailable.' }
      }
    }
    await client.resolveCustomToolCall(agent.agent_id, call.callId, {
      content: [{ type: 'json', value: result }],
      resolvedBy: 'knowledge-service',
    })
  }
  if (isRunFinished(ev)) break
}
```

```python [Python]
from zoowork import custom_tool_use, is_run_finished
from knowledge_service import search_support_documents

session = await client.create_session(agent["agent_id"], {
    "initial_events": [{
        "type": "user.message",
        "content": "What response time does our Enterprise support plan provide?",
    }],
})
async for event in client.stream_events(agent["agent_id"], session["session_id"]):
    call = custom_tool_use(event)
    if call is not None and call.phase == "requested" and call.name == "search_knowledge":
        query = (call.input or {}).get("query")
        if not isinstance(query, str) or not query.strip():
            result = {"error": "A non-empty query is required."}
        else:
            try:
                result = {"passages": await search_support_documents(query)}
            except Exception:
                result = {"error": "Document search is temporarily unavailable."}
        await client.resolve_custom_tool_call(
            agent["agent_id"], call.call_id,
            content=[{"type": "json", "value": result}],
            resolved_by="knowledge-service",
        )
    if is_run_finished(event):
        break
```

:::

Returning passages resumes the waiting call so the Agent can continue. An empty result means
no matching accessible documents; a service error should remain an error in the returned
content rather than being presented as an empty search result. Keep error messages free of
credentials and private service details.

If your application restarts while the run is waiting, recover pending calls with
`listCustomToolCalls(agentId, { status: 'pending' })`. See
[Custom tools](./tools.md#execute-and-return-a-result) for result limits, timeout behavior,
and accepted-versus-consumed responses. Do not assume a pending request is executed exactly
once by your application.

## Retrieve through MCP

If your retriever exposes an MCP server meeting the [connection requirements](./mcp.md#connection-requirements),
declare only the search tools the Agent needs:

::: code-group

```ts [TypeScript]
await client.updateAgent(agent.agent_id, {
  mcp: [{
    name: 'knowledge',
    url: 'https://mcp.example.com/knowledge',
    transport: 'streamable-http',
    toolFilter: ['search_documents'],
    exposure: 'deferred',
  }],
})
```

```python [Python]
await client.update_agent(agent["agent_id"],
    {
        "mcp": [
            {
                "name": "knowledge",
                "url": "https://mcp.example.com/knowledge",
                "transport": "streamable-http",
                "toolFilter": [
                    "search_documents"
                ],
                "exposure": "deferred"
            }
        ]
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "mcp": [
    {
      "name": "knowledge",
      "url": "https://mcp.example.com/knowledge",
      "transport": "streamable-http",
      "toolFilter": [
        "search_documents"
      ],
      "exposure": "deferred"
    }
  ]
}
JSON
```

:::

The URL and tool name are placeholders for your service. The update replaces the complete
MCP array; include other servers the Agent should retain. The platform discovers the catalog
and calls the remote search tool directly. You do not handle a custom-tool result for that call.

The server must meet the public [MCP connection requirements](./mcp.md#connection-requirements).
For a private service or one authenticated by your backend, use the application path above.

## Keep answers tied to returned evidence

Return the passages needed for the question, with stable source identifiers. Ask the Agent
to cite those sources and to state when the retrieved material does not answer the question.
Large results can be truncated, so returning an entire collection makes useful evidence
harder to preserve.

Test one question whose answer exists only in your documents, one with no matching document,
and one whose matching document the current user cannot access. Verify the search result
and the final answer independently, using a fresh Session for each check.

## Next steps

- [Tools](./tools.md) — declaration fields, pending-call recovery, and result limits.
- [MCP servers](./mcp.md) — remote catalogs, connection requirements, and tool selection.
- [Permission policies](./permissions.md) — approvals before tool calls.
- [Authentication](../get-started/authentication.md) — API key scope and application authorization.
- [Agent Database](./data-storage.md) — choose Agent database tools or your own database.
- [Current boundaries](../reference/not-supported.md) — check connector setup and authorization availability.
