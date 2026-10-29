---
description: Work through a prioritized checklist for API keys, end-user access, data isolation, tools, approvals, webhooks, and spending before you serve real users.
---

# Secure your deployment

Use this checklist before a Managed Agents integration serves real users. The items are
ordered by impact. The first ones protect your API key and keep users' data apart; the later
ones limit what a wrong or manipulated tool call can do and how much work can run. Each item
says what to do, why it matters, and which guide shows how.
[Risks and boundaries](./risks-and-boundaries.md) explains where each kind of data lives and
who can reach it.

## 1. Keep the API key in your backend

Store the Platform API key in your server's secret configuration and call ZooWork only from
your backend. Do not ship it in browser or mobile code, and do not put it in Agent
instructions, Session messages, uploaded files, or the sandbox.

The key is not limited to one user or one Agent. It can read and change every Agent in its
organization and Project scope, read their Sessions, run commands in their sandboxes with
`exec`, and start work that draws on the organization's prepaid balance. Anything you place
where the Agent can read it can also leave through the Agent: messages are stored in Session
history, `/workspace` files are visible to every Session of the Agent, and the default
sandbox has unrestricted outbound network access.

To replace a key, create a new one, deploy it, and revoke the old one. Revocation stops
authentication; it does not delete the Agents, Sessions, or files created with the key.

See [Authentication and API keys](../get-started/authentication.md#key-scope-and-security).

## 2. Use separate Projects for separate applications and environments

Create a separate Project, with its own key, for each application and for each environment,
such as development and production. Keys in the same Project share access to the same Agents.
A key cannot reach an Agent in another Project; those requests return 404.

Skills follow the same boundary when you upload them: a named Project key writes `project`
Skills visible only in that Project, while a Default Project key writes `org` Skills shared
across the organization. Projects do not separate funds. All Projects in an organization draw
on its prepaid balance.

See [Authentication and API keys](../get-started/authentication.md#key-scope-and-security) and
[Skills](../build/skills.md#api-availability).

## 3. Authorize every request in your backend

ZooWork authenticates your API key, not your end users. Your backend must sign users in,
decide which Agents and Sessions each user may use, and check that before every call it makes
on a user's behalf: creating a Session, posting events, streaming, reading history, and
resolving approvals.

Keep the user-to-Agent and user-to-Session mapping in your database. Do not accept an Agent
or Session ID from the browser without checking it against that mapping. Labels, Session
`metadata`, and `actor.ref` are metadata; they do not authorize access.

See [An agent per user](../build/per-user-agents.md#authorize-each-agent-and-session-request).

## 4. Give users who must not share data separate Agents

A Session separates conversation history only. The Agent's `/workspace` files, its Agent
Database, and its `agent`-scoped memory are shared by all of its Sessions. Setting
`sandbox.scope: 'session'` gives Sessions separate sandbox instances, but they still use the
same workspace.

When users must not see each other's files, database rows, or saved facts, create one Agent
per user. If several users share one Agent, have your backend send a stable
`actor: { ref }` for each authenticated user, so each user gets a separate `user_agent`
memory scope. Without an actor, a message uses the Agent owner's identity: every such user
shares the owner's private memory and can write to the shared `agent` scope.

See [An agent per user](../build/per-user-agents.md) and
[Memory scopes](../build/memory.md#choose-a-memory-scope).

## 5. Check authorization inside custom tools

When the Agent calls an application-executed custom tool, your backend runs the operation.
Treat the tool input as untrusted: the model produced it, and content the model read can
influence it. Validate the input, look up the end user from your own Session mapping rather
than from the tool input, and check that this user may perform this operation before you run
it. A platform approval can stop the request before it reaches you; it does not replace these
checks.

Keep service credentials, such as database passwords and third-party API tokens, in your
backend and use them only inside custom tools. The public API does not provision credentials
to Agents, and the platform calls remote MCP servers without stored credentials. An MCP
server that accepts those unauthenticated requests accepts them from anyone who can reach it,
so do not expose private data or write operations through it. The Agent and Session
identifiers that ZooWork can add to MCP calls are request context, not proof of
authorization.

See [Custom tools](../build/tools.md#application-executed-custom-tools) and
[MCP servers](../build/mcp.md#connection-requirements).

## 6. Narrow the tool set with `tool_policy`

Remove the built-in tools a task does not need, such as `exec` or the web tools, with
`tool_policy`. For an MCP server, use `toolFilter` to expose only the native
tools you need; omitting it exposes the server's whole catalog.

Review these tools first, because they reach the network or change state that later
Sessions use:

| Tool | Why to review it |
|---|---|
| `exec` | Runs commands in the sandbox. The default sandbox has unrestricted outbound network access, and denying the web tools does not restrict `exec`. |
| `web_fetch`, `web_search`, `web_image_search` | Bring web content into the Agent's context through platform services. |
| `cron` | Lets the Agent create, change, and trigger its own schedules, when the deployment provides it. |

Deny `cron` unless your product needs the Agent to manage its own schedules. Every PUT that includes `tool_policy` replaces the whole policy,
so read and merge the current policy before you update it.

See [Tools](../build/tools.md#narrowing-the-tool-set-with-tool-policy) and
[MCP servers](../build/mcp.md#select-mcp-tools).

## 7. Require approval for risky calls

For a tool that should stay available but must not run unattended, set `always_ask` in
`tool_policy.permissions`, or set `permission` / `tools` on the MCP server. Each matching call
then waits for a decision. Add `requireConfirmation: true` to an MCP tool when every call
needs a fresh decision.

The Agent can also update its own persona documents, such as `AGENTS.md`, which later turns
read as instructions. To review each change before it is written, set
`tool_policy.permissions.persona_doc_update` to `always_ask`.

Show pending approvals only to users who may decide on them, and offer only the decisions in
`allowed_decisions`. An `allow-always` decision grants the matching rule for the rest of the
Session; when that rule is a server-wide MCP default, the grant can cover other tools from the
same server. A pending approval is denied after ten minutes.

See [Permission policies](../build/permissions.md).

## 8. Treat outside content as untrusted input

Web pages, search results, uploaded files, MCP results, and custom tool results all enter the
model's context. Text inside them can try to give the Agent new instructions; this is called
prompt injection. Do not rely on the model to ignore it. Limit what a manipulated turn can do
with the other items on this list: fewer tools, approval for risky calls, authorization in your
custom tools, no secrets within the Agent's reach, and separate Agents for users who must not
share data.

See [Prompt injection](./risks-and-boundaries.md#prompt-injection).

## 9. Verify webhook signatures

Verify every webhook delivery against the raw request body before you act on it, with the SDK
helpers or a Standard Webhooks library. Compare the event `id` with the signed `webhook-id`
header, deduplicate by event ID, and keep the `whsec_` signing secret in your server's secret
storage. Treat a webhook as a notification, and confirm state by reading the resource.

See [Webhooks](../build/webhooks.md#verify-before-acknowledging).

## 10. Treat Artifact URLs as credentials

Anyone who holds an Artifact download URL can read the file. Give a URL only to users who may
see the file, keep URLs out of logs, and delete Artifacts you no longer need. Deletion does not
revoke every URL already issued immediately: a presigned URL can remain usable until it
expires or the stored object is removed.

See [Files and artifacts](../build/files.md#access-urls-and-deletion).

## 11. Watch Usage and stop runaway work

The public API has no server-enforced per-Session spending cap, and all Projects draw on the
organization's prepaid balance. Query [Usage](../reference/usage.md) from your backend, apply
your own limits per user or task, and send [`user.interrupt`](../build/events.md#user-interrupt)
to stop a run that exceeds them. A Usage query with a Platform key covers only usage attributed
to that key; organization administrators see organization-wide usage in Platform.

Schedules keep firing while they are enabled, including schedules the Agent creates for
itself. List each Agent's schedules regularly, pause or delete the ones you do not expect, and
delete schedules before you delete the Agent: after deletion, its schedule routes return 404.

See [Review and monitor sessions](./monitor-sessions.md) and
[Schedules](../build/schedules.md#enable-pause-and-delete).

## Related

- [Risks and boundaries](./risks-and-boundaries.md): where data lives, who can reach it, and the main risks.
- [Review and monitor sessions](./monitor-sessions.md): review tool calls and catch problems early.
- [Permission policies](../build/permissions.md): approvals for tool calls.
- [An agent per user](../build/per-user-agents.md): separate workspaces and backend authorization.
