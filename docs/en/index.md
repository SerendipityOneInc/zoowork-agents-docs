---
title: ZooWork Managed Agents
description: Put agents to work in your application. ZooWork runs their tasks and captures execution history, so you can understand results and improve how your agents perform.
layout: page
sidebar: false
aside: false
hero:
  text: Build with agents. We handle the runtime.
  tagline: Put agents to work in your application. ZooWork runs their tasks and captures execution history, so you can understand results and improve how your agents perform.
home:
  hero:
    accent: We handle the runtime.
    actions:
      - text: Quickstart
        link: /en/get-started/quickstart
        theme: primary
      - text: Overview
        link: /en/get-started/overview
      - text: TypeScript SDK
        link: /en/reference/typescript-sdk
        theme: text
    sampleTabsLabel: SDK language
    samples:
      - id: typescript
        label: TypeScript
        install: npm i @zoowork-ai/sdk
        meta: Create an agent and session · Node.js 22.20+
      - id: python
        label: Python
        install: python -m pip install zoowork
        meta: Create an agent and session · Python 3.10+
    sampleLinkText: Full Quickstart
    sampleLink: /en/get-started/quickstart
    streamLabel: EXAMPLE SESSION EVENTS
  nouns:
    title: Agent, Session, Event
    intro: Configure an Agent, start a Session, and follow its Events. ZooWork provides
      the managed sandbox for execution.
    items:
      - name: Agent
        id: agt_
        body: A persistent, versioned configuration — model, persona, skills, tool policy.
          It comes back stopped, so start it before it will accept sessions.
        linkText: Agents
        link: /en/build/agents
      - name: Session
        id: opaque id
        body: One conversation, created as a sub-resource of an agent. It holds the transcript
          and scopes every event you write or read.
        linkText: Sessions
        link: /en/build/sessions
      - name: Event
        id: seq
        body: The unit in both directions. You write five types and read back a durable,
          sequence-numbered log that resumes from the last cursor you saw.
        linkText: Events and streaming
        link: /en/build/events
  journey:
    title: From key to production
    intro: Create an API key and add funds in ZooWork Platform, then run your first task.
    stages:
      - name: Get started
        hint: Get a key, add funds, and run your first task
        chips:
          - { text: Authentication and API keys, link: /en/get-started/authentication, icon: key }
          - { text: Overview, link: /en/get-started/overview, icon: compass }
          - { text: Quickstart, link: /en/get-started/quickstart, icon: play }
          - { text: Architecture, link: /en/get-started/architecture, icon: layers }
          - { text: Agent trajectories, link: /en/get-started/trajectories, icon: pulse }
          - { text: Migration, link: /en/get-started/migration, icon: layers }
      - name: Define your agent
        hint: Configure instructions and capabilities
        chips:
          - { text: Agent configuration, link: /en/build/agents, icon: agent }
          - { text: Tools, link: /en/build/tools, icon: wrench }
          - { text: MCP servers, link: /en/build/mcp, icon: brackets }
          - { text: Permission policies, link: /en/build/permissions, icon: key }
          - { text: Skills, link: /en/build/skills, icon: skill }
      - name: Understand the Cloud sandbox
        hint: Explore the managed execution environment
        chips:
          - { text: Cloud sandbox reference, link: /en/build/cloud-sandbox-reference, icon: brackets }
      - name: Delegate work to your agent
        hint: Send tasks and observe execution
        chips:
          - { text: Start a session, link: /en/build/sessions, icon: thread }
          - { text: Session operations, link: /en/build/session-operations, icon: layers }
          - { text: Events and streaming, link: /en/build/events, icon: pulse }
          - { text: Webhooks, link: /en/build/webhooks, icon: pulse }
      - name: Manage agent context
        hint: Provide input and retrieve results
        chips:
          - { text: Files and artifacts, link: /en/build/files, icon: layers }
          - { text: Agent Database, link: /en/build/data-storage, icon: brackets }
      - name: Build persistent memory
        hint: Save and recall Agent memory
        chips:
          - { text: Memory, link: /en/build/memory, icon: layers }
      - name: Advanced orchestration
        hint: Run recurring tasks
        chips:
          - { text: Schedules, link: /en/build/schedules, icon: play }
      - name: Integrate your product
        hint: Provide separate workspaces for your users
        chips:
          - { text: An agent per user, link: /en/build/per-user-agents, icon: users }
      - name: Reference
        hint: Look up API behavior and availability
        chips:
          - { text: Authentication, link: /en/get-started/authentication, icon: key }
          - { text: TypeScript SDK, link: /en/reference/typescript-sdk, icon: brackets }
          - { text: Python SDK, link: /en/reference/python-sdk, icon: brackets }
          - { text: Models, link: /en/reference/models, icon: layers }
          - { text: Usage, link: /en/reference/usage, icon: pulse }
          - { text: Errors, link: /en/reference/errors, icon: alert }
          - { text: Availability and limits, link: /en/reference/capabilities, icon: layers }
  band:
    title: Define the Agent once. Continue work through Sessions.
    body: Agent configuration describes the model, instructions, tools, Skills, and runtime.
      Sessions keep each conversation and its event history separate.
    columns:
      - title: Define capabilities
        body: Select built-in tools, connect MCP servers, and attach reusable Skills.
        linkText: Configure tools
        link: /en/build/tools
      - title: Run and observe
        body: Start a Session, send a message, and consume its durable event stream.
        linkText: Create a Session
        link: /en/build/sessions
---

<ZcHome>

<template v-slot:intro>

Put agents to work in your application. ZooWork runs their tasks and captures execution history, so you can understand results and improve how your agents perform.

[Create an API key and add funds](./get-started/authentication.md) in [ZooWork Platform](https://platform.zoowork.ai), then follow the [Quickstart](./get-started/quickstart.md).

</template>

<template v-slot:sample-typescript>

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const client = createZooworkClient()
const agent = await client.createAgent({
  resource: { name: 'quickstart-agent' },
})
await client.startAgent(agent.agent_id)

const session = await client.createSession(agent.agent_id, {
  initial_events: [{
    type: 'user.message',
    content: 'What can you do?',
  }],
})
```

</template>

<template v-slot:sample-python>

```python
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        agent = await client.create_agent({"name": "quickstart-agent"})
        await client.start_agent(agent["agent_id"])
        await client.create_session(agent["agent_id"], {
            "initial_events": [{
                "type": "user.message",
                "content": "What can you do?",
            }],
        })

asyncio.run(main())
```

</template>

<template v-slot:edges>

Start with the [Overview](./get-started/overview.md) to learn how ZooWork works, or follow the
[Quickstart](./get-started/quickstart.md) for a complete task, outcome checks, and cleanup.

When you add capabilities, use [Tools](./build/tools.md) for built-in and application-executed
tools, [MCP servers](./build/mcp.md) for remote tools, and
[Permission policies](./build/permissions.md) when a tool call should wait for approval.
Use [Events and streaming](./build/events.md) to present progress and completion in your product.

Use [Files and artifacts](./build/files.md) and [Agent Database](./build/data-storage.md) to manage task context. Use [Memory](./build/memory.md) for persistent recall and the [Cloud sandbox reference](./build/cloud-sandbox-reference.md) to understand the default execution environment. Check [Availability and limits](./reference/capabilities.md) for each workflow’s conditions.

</template>
</ZcHome>
