---
title: ZooWork Managed Agents
description: Build agent products with the ZooWork TypeScript SDK, sessions, and streaming events.
layout: page
sidebar: false
aside: false
hero:
  text: Create an agent, stream every event.
  tagline: A hosted runtime for agents you drive from your own code. Durable, resumable
    event streams; skills, sessions and chat channels; one API key and one TypeScript SDK.
home:
  hero:
    accent: stream every event.
    actions:
      - text: Quickstart
        link: /en/get-started/quickstart
        theme: primary
      - text: TypeScript SDK
        link: /en/reference/typescript-sdk
    note: Create your key in the ZooWork App, under Settings → API Keys.
    noteLink: /en/get-started/authentication
    sampleMeta: Abbreviated · Node 20+ · ESM · ZOOWORK_API_KEY
    sampleLinkText: Full runnable example
    sampleLink: /en/get-started/quickstart
    streamLabel: EXAMPLE SESSION EVENTS
  nouns:
    title: Four nouns carry the whole API
    intro: Everything the SDK does is a verb on one of these. Learn them once and every
      reference page reads itself.
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
        body: The unit in both directions. You write four types and read back a durable,
          sequence-numbered log that resumes from the last cursor you saw.
        linkText: Events and streaming
        link: /en/build/events
      - name: Skill
        id: skl_
        body: A packaged capability in the registry, versioned independently of any agent.
          Install it unpinned and one publish reaches every agent that has it.
        linkText: Skills
        link: /en/build/skills
  journey:
    title: From key to production
    intro: The lifecycle in order — or jump straight to the page you need.
    stages:
      - name: Get started
        hint: Key to first streamed reply
        chips:
          - { text: Quickstart, link: /en/get-started/quickstart, icon: play }
          - { text: Authentication, link: /en/get-started/authentication, icon: key }
          - { text: Core concepts, link: /en/get-started/concepts, icon: compass }
      - name: Build
        hint: The loop, surface by surface
        chips:
          - { text: Agents, link: /en/build/agents, icon: agent }
          - { text: Sessions, link: /en/build/sessions, icon: thread }
          - { text: Events and streaming, link: /en/build/events, icon: pulse }
          - { text: Skills, link: /en/build/skills, icon: skill }
          - { text: Tools, link: /en/build/tools, icon: wrench }
          - { text: Environments, link: /en/build/environments, icon: layers }
      - name: Ship to users
        hint: Your product, their agents
        chips:
          - { text: An agent per user, link: /en/build/per-user-agents, icon: users, badge: NEW }
          - { text: Channels, link: /en/build/channels, icon: chat }
      - name: Know the edges
        hint: Verified, untested, absent
        chips:
          - { text: Capability matrix, link: /en/reference/capabilities, icon: table }
          - { text: Not supported, link: /en/reference/not-supported, icon: blocked }
          - { text: Errors, link: /en/reference/errors, icon: alert }
          - { text: TypeScript SDK, link: /en/reference/typescript-sdk, icon: brackets }
  band:
    title: Every claim here is verified — or labelled.
    body: A capability is documented as working only after it has been exercised against a
      live deployment. Anything else carries an explicit note, and what does not exist gets a
      page of its own that says so, with the real alternative.
    columns:
      - title: Capability matrix
        body: Verified, untested and missing — one table, per surface.
        linkText: Read the matrix
        link: /en/reference/capabilities
      - title: Not supported
        body: Custom tools, webhooks, file uploads — named absences, each with what to do instead.
        linkText: Check before designing
        link: /en/reference/not-supported
---

<ZcHome>

```ts
import {
  createZooworkClient, assistantText, isRunFinished,
} from '@zoowork-ai/sdk'
const zc = createZooworkClient() // reads ZOOWORK_API_KEY
const agent = await zc.createAgent({
  resource: { name: 'quickstart-agent' },
})
await zc.startAgent(agent.agent_id)
await zc.waitUntilRunning(agent.agent_id)
const session = await zc.createSession(agent.agent_id, {
  initial_events: [{ type: 'user.message', content: 'What can you do?' }],
})
for await (const ev of zc.streamEvents(agent.agent_id, session.session_id)) {
  process.stdout.write(assistantText(ev))
  if (isRunFinished(ev)) break
}
```

<template v-slot:edges>

**Client-executed custom tools do not exist**: there is no `{type: "custom"}` tool definition
and no `user.custom_tool_result` event, so the agent never calls back into your process.
Session-level outcome definitions, vaults, session `resources[]` mounts, and platform webhooks
are also absent. Read [Not supported](./reference/not-supported.md) before you design around
any of them.

</template>
</ZcHome>
