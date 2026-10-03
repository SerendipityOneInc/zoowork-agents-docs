---
description: Understand current channel-management limits and connect a chat application through API Sessions.
---

# Channels

A channel connects a chat platform account to an Agent. Managed channel bindings and guided
setup are currently unavailable with Platform API keys.

Agents do not need a channel to run tasks. Use [API Sessions](./sessions.md) from your
application's backend.

## Current availability

Platform API keys created in [ZooWork Platform](https://platform.zoowork.ai) cannot list,
create, update, or remove managed channel bindings, or run QR setup. These requests return
`404 service_api.not_found`. Channel methods in an SDK do not make those routes available.

See [Authentication](../get-started/authentication.md) for key setup and
[Current API boundaries](../reference/not-supported.md) for other limits.

## Connect your chat application

Your backend can connect a chat platform to an ordinary API Session:

1. Receive messages through the chat platform's own API and authenticate the sender.
2. Look up the sender's Agent and Session in your application. Use
   [an Agent per user](./per-user-agents.md) when users must not share persisted files.
3. [Create a Session](./sessions.md) for a new conversation, or
   [send events](./events.md#user-message) to its existing Session.
4. Read the [event stream](./events.md#streaming-a-turn) and send the Agent's response through
   the chat platform's API.

Keep both the ZooWork API key and chat-platform credentials in your backend. Your application
owns message routing, user access checks, and delivery retries. Creating an API Session does
not configure a managed channel or authenticate a chat-platform account.

## Agent readiness

Before creating an API Session, start the Agent and check that `status.desired_state` is
`running`, as shown in [Quickstart](../get-started/quickstart.md). `status.actual_state` is a
health projection; it is not the readiness check for API Sessions.
