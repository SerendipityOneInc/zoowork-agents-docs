---
description: Learn what ZooWork Managed Agents provides, when to use it, and how agents, sessions, and events work together.
---

# ZooWork Managed Agents overview

ZooWork Managed Agents lets you run agents from your own application through the TypeScript
SDK or HTTP API. An agent can work through a task using tools, such as writing a file,
running a command, or calling a configured external service.

You define the agent's instructions and available tools, send tasks, and present the results
to your users. ZooWork manages the model and tool loop, conversation history, sandbox
execution, and event storage. Your application receives progress and responses through an
event stream.

To run your first task, follow the [Quickstart](./quickstart.md).

## When to use Managed Agents

Use Managed Agents when your application needs to:

- **Delegate tasks with multiple steps.** Let an agent choose and run tools to complete work,
  such as creating and checking a report.
- **Continue a conversation.** Send follow-up messages in the same Session with its saved
  conversation history.
- **Follow execution as it happens.** Display responses and tool progress, read saved events,
  and reconnect to the event stream.
- **Run code and file operations in a managed sandbox.** Configure the agent without building
  your own tool execution infrastructure.

## Core concepts

| Concept | What it represents |
|---|---|
| **Agent** | A reusable configuration with instructions, model selection, tools, and Skills, plus a start/stop lifecycle. |
| **Session** | A persistent conversation belonging to one Agent. Send another message to continue it. |
| **Event** | A message or execution update saved in a Session, including responses, tool activity, and turn completion. |

For example, an Agent configured to prepare reports can have a Session for a sales report.
Your request, its tool activity, and its response appear as Events in that Session.
See [Core concepts](./concepts.md) for resource details and lifecycles.

## How it works

1. **Create and start an Agent.** Define its configuration and start it so it can accept Sessions.
2. **Create a Session.** Start a conversation with that Agent.
3. **Send a message.** Describe the task you want it to complete.
4. **Read the event stream.** ZooWork runs the model and tools; your application receives
   responses, tool activity, and a `run.finished` event with the turn's outcome.
5. **Continue the conversation.** Send the next message to the same Session. Its history
   remains available after a turn finishes.

The default sandbox is managed on demand. You do not need to create an Environment for your
first task. For a closer look at execution and persistent state, see [Architecture](./architecture.md).

## Configure your agent

- [Agents](../build/agents.md): configure instructions and model selection.
- [Tools](../build/tools.md): control built-in tools and connect MCP servers.
- [Skills](../build/skills.md): add reusable task instructions and resources.
- [Environments](../build/environments.md): customize sandbox dependencies and network rules.

Sessions on the same Agent share its workspace by default. For separate user workspaces,
follow [An agent per user](../build/per-user-agents.md).

## Next steps

- [Quickstart](./quickstart.md): create an Agent and complete a report task.
- [TypeScript SDK](../reference/typescript-sdk.md): look up client methods and options.
- [Capability matrix](../reference/capabilities.md): check support and verification status.
