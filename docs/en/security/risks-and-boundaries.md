---
description: See where keys, configuration, Session history, files, memory, and data live, who can read or change each one, and how to reduce the main risks.
---

# Risks and boundaries

An Agent's data lives in several places: your backend, the Agent's configuration, Session
history, the workspace, memory, the Agent Database, and published Artifacts. Each place has
its own readers and writers. This page lists them, then describes the main risks for an
application built on Managed Agents and the controls that reduce each one.
[Secure your deployment](./secure-deployment.md) turns these controls into a checklist.

## Where each thing lives

In the table, "your backend" means requests made with a Platform API key in the Agent's
organization and Project. All keys in one Project have the same access to its Agents; keys in
other Projects receive 404.

| Item | Where it lives | Who can read it | Who can change it |
|---|---|---|---|
| Platform API key | Your backend's secret storage. Platform shows the secret once. | Your backend. | In Platform, the organization owner creates keys and organization admins can revoke them. |
| Your service credentials | Your backend. The public API cannot provision credentials to an Agent. | Your backend, inside custom tools. | Your backend. |
| Agent configuration: instructions, model, tools, MCP servers, `tool_policy` | Stored with the Agent. | Your backend. The model reads the instructions on every turn and can repeat them in a reply. | Your backend, with `updateAgent`. The Agent can update its own persona documents during a run; see [Prompt injection](#prompt-injection). |
| Session history and events | Stored per Session. | Your backend. Each Session's conversation is separate from the Agent's other Sessions. | Your inputs and the Agent's work append to it. Deleting a Session hides it from public reads, but transcripts and events are retained for audit. |
| `/workspace` files | The Agent's persistent workspace. | The Agent in every Session, through file tools and `exec`. Your backend, through `exec`. | The Agent in every Session; your backend, through `uploadFile` and `exec`. |
| Agent memory | The Memory service, in `agent` and `user_agent` scopes. | `agent` scope: turns in any Session of the Agent. `user_agent` scope: turns of that actor, or of the owner when a message has no actor. | The Agent, through Memory tools only. `agent` scope: owner turns and authorized system activity. `user_agent` scope: that actor. |
| Agent Database | A managed database that belongs to the Agent. | The Agent, through `agent_db`, in every Session. There is no direct production viewer. | The Agent, through `agent_db`. |
| Published Artifacts | A published copy, separate from the workspace file. | Your backend, and anyone who holds a download URL. | The Agent publishes them; your backend can delete them. |
| Sandbox and its network | A managed, isolated Linux sandbox. The default user is non-root and can run `sudo` without a password. | Commands the Agent runs; your backend, through `exec`. | The default Environment allows unrestricted outbound network access. Platform keys cannot change the Environment or its network policy. |
| Webhook signing secret | Returned when you register an endpoint or rotate its secret. | Your webhook receiver. Ordinary endpoint reads do not return it. | Your backend, by rotating it. |

The sections below link to the guide for each item.

## Prompt injection {#prompt-injection}

Prompt injection is text inside content the Agent reads that tries to give the Agent new
instructions. The model reads tool results as context, so a web page, a search result, an
uploaded document, an MCP result, a custom tool result, or a file written by an earlier
Session can carry such text. If the model follows it, the Agent calls tools on the author's
behalf with whatever access your configuration gives it.

The effect can outlast the turn. A manipulated turn can write workspace files, Agent Database
rows, or memory that later Sessions read; create a schedule with `cron`; or update the Agent's
persona documents, which later turns use as instructions.

`web_fetch` marks fetched page text as untrusted external content and tells the model not to
follow instructions inside it. This lowers the risk but enforces nothing. Reduce what a
manipulated turn can do instead of relying on the model to notice:

- Remove tools the task does not need, and require approval for calls that change data or
  reach the network. See [Tools](../build/tools.md#narrowing-the-tool-set-with-tool-policy) and
  [Permission policies](../build/permissions.md).
- Deny `cron` when the Agent does not need to manage its own schedules, and set
  `persona_doc_update` to `always_ask` so you review every change to the Agent's persona
  documents. See [Permission policies](../build/permissions.md).
- In your custom tools, authorize the operation against your own user mapping, not against
  values in the tool input.
- Keep secrets out of everything the Agent can read.
- Give users who must not share data separate Agents, so content from one user's task cannot
  reach another user's files or memory.
- Review tool calls in the event log. See [Review and monitor sessions](./monitor-sessions.md).

## Data shared between Sessions of one Agent

A Session is a conversation, not a data boundary. All Sessions of one Agent share:

- `/workspace` files, including when `sandbox.scope` is `session`;
- the Agent Database;
- `agent`-scoped memory, and the owner's `user_agent` memory for every message sent without an
  actor;
- the Agent's configuration, persona documents, and schedules.

Each Session keeps its own conversation history, and each actor has its own `user_agent`
memory.

If one Agent serves several end users, a file one user uploaded or a fact the Agent saved
for one user can appear in another user's task. Create [an Agent per user](../build/per-user-agents.md)
when that is not acceptable. `actor.ref` separates `user_agent` memory only; it does not
isolate files or the database, and it does not authorize access. See
[File isolation](../build/files.md#file-isolation), [Agent Database](../build/data-storage.md),
and [Memory scopes](../build/memory.md#choose-a-memory-scope).

## Over-broad tools

An empty `tool_policy` leaves the runtime's default tool surface in place, which includes
sandbox commands and web tools. An MCP server declared without `toolFilter` exposes its whole
catalog, and one declared without `permission` or `tools` runs its calls without approval.
The more an Agent can call, the more a mistaken or manipulated decision can do.

- Use `tool_policy` to remove built-in tools the task does not need.
  See [Tools](../build/tools.md#narrowing-the-tool-set-with-tool-policy).
- Use `toolFilter` to expose only the MCP tools the task needs. See
  [MCP servers](../build/mcp.md#select-mcp-tools).
- Set `always_ask` on tools that change data or reach other systems, and
  `requireConfirmation` on MCP tools where each call needs a fresh decision. See
  [Permission policies](../build/permissions.md).
- If the task does not need shell commands, remove `exec`. Denying the web tools does not stop
  `exec` from reaching the network, and Platform keys cannot change the sandbox network
  policy. See [Cloud sandbox reference](../build/cloud-sandbox-reference.md#sandbox-specifications).

## Credential exposure

A secret can leak from any place that the Agent, the event log, or your own logs can read:

- **In a message or `system.message`:** it is stored in Session history. Deleting the Session
  does not erase the stored records.
- **In instructions:** the model reads them on every turn and can repeat them in a reply.
- **In a workspace file:** every Session of the Agent can read it, and a command run with
  `exec` can send it to any host.
- **In a tool argument or result:** `agent.tool` events record `args` when a call starts and a
  `resultPreview` when it ends.

Keep service credentials in your backend and use them inside custom tools. Return only the
data the task needs from a custom tool, never the credential itself. The Platform API key,
the webhook signing secret, and Artifact download URLs are credentials as well: keep them in
secret storage and out of logs. Revoke or rotate them when they may have been exposed. See
[Authentication](../get-started/authentication.md#replace-or-revoke-a-key),
[Webhooks](../build/webhooks.md#maintain-the-endpoint), and
[Files and artifacts](../build/files.md#access-urls-and-deletion).

## Cost exhaustion

Agent work draws on the organization's prepaid balance, which all its Projects share. The
public API reports usage, but it has no server-enforced per-Session spending cap. Spending
can grow faster than you expect when:

- a task runs many model and tool steps, or keeps going after the user has left;
- a schedule fires at a short interval, including a schedule the Agent created with `cron`;
- an Agent is deleted before its schedules, which keep firing and can no longer be listed or
  deleted through the API;
- injected content asks the Agent to start more work.

Controls:

- Apply your own limits per user and per task, check consumption with
  [Usage](../reference/usage.md), and stop a run with
  [`user.interrupt`](../build/events.md#user-interrupt). Closing the stream does not stop it.
- Deny `cron` when the Agent does not need to schedule its own work, list schedules
  regularly, and pause the ones you do not expect. See
  [Schedules](../build/schedules.md#enable-pause-and-delete).
- To stop all work on an Agent, stop it: this cancels its running work and blocks new
  Sessions. Delete schedules before deleting an Agent. See
  [Stop and delete](../build/agents.md#stop-and-delete).

## Related

- [Secure your deployment](./secure-deployment.md): the controls on this page as a prioritized checklist.
- [Review and monitor sessions](./monitor-sessions.md): find unexpected tool calls and spending.
- [Architecture](../get-started/architecture.md): how persistent state and managed execution fit together.
- [Current API boundaries](../reference/not-supported.md): capabilities the public API does not provide, and what to use instead.
