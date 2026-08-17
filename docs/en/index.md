---
title: ZooClaw Managed Agents
layout: home
hero:
  # No `name`: the product name is already in the nav and the page title, and repeating it at
  # display size directly above the claim made the two read as one run-on heading.
  text: Agents that run on our infrastructure
  tagline: Create an agent, start it, open a session, and stream durable events back. One API key, one TypeScript SDK.
  actions:
    - theme: brand
      text: Quickstart
      link: /en/get-started/quickstart
    - theme: alt
      text: Capability matrix
      link: /en/reference/capabilities
features:
  - title: Event streams that resume
    details: Every SSE frame carries a durable per-session seq in its id line. Reconnect with the after query parameter and the server replays from that point, so you never re-list history and de-duplicate.
  - title: The whole lifecycle over one key
    details: Create, start, update, run sessions, interrupt, stop, delete. Every step documented here was run against a live deployment with an org API key, not read off a spec.
  - title: Out-of-band system messages
    details: Post a system.message into a running session and the model has it in context on the following turn, without spending a user turn on it.
  - title: One client, both wire shapes
    details: REST answers in snake_case and SSE in camelCase for the same event, and neither carries a top-level type field. The SDK normalizes both into a single SessionEvent.
---

**Developer Preview.** The API may change before general availability. Pages here carry a
badge when a route exists but we have not exercised it; anything without a badge was
verified against a live deployment.

## What you get

**Agent.** A persistent, versioned configuration: name, model, persona, skills, tool policy.
A newly created agent comes back with `status.desired_state === 'stopped'`, so you must call
`startAgent()` before it will accept sessions. Wait on `status.desired_state`, never on
`status.actual_state`, which reports chat-channel connectivity and stays at `activating`
forever for an API-only agent.

**Session.** One conversation, created as a sub-resource of an agent:
`POST /agents/{id}/sessions`, or `createSession(agentId, input)` in the SDK. It holds the
transcript and is the scope of every event you write or read. There is no top-level session
collection - code written against one will not compile here.

**Event.** The unit in both directions. You write `user.message`, `user.interrupt`, and
`system.message`; you read back a durable, sequence-numbered log of what the agent did
(`run.started`, `agent.thinking`, `agent.assistant`, `agent.tool`, `run.finished`). A turn
ends at `run.finished`, whose `payload.status` is `succeeded`, `failed`, or `aborted`. The
stream itself is session-scoped and does not close when a turn ends.

## What this is not

Several things developers reach for on agent platforms do not exist here. The largest is
**client-executed custom tools**: there is no `{type: "custom"}` tool definition and no
`user.custom_tool_result` event, so the pattern "the agent calls my function, my process
queries my database, I hand the result back" has no direct equivalent. Session-level outcome
definitions, vaults, session `resources[]` mounts, and platform webhooks are also absent.
Read [Not supported](/en/reference/not-supported) before you design around any of them.

## Where to start

1. [Quickstart](/en/get-started/quickstart) - key to first streamed reply, including the
   `startAgent()` step that has no counterpart elsewhere.
2. [Events and streaming](/en/build/events) - the event vocabulary, resuming with `after`, and
   why `listEvents` truncates long sessions unless you page.
3. [Capability matrix](/en/reference/capabilities) - what is verified, what is untested, and
   what is missing, in one table.
