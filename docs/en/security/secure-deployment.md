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

## 4. Separate users who must not share data

A `shared` Session, the default, separates conversation history only. The Agent's
`/workspace` files, its Agent Database, and its `agent`-scoped memory are shared by all of its
`shared` Sessions. Setting `sandbox.scope: 'session'` gives Sessions separate sandbox instances,
but they still use the same workspace.

When users must not see each other's files or saved facts, either create their Sessions with
`isolation: "session"`, which gives each Session its own workspace, Memory, and Artifacts, or
create one Agent per user. Isolated Sessions still share the Agent Database, the Agent's
configuration and Schedules, and the Agent owner's credentials, so use an Agent per user when
those must be separate too.

If several users share one Agent through `shared` Sessions, have your backend send a stable
`actor: { ref }` for each authenticated user, so each user gets a separate `user_agent` memory
scope. Without an actor, a message uses the Agent owner's identity: every such user shares the
owner's private memory and can write to the shared `agent` scope.

::: warning Isolation does not cover the owner's credentials
In isolated and shared Sessions alike, the sandbox can still act with the Agent owner's
credentials. See [Owner credentials are not isolated](../build/vault.md#owner-credentials).
:::

See [An agent per user](../build/per-user-agents.md#workspace-isolation) and
[Memory scopes](../build/memory.md#choose-a-memory-scope).

## 5. Check authorization inside custom tools

When the Agent calls an application-executed custom tool, your backend runs the operation.
Treat the tool input as untrusted: the model produced it, and content the model read can
influence it. Validate the input, look up the end user from your own Session mapping rather
than from the tool input, and check that this user may perform this operation before you run
it. A platform approval can stop the request before it reaches you; it does not replace these
checks.

Keep service credentials, such as database passwords and third-party API tokens, in your
backend and use them only inside custom tools. The platform calls a remote MCP server without
credentials unless the server is declared for [Vault (beta)](../build/vault.md). An MCP server
that accepts unauthenticated requests accepts them from anyone who can reach it, so do not
expose private data or write operations through it. The Agent and Session identifiers that
ZooWork can add to MCP calls are request context, not proof of authorization.

When an MCP server needs each user's own account, store that user's credential in a Vault and
attach it only to that user's Sessions. Revoke the Sessions or archive the Vault when the user
leaves.

See [Custom tools](../build/tools.md#application-executed-custom-tools),
[MCP servers](../build/mcp.md#connection-requirements), and
[Vault](../build/vault.md#revoke-access).

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

Use `always_ask` for tools whose calls need your application's authorization or a person's
review, especially changes to external systems or calls that spend money. Set it in
`tool_policy.permissions`, or set `permission` / `tools` on the MCP server. Add
`requireConfirmation: true` to an MCP tool when every call needs a fresh decision.

For background work, choose which tools may run without further review and use
`always_allow` only for that scope. Keep required review in place and provide a decision
handler throughout the run, including repeated `process` calls and `artifact_publish`.
Automatically approving every request adds no review over `always_allow` and leaves the task
dependent on every response arriving in time. Sandbox isolation does not prevent an `exec`
command from reaching external systems or incurring charges.

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
- [An agent per user](../build/per-user-agents.md): isolated Sessions, separate Agents, and backend authorization.
- [Vault (beta)](../build/vault.md): per-user MCP credentials, revocation, and offboarding.
