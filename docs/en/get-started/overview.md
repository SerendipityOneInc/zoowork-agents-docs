---
description: Understand the core resources, execution flow, and use cases for ZooWork Managed Agents.
---

# ZooWork Managed Agents overview

ZooWork Managed Agents provides a managed runtime for agents that work through tasks using
models and tools. Define an Agent, send it a task, and receive progress and results through
the TypeScript SDK, Python SDK, or HTTP API.

Your application supplies instructions, business tools, and user access checks. ZooWork
manages the model and tool loop, conversation history, sandbox execution, and saved events.
To get started, [create an API key and add funds](./authentication.md) in ZooWork Platform, then follow the [Quickstart](./quickstart.md) to run a report task.

## Core concepts

Managed Agents uses four resources:

| Concept | What it represents |
|---|---|
| **Agent** | Reusable instructions, model selection, tools, and Skills, with a start/stop lifecycle and persistent workspace. |
| **Environment** | Sandbox packages, files, and network policy. Agents use a managed default sandbox; custom Environment management is not available with Platform keys. |
| **Session** | A persistent conversation belonging to one Agent. Send another message to continue it. |
| **Event** | A message or execution update in a Session, including responses, tool activity, and turn completion. |

For example, a report Agent can have a Session for a sales report. The request, tool activity,
and response appear as Events. Sessions on the same Agent share its workspace by default;
use [an Agent per user](../build/per-user-agents.md) when users need separate workspaces.

## How it works

1. **Define and start an Agent.** Configure instructions and tools, then start it so it can accept Sessions.
2. **Start a Session.** Create a conversation and supply its first user message.
3. **Send events and stream responses.** ZooWork runs the model and tools. Your application receives responses, tool progress, and run completion events.
4. **Continue or interrupt work.** Send another message to the same Session or explicitly interrupt execution. Closing the stream alone does not stop the run.

A `run.finished` event describes the end of one run. Inspect its termination fields before
presenting the task as complete; a run may yield while waiting for more work. See
[Events and streaming](../build/events.md).

Conversation history and workspace files have lifecycles separate from active sandbox
compute. [Architecture](./architecture.md) explains how persistent state and managed
execution fit together. [Agent trajectories](./trajectories.md) explains how saved execution
records can support your application's evaluation workflow.

## When to use Managed Agents

Use Managed Agents for applications that need:

- **Tasks with multiple steps:** let an Agent choose and run tools to produce and check a result.
- **Managed Cloud execution:** run code and file operations without building sandbox infrastructure.
- **Persistent conversations:** continue tasks with saved conversation history and workspace files.
- **Asynchronous progress:** follow work through saved events, streaming responses, or webhooks.
- **Recurring tasks:** use Schedules for work that should run at a configured cadence.

## Configure capabilities

Choose [built-in or application-executed tools](../build/tools.md), connect
[MCP servers](../build/mcp.md), set [Permission policies](../build/permissions.md), and attach
[Skills](../build/skills.md). The [Cloud sandbox reference](../build/cloud-sandbox-reference.md) describes the default execution environment.

Public resource access depends on the available routes and service configuration. See
[Availability and limits](../reference/capabilities.md) before depending on a workflow.

## Next steps

- [Quickstart](./quickstart.md): get an API key and complete your first task.
- [Migration](./migration.md): move an application-owned agent loop to Managed Agents.
- [Agent configuration](../build/agents.md): define and manage the reusable Agent.
- [Start a session](../build/sessions.md): send tasks and continue conversations.
- [Session operations](../build/session-operations.md): read execution state and manage stored conversations.
