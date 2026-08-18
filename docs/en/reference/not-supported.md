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

**Instead:** keep the decision in your own process: wait for `run.finished`, do the work, and
post the answer back as a `user.message` on the next turn. That path is slower by one turn.
The only other shape that puts your code behind an agent tool is a **remote HTTP MCP server**
declared on the agent - see [Tools](/en/build/tools).

## Vault-style end-user credential storage

**You would build:** each of your users connects their own Notion, GitHub, or Slack account,
and the agent acts with that user's credentials.

**What happens:** there is no credential resource for you to write. The credential endpoints
on an agent return `404` through the gateway by design; the platform seeds the model
credential itself and exposes nothing else. There is no OAuth broker and no per-session
credential injection.

**Instead:** none for per-end-user credentials - and today not even a shared one: the
`credential` slug on a declared MCP server is accepted but the store it points at answers
404, so a bearer cannot actually be attached. Do the third-party call in your own backend and
pass the result into the session as text.

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

## Outcome definitions on interactive sessions

**You would build:** open a session, hand the agent an acceptance rubric with the first
message, and let it iterate until a grader passes the work.

**What happens:** `initial_events` accepts only `user.message`. There is no outcome event
type on a session and no satisfied or unsatisfied signal in the session event vocabulary. A
run ends at `run.finished` with `succeeded`, `failed`, or `aborted`, which describes whether
the turn ran, not whether the answer was good.

**Instead:** two real paths. For **unattended cron work** the outcome gate exists in full:
put `payload.outcome` on the schedule - or a default at `resource.outcome` - with a `command`
or `rubric` evaluator, and the run iterates against it and withholds publication until
satisfied. See the [capability matrix](/en/reference/capabilities#automation). For
**interactive sessions**, grade in your own process: read the assistant text from
`agent.assistant` events, score it however you like, and post another `user.message` to
iterate. Every step of that loop is verified.

## End-to-end human approval

**You would build:** the agent proposes a dangerous action, your UI shows an approve or deny
card, and the run continues or stops based on the click.

**What happens:** the pieces exist separately - `agent.approval` in the event vocabulary, a
`blocked` phase on `agent.tool`, `user.tool_confirmation` as an accepted write type - but no
real pending approval has ever been produced, so nothing about the round trip is proven, and
an agent waiting on one spends the turn waiting. See the
[capability matrix](/en/reference/capabilities#tools).

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

**What happens:** there is no memory resource, no mount, no versioning, no background
consolidation process, and nothing shared across agents. The model may have memory tools
private to a single agent, but they can be disabled at the deployment level and are invisible
over the API. Declaring `MEMORY.md` or a `memory/` path in `persona.docs` returns
`400 invalid_persona_doc_name`.

**Instead:** keep the state in your own database and inject what matters with a
`system.message` at the start of a turn. The model reads it on the following turn, and you
keep the audit trail and the rollback.

## Platform signed webhooks

**You would build:** the platform posts to your server when a run finishes, and you verify a
signature on the delivery.

**What happens:** there is no webhook resource, no signing secret, and no delivery
configuration. A schedule's `delivery` field accepts `none` and a typed `announce`; webhook
delivery is rejected.

**Instead:** hold the SSE stream, or poll `listEvents` with `after` - every frame carries a
durable `seq` and the server replays from it, so a dropped connection costs you nothing.

## Agent version pinning and rollback

**You would build:** a canary that sends ten percent of traffic to configuration v3, or a
one-call rollback to the previous version.

**What happens:** `config_version` increments on every PUT ([Errors](/en/reference/errors)),
but no route lists versions, fetches an old one, or pins a session to one.

**Instead:** keep your own copy of every configuration you PUT, so rolling back means
re-PUTting the previous body. For a canary, run two agents with different configurations and
split traffic in your own code.

## Self-hosted tool execution

**You would build:** tools that run on your own machines, with the platform dispatching work
to a worker you operate.

**What happens:** there is no worker registration, no work queue, and no environment key.
Tools run in the managed sandbox only. Environments let you pre-install packages and set a
network allowlist, but the execution stays on the platform.

**Instead:** a remote HTTP MCP server is the only shape that moves execution to your side -
verified, but unauthenticated servers only. Everything else your code needs to do belongs in
your own process, around the session rather than inside it.

## Also absent

Smaller gaps, same rule: they do not exist, so do not plan on them.

| Thing | What to know |
|---|---|
| A command-line interface | TypeScript SDK only. |
| Per-session tool or MCP overrides, `agent_with_overrides` on session create | `createSession` takes `initial_events` and `metadata`, nothing else. `PATCH` on a session is `405` through the gateway. There is no override path and no `patchSession`. |
| `session.status_*`, `span.*`, `stop_reason` events | Not in the vocabulary. Use `run.finished` and its `payload.status`. |
| Installing a skill from the global catalog | `404`. Global skills are already attached at agent creation. |
| cargo, gem, or go packages in an environment | apt, npm, and pip only. |
| A credential API; environment secrets, runtime environment variables, sandbox start hooks | The platform injects credentials for its own built-in skills; that lane is not open to you, and an environment config does not accept secrets, variables, or start hooks. Your keys stay in your own service. |
| Schedule pause and unpause, archive, run history across schedules, automatic cleanup when an agent is deleted | Not present - delete and recreate, and read runs one schedule at a time. Schedules survive stop and delete, so remove them yourself first. |
| SDK methods for files | The files routes exist on the wire but their backend is not wired; `ZooclawClient` exposes nothing for them, so you would call them with your own `fetch`. Artifacts joined the client in 0.0.6 (`listArtifacts` / `getArtifact` / `downloadArtifact` / `deleteArtifact`); approvals, schedules, environments, and session archive and delete have been on it since 0.0.5 - see the [capability matrix](/en/reference/capabilities). |
| Key rotation or revocation from your own code | No API. In the ZooClaw App, **Settings → API Keys** rotates or revokes a key immediately, and the new secret is shown exactly once. |
| Scoped, per-user, or read-only API keys | One organization-wide key, with full read and write over every agent in the organization. |
