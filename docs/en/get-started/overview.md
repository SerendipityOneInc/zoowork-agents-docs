---
description: Compare Managed Agents with your own agent loop, and understand its core resources, supported tools, execution flow, preview status, and billing.
---

# ZooWork Managed Agents overview

ZooWork Managed Agents provides a managed runtime for agents that work through tasks using
models and tools. Define an Agent, send it a task, and receive progress and results through
the TypeScript SDK, Python SDK, or HTTP API.

Your application supplies instructions, business tools, and user access checks. ZooWork
manages the model and tool loop, conversation history, sandbox execution, and saved events.
To get started, [create an API key and add funds](./authentication.md) in ZooWork Platform, then follow the [Quickstart](./quickstart.md) to run a report task.

## Managed Agents or your own agent loop

If your application calls a model, runs the tool calls it returns, and stores the history,
you own an agent loop. Managed Agents runs that loop for you.

| | Your own agent loop | ZooWork Managed Agents |
|---|---|---|
| **What it is** | Your application calls the model, executes tools, and sends results back | A managed runtime that runs the model and tool loop for a reusable Agent |
| **What you run** | Model calls, tool executors, sandbox infrastructure, and conversation storage | Your business tools, user access checks, and how results are presented |
| **Best for** | Fine-grained control over every model request | Multi-step tasks, sandboxed code and file work, and tasks that continue after your request returns |

[Move an agent loop to Managed Agents](./migration.md) maps each responsibility in detail.

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

## Supported tools

An Agent works through tools. Some run in the managed sandbox or on platform services; others
run in your backend or in a service you connect.

| Capability | Tools or mechanism | Guide |
|---|---|---|
| Sandbox files and commands | `read`, `write`, `edit`, `apply_patch`, `exec`, `process` | [Tools](../build/tools.md), [Cloud sandbox reference](../build/cloud-sandbox-reference.md) |
| Web search and fetch | `web_fetch`, `web_search`, `web_image_search` | [Tools](../build/tools.md) |
| PDFs and images | `pdf`, `image` | [Media tools](../build/tools.md#media-tools) |
| Output files | `artifact_publish`; upload input files into `/workspace` | [Files and artifacts](../build/files.md) |
| Durable facts | Memory tools, when enabled | [Agent memory](../build/memory.md) |
| Structured data | `agent_db` | [Agent Database](../build/data-storage.md) |
| Your business operations | Application-executed custom tools | [Custom tools](../build/tools.md#application-executed-custom-tools) |
| External services | Public remote MCP servers | [MCP servers](../build/mcp.md) |
| Reusable instructions | Skills | [Skills](../build/skills.md) |

Use `tool_policy` to narrow the tool set, and [Permission policies](../build/permissions.md) to
require approval before a call. A tool on this list can still be unavailable when its service or
deployment support is missing. See [Availability and limits](../reference/capabilities.md) before
depending on a workflow.

## Preview status and billing

The API is a Developer Preview. Responses can gain fields within a version, so ignore fields and
event types your application does not recognize instead of failing on them.

Agent tasks draw on your organization's prepaid balance, which all Projects in the
organization share. [Usage](../reference/usage.md) reports consumption in Platform credits.
Usage reporting is not a spending cap: the public API has no server-enforced per-Session cap,
so enforce your own policy and [interrupt work](../build/events.md#user-interrupt) when
needed. Check the balance and actual charges in [ZooWork Platform](https://platform.zoowork.ai).

## Next steps

- [Quickstart](./quickstart.md): get an API key and complete your first task.
- [Migration](./migration.md): move an application-owned agent loop to Managed Agents.
- [Agent configuration](../build/agents.md): define and manage the reusable Agent.
- [Start a session](../build/sessions.md): send tasks and continue conversations.
- [Session operations](../build/session-operations.md): read execution state and manage stored conversations.
