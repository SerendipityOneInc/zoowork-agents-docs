---
description: Move an application-owned agent loop to Managed Agents while retaining business tools and user access checks.
---

# Move an agent loop to Managed Agents

If your application calls a model, executes its tool calls, and sends the results back to
the model, you own an agent loop. Managed Agents runs that loop for you. Your application
still authenticates users, controls business data access, and presents results.

## Map responsibilities

| Responsibility | With an application-owned loop | With Managed Agents |
|---|---|---|
| Instructions, model, and tool definitions | Included in model requests | Configure a reusable Agent |
| Model calls and built-in tool execution | Your application runs the loop and executor | ZooWork runs the model and tools |
| Conversation history | Your application supplies it on each model request | A Session retains it for later turns |
| Task progress and tool records | Your application captures them | Read saved Session events or stream responses |
| Business tools and data authorization | Your backend executes and authorizes operations | Your backend still handles application-executed custom tools |
| User identity and access to conversations | Your application checks access | Your application still maps users to Agents and Sessions and checks access |

## Replace the loop with a task

Consider a task that writes a sales report. Before migration, your application calls the
model repeatedly, runs file tools, and saves the accumulated history. The following is
pseudocode; the functions represent your application's own implementation:

```text
history = load_conversation(conversation_id)
history.append(user_message("Write a sales report to report.md"))
while true:
    response = call_model(history, tools=[write_file, read_file])
    history.append(response)
    if response.has_no_tool_calls:
        break
    for call in response.tool_calls:
        result = execute_tool(call)
        history.append(tool_result(call.id, result))
save_conversation(conversation_id, history)
```

After migration, create an Agent once, start it, and send the task through a Session.
The runtime executes its configured file tools. Set your [API key](./authentication.md)
before running the examples. Python calls run inside an async function; curl also uses the HTTP environment variables from that page:

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const client = createZooworkClient()
const agent = await client.createAgent({
  resource: {
    name: 'report-agent',
    persona: { docs: [{
      name: 'AGENTS.md',
      content: 'Create reports using workspace file tools.',
    }] },
  },
})
await client.startAgent(agent.agent_id)
await client.waitUntilRunning(agent.agent_id)

const session = await client.createSession(agent.agent_id, {
  initial_events: [{
    type: 'user.message',
    content: 'Write report.md for January sales: 12 units at $10 each. Check the total.',
  }],
})
```

```python [Python]
from zoowork import create_zoowork_client

async with create_zoowork_client() as client:
    agent = await client.create_agent({
        "name": "report-agent",
        "persona": {"docs": [{
            "name": "AGENTS.md",
            "content": "Create reports using workspace file tools.",
        }]},
    })
    await client.start_agent(agent["agent_id"])
    await client.wait_until_running(agent["agent_id"])
    session = await client.create_session(agent["agent_id"], {
        "initial_events": [{
            "type": "user.message",
            "content": "Write report.md for January sales: 12 units at $10 each. Check the total.",
        }],
    })
```

```bash [curl]
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"resource":{"name":"report-agent","persona":{"docs":[{"name":"AGENTS.md","content":"Create reports using workspace file tools."}]}}}')
AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" &&
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{"type":"user.message","content":"Write report.md for January sales: 12 units at $10 each. Check the total."}]}'
```

:::

Save `agent.agent_id` and `session.session_id` alongside your application's conversation ID.
[Events and streaming](../build/events.md) shows how to display progress and determine when
the task has ended. Follow the [Quickstart](./quickstart.md) for a complete stream reader,
result checks, and cleanup.

## Keep business tools in your backend

For private document retrieval or business updates, declare an
[application-executed custom tool](../build/tools.md). ZooWork creates a pending call;
your backend checks arguments and user permissions, executes the operation, and submits
the result. Declaring a tool does not grant database access.

Keep side effects idempotent. Reconnecting to a stream or replaying events can expose the
same call again; it does not provide exactly-once execution for your business operations.

## Preserve conversation and workspace boundaries

Create a Session for a new conversation and send later messages to the same Session.
Separate Sessions retain separate conversation histories, but Sessions on one Agent share
its workspace, including with sandbox scope `session`. Use
[an Agent per user](../build/per-user-agents.md) when users need separate file workspaces.

Store the event cursor after successfully processing each record so you can resume after
a disconnection. Closing the reader does not cancel execution. Inspect run termination
and lineage before treating a `run.finished` event as task completion.

## Migrate one workflow first

Choose one task and verify its input, tool results, output, and cleanup. Add
[Webhooks](../build/webhooks.md) for server notifications or [Schedules](../build/schedules.md)
for recurring work after that task works. For supported public capabilities and their
conditions, see [Availability and limits](../reference/capabilities.md).
