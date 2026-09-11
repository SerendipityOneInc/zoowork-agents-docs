---
description: See how the Managed Agents API connects your application to models, tools, and isolated execution, with persistent state and on-demand compute.
---

# Architecture

The **Managed Agents API** gives your application persistent agents with managed execution.
You define what an agent should do, send messages, and receive events. The API manages the
model and tool loop, conversation state, and sandbox lifecycle.

## Application and managed execution

![Your application sends messages to the Managed Agents API and receives SSE events. The API manages sessions and context, calls models for inference, runs code and file operations in an isolated sandbox, and connects to external tools.](https://assets.yesy.site/f/images/2026/09/qdvtaf6e.png)

[View architecture diagram full size](https://assets.yesy.site/f/images/2026/09/qdvtaf6e.png)

Your application connects through the TypeScript SDK or HTTP. Both use the same API and the
same Agent, Session, and Event resources.

| Component | Responsibility |
|---|---|
| **Your application** | Defines agent instructions and available tools, maps agents to users, sends messages, and presents results. |
| **Managed Agents API** | Maintains sessions and context, coordinates model and tool calls, manages execution, and saves and streams events. |
| **Models** | Generate responses and choose tool calls within the agent's configuration. |
| **Sandbox** | Provides isolated execution for code, commands, and file operations. |
| **External tools** | Connect the agent to configured MCP servers and services, subject to their access requirements. |

For example, the [Quickstart](./quickstart.md) asks an agent to create a sales report.
The model chooses the tools, the sandbox writes and reads `report.md`, and your application
receives progress and the response through the Session's event stream.

The API saves events as work progresses. Your application can read history and reconnect to
the stream without creating a new Session. A `run.finished` event ends one turn; the Session
remains available for the next message. See [Events and streaming](../build/events.md).

## Persistent state and on-demand compute

An agent's state and its compute have independent lifecycles. The conversation and working
files can outlive an individual period of sandbox execution, so an agent can work, wait, and
continue later without keeping its sandbox continuously active.

![Agent and session state and workspace files remain available across a timeline of running, paused, running, and paused sandbox compute. Compute pauses according to the sandbox lifecycle policy and resumes on demand.](https://assets.yesy.site/f/images/2026/09/9b1wf1tq.png)

[View compute lifecycle diagram full size](https://assets.yesy.site/f/images/2026/09/9b1wf1tq.png)

| Layer | Across a sandbox pause |
|---|---|
| **Agent and Session state** | Agent configuration, conversation history, and saved events remain available. |
| **Workspace files** | Files in the persistent workspace are stored separately from active compute. |
| **Sandbox compute** | Execution pauses according to the lifecycle policy and resumes when needed. |

After creating `report.md`, the agent can wait for your next message. When you ask it to add
a forecast, it can use the existing conversation and workspace file and resume tool execution.
Your application continues with the same Agent and Session.

::: info Sandbox lifecycle
Automatic pause and resume are managed runtime behavior. Pausing follows the sandbox
lifecycle policy; `run.finished` does not mean compute pauses immediately. Explicitly
stopping an Agent releases its sandbox and is a different operation from automatic pause.
This lifecycle description is source-reviewed, not a live timing or performance guarantee.
:::

## Configuration and isolation

An **Agent** defines instructions, model selection, tools, and Skills. A **Session** holds
one conversation with that Agent. An optional **Environment** supplies the sandbox's packages,
files, and network policy; use the default Environment to get started.

By default, Sessions belonging to the same Agent share its sandbox and workspace. For an
application that needs separate user workspaces, create [an Agent per user](../build/per-user-agents.md).

The [capability matrix](../reference/capabilities.md) records verification status. Public API
gaps are listed separately under [Not supported](../reference/not-supported.md).

## Next steps

- [Core concepts](./concepts.md): Agent, Session, and Event resources and their lifecycles.
- [Tools](../build/tools.md): configure what the agent can execute or access.
- [Environments](../build/environments.md): prepare custom dependencies and network rules.

## Check your understanding

::: details Does a finished turn end the Session?
No. `run.finished` records the outcome of one turn. Send another message to continue the
same Session, or read its saved history later.
:::

::: details Does a paused sandbox lose the conversation or workspace files?
No. Session history and persistent workspace files have lifecycles separate from active
compute. Automatic pause lets execution wait while that state remains available.
:::

::: details Does each Session have a separate workspace?
Not by default. Sessions on the same Agent share its workspace. Use separate Agents when
you need separate user workspaces.
:::
