# Not supported

Things that do not exist here. Each entry says what you would try to build, what actually
happens when you try, and the nearest real alternative, or that there is none.

::: danger Not supported
Nothing on this page is a matter of finding the right parameter. These capabilities are
absent from the API. If your product depends on one, change the design now rather than
after the first integration test.
:::

Ordered by how likely you are to build a whole product on top of it. Read the first three
even if you skim the rest. For what does exist, see the
[capability matrix](/en/reference/capabilities).

## Client-executed custom tools

**You would build:** the agent calls a tool you defined, your process queries your database
or your API, and you hand the result back so the agent continues the same turn.

**What happens:** there is no custom tool type to declare on an agent, and no
`user.custom_tool_result` event to answer with. The write side accepts exactly four event
types: `user.message`, `user.interrupt`, `user.tool_confirmation`, `system.message`.

**Instead:** two options. Wrap your service as a **remote HTTP MCP server** and declare it on
the agent - the only shape that puts your code behind an agent tool, and one we have not
driven end to end. Or keep the decision in your own process: wait for `run.finished`, do the
work, and post the answer back as a `user.message` on the next turn. The second path is
slower by one turn and fully verified.

## Vault-style end-user credential storage

**You would build:** each of your users connects their own Notion, GitHub, or Slack account,
and the agent acts with that user's credentials.

**What happens:** there is no credential resource for you to write. The credential endpoints
on an agent return `404` through the gateway by design; the platform seeds the model
credential itself and exposes nothing else. There is no OAuth broker and no per-session
credential injection.

**Instead:** none for per-end-user credentials. The only secret an agent can carry is the
static bearer on a declared remote MCP server, which is one shared credential for all of your
users. If per-user identity matters, do the third-party call in your own backend and pass the
result into the session as text.

## Session file attachment and repository mounting

**You would build:** the user uploads a CSV and the agent charts it; or you mount a
repository and the agent edits code and opens a pull request.

**What happens:** `createSession` accepts `initial_events` and `metadata`, nothing else.
There is no `resources[]` array, no `mount_path`, and no repository resource of any kind.

**Instead:** partial. The agent-level Files API can write into the agent's workspace, but it
is one workspace per agent rather than per session, and its backend is not wired for durable
storage, so do not treat it as the store of record. For small inputs, put the content
directly in the `user.message`. For repositories, nobody has verified an agent cloning one
with a token over bash, so do not plan on it.

## Outcome definitions and rubric grading

**You would build:** give the agent an acceptance rubric and let it iterate until a grader
says the work is satisfied; or a scored evaluation harness over many runs.

**What happens:** `initial_events` accepts only `user.message`. There is no outcome object,
no grader resource, and no satisfied or unsatisfied signal anywhere in the event vocabulary.
A run ends at `run.finished` with `succeeded`, `failed`, or `aborted`, which describes
whether the turn ran, not whether the answer was good.

**Instead:** grade in your own process. Read the assistant text from `agent.assistant` events,
score it however you like, and post another `user.message` to iterate. Every step of that
loop is verified.

## End-to-end human approval

**You would build:** the agent proposes a dangerous action, your UI shows an approve or deny
card, and the run continues or stops based on the click.

**What happens:** the pieces exist separately and the loop has never been seen to close.
`agent.approval` is in the event vocabulary, `agent.tool` has a `blocked` phase, and
`user.tool_confirmation` is an accepted write type, but we have never produced a real pending
approval, so nothing about the round trip is proven. An agent waiting on an approval spends
the turn waiting. `listApprovals` and `resolveApproval` are on the client, but they call the
platform's separate approvals REST resource rather than that event loop, and without a
Temporal signaler the route answers `501 not_configured` - the methods being there changes
nothing about what has been proven.

**Instead:** gate on your side. Keep the dangerous capability out of the agent's tool policy,
have the agent describe what it wants to do in text, make the decision in your own UI, then
send the outcome back as a `user.message`.

## Top-level session listing across agents

**You would build:** an inbox listing every conversation across all of your agents, sorted by
recency.

**What happens:** there is no top-level session collection to call. `listSessions(agentId)`
reads one agent's sessions - newest first by `updated_at`, 50 per page, 1-based `page`, no
cursor - and we have not driven it. It still leaves you fanning out across agents and merging
by hand.

**Instead:** record the `session_id` your own code creates, along with the `agent_id` and
whatever user it belongs to. Your database is the index. This is worth doing on day one,
because there is no way to reconstruct it later.

## A memory store resource

**You would build:** a knowledge base several agents share, or memory you can version, audit,
and roll back.

**What happens:** there is no memory resource, no mount, no versioning, and nothing shared
across agents. The model may have memory tools private to a single agent, but they can be
disabled at the deployment level and are invisible over the API. Declaring `MEMORY.md` or a
`memory/` path in `persona.docs` returns `400 invalid_persona_doc_name`.

**Instead:** keep the state in your own database and inject what matters with a
`system.message` at the start of a turn. The model reads it on the following turn, and you
keep the audit trail and the rollback.

## Platform signed webhooks

**You would build:** the platform posts to your server when a run finishes, and you verify a
signature on the delivery.

**What happens:** there is no webhook resource, no signing secret, and no delivery
configuration. A schedule's `delivery` field accepts `none` and a typed `announce`; webhook
delivery is rejected.

**Instead:** hold the SSE stream, or poll `listEvents` with `after`. Because every frame
carries a durable `seq` and the server replays from it, a dropped connection costs you
nothing and needs no de-duplication - which is a better story than most webhook retries.

## Agent version pinning and rollback

**You would build:** a canary that sends ten percent of traffic to configuration v3, or a
one-call rollback to the previous version.

**What happens:** `config_version` is visible and increments on every PUT, but no route lists
versions, fetches an old one, or pins a session to one. The number tells you something
changed and nothing more.

**Instead:** keep your own copy of every configuration you PUT, so rolling back means
re-PUTting the previous body. For a canary, run two agents with different configurations and
split traffic in your own code.

## Self-hosted tool execution

**You would build:** tools that run on your own machines, with the platform dispatching work
to a worker you operate.

**What happens:** there is no worker registration, no work queue, and no environment key.
Tools run in the managed sandbox only. Environments let you pre-install packages and set a
network allowlist, but the execution stays on the platform.

**Instead:** a remote HTTP MCP server is the only shape that moves execution to your side,
and it is unverified. Everything else your code needs to do belongs in your own process,
around the session rather than inside it.

## Also absent

Smaller gaps, same rule: they do not exist, so do not plan on them.

| Thing | What to know |
|---|---|
| A command-line interface | TypeScript SDK only. |
| `agent_with_overrides` on session create | `createSession` takes `initial_events` and `metadata`. |
| Per-session tool or MCP overrides | `PATCH` on a session is `405` through the gateway - the catch-all registers GET, POST, PUT, and DELETE only, so PATCH is not proxied at all. There is no override path and no `patchSession`. |
| `session.status_*`, `span.*`, `stop_reason` events | Not in the vocabulary. Use `run.finished` and its `payload.status`. |
| `putCredential()` / `listCredentials()` | On the SDK interface, `404` through the gateway. |
| Installing a skill from the global catalog | `404`. Global skills are already attached at agent creation. |
| cargo, gem, or go packages in an environment | apt, npm, and pip only. |
| Environment secrets, runtime environment variables, sandbox start hooks | Not accepted in an environment config. |
| Schedule pause and unpause, archive, run history across schedules | Not present. Delete and recreate, and read runs one schedule at a time. |
| Automatic schedule cleanup when an agent is deleted | Schedules survive stop and delete. Remove them yourself first. |
| Memory consolidation as a background process | No equivalent. |
| SDK methods for artifacts or files | Routes exist on the wire for files; `ZooclawClient` exposes nothing for either, so you would call them with your own `fetch`. Approvals, schedules, environments, and session archive and delete are all on the client as of 0.0.5 - see the [capability matrix](/en/reference/capabilities). |
| Key rotation or revocation from your own code | No documented procedure. Treat a leaked key as needing help from whoever issued it. |
| Scoped, per-user, or read-only API keys | One organization-wide key, with full read and write over every agent in the organization. |
