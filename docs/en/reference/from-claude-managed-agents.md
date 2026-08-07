# Coming from Claude Managed Agents

This page is for developers who already know Claude Managed Agents and want to know which
parts of that mental model survive the move to ZooClaw, and which parts will silently
mislead them.

Throughout, the Claude side is written as **the shape of the call**, not as a literal SDK
signature - check Anthropic's own documentation for exact method names. The ZooClaw side is
real `@zooclaw-agents/sdk` code that compiles.

## The short version

The core loop transfers. An **agent** is still a persistent, server-side configuration
object; a **session** is still one conversation against it; the agent's work still arrives
as an ordered stream of **events**; and you still drive a turn by writing a user message and
reading events until the turn ends. If you have written a streaming turn loop against Claude,
you will recognize the ZooClaw one immediately.

Three things do not transfer, and each one breaks code rather than degrading it. **Tool
callbacks do not exist** - there is no client-executed custom tool, no way for the model to
call a function in your process and get the result back, and no `user.custom_tool_result`
event. **Sessions are not top-level** - every session route and every SDK method is nested
under an agent, so `createSession(agentId, input)` takes the agent id as its first argument
rather than in the body. **Environments are not a step** - there is nothing to create before
you open a session, and there is no environment id to thread through. In exchange you get one
step Claude does not have: a newly created agent is stopped, and you must call `startAgent()`
before any session call will work.

## Concept mapping

| Claude concept | ZooClaw equivalent | The difference that will bite |
|---|---|---|
| **Agent** | `createAgent()` / `getAgent()` / `updateAgent()` | A new agent is **stopped**; you must `startAgent()` it. `createAgent()` and `getAgent()` return **two different shapes** - the version is top-level on create, at `status.config_version` on read. `updateAgent()` merges per section (`tool_policy` is the exception, replaced wholesale), every PUT bumps the version including a byte-identical one, and there is no optimistic-concurrency precondition. No version history, no pinning, no rollback. See [Agents](/en/build/agents). |
| **Environment** | Nothing in the session path | There is no environment to create, no environment id in `createSession`, and no SDK method to make one. Sandbox behaviour is one field on the agent: `sandbox.scope: 'agent' \| 'session'`. `AgentResource` types `environment_id` / `environment_version`, but do not use them through the public gateway. See [Environments](/en/build/environments). |
| **Session** | `createSession(agentId, input)` | Nested under the agent: `POST /agents/{agent_id}/sessions`. `initial_events` accepts **only** `user.message` (max 50, string content) - no outcome definitions. There is no `agent_with_overrides`, no `resources[]`, no `vault_ids`. There is an `Idempotency-Key` (third argument), which Claude does not have. Precondition: `status.desired_state === 'running'`, else `409 agent_not_running`. See [Sessions](/en/build/sessions). |
| **Event** | `SessionEvent` = `{ seq, eventType, payload, runId?, turn?, createdAt? }` | A different vocabulary: 19 types under `run.*` / `chat.*` / `agent.*` plus `attachment.created` and `message.outbound`. **Neither wire shape has a top-level `type`** - REST returns snake_case (`event_type`, `run_id`, `created_at`), SSE returns camelCase (`eventType`, `runId`, `createdAt`). The SDK's `normalizeEvent` absorbs both; anyone calling the HTTP API directly has to handle both. See [Events and streaming](/en/build/events). |
| **`stop_reason` / `requires_action`** | `run.finished` with `payload.status` | Neither field exists. There are no `session.status_*` events and no idle state to poll. A turn ends at `run.finished`, whose status is `succeeded \| failed \| aborted`. Nothing ever comes back asking you to supply a tool result, because client-executed tools do not exist - so the whole `status_idle` + `requires_action` + resubmit loop has no counterpart here. |
| **`event_delta`** | `?deltas=agent.message` on the SSE route | **Snapshot-replace, not prefix-append.** Each frame carries the current full text, so Claude-style concatenation duplicates everything. The SDK's `streamEvents()` skips `event_delta` frames entirely; concatenate `assistantText(ev)` over the durable `agent.assistant` events instead. |
| **Custom (client-executed) tools** | None | No `{ type: "custom" }` tool, no `user.custom_tool_result`. This is the single biggest gap. See [below](#things-that-require-a-redesign). |
| **Outcomes (`define_outcome`, rubrics, graders)** | None | No rubric, no grader, no "iterate until satisfied" loop. `initial_events` rejects anything that is not `user.message`. |
| **Vaults** | None | No per-user credential custody, no egress-time substitution, no OAuth refresh. `putCredential` / `listCredentials` exist on the client interface but return `404` through the public gateway by design - the gateway provisions platform credentials itself. There is no supported place to hold your end users' third-party tokens. |
| **Memory stores** | None on the API | No `memory_stores` resource, no CRUD, no mount path, no versioning or redaction. The agent has its own internal memory; it is not addressable, listable, or shareable from the API, and a deployment can have it turned off entirely. `MEMORY.md` and the `memory/` namespace are reserved persona-doc names and return `400 invalid_persona_doc_name`. |
| **Files API + session `resources[]`** | Neither is in the SDK | There is no upload-then-mount model: no `resources[]` on `createSession`, no `mount_path`, no output directory to read back. A file route exists on the wire as an agent sub-resource, but `ZooclawClient` exposes no file methods, so for SDK users it is absent. |
| **Deployments (scheduled runs)** | Agent-scoped schedules, not in the SDK | Scheduling lives under the agent rather than as its own resource, and `ZooclawClient` has no method for it. There is no cross-deployment run history and no signed webhook delivery, so "notify my server when a run ends" has to be your own polling or an open SSE stream. |
| **Skills** | `listAgentSkills()` / `putAgentSkill()` / `deleteAgentSkill()` | Skills are attached at the **agent** level. A freshly created agent already has the entire global catalog attached - call `listAgentSkills()` before you try to install anything. `putAgentSkill()` returns `404` for global-scope skills; it is only meaningful for skills your own tenant uploaded. See [Skills](/en/build/skills). |

## Code shape differences

Every snippet below assumes this client:

```ts
import {
  createZooclawClient,
  assistantText,
  isRunFinished,
  runOutcome,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...
```

### 1. Sessions are nested under the agent

In Claude Managed Agents a session is a top-level resource and the agent is named in the
request body, so the session id alone is enough to address a session afterwards.

```
Claude:   POST /v1/sessions            { agent_id, ... }
          then every follow-up call is addressed by session id alone

ZooClaw:  POST /v1/agents/{agent_id}/sessions   { initial_events?, metadata? }
          every follow-up call needs the agent id too
```

The SDK deliberately surfaces that nesting rather than hiding it, so `agentId` is the first
argument of every session method:

```ts
createSession(agentId, input, idempotencyKey?)
getSession(agentId, sessionId, opts?)
postEvents(agentId, sessionId, events)
listEvents(agentId, sessionId, opts?)
streamEvents(agentId, sessionId, opts?)
```

```ts
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
  metadata: { source: 'my-app' },
})

await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'And again.' },
])
```

The practical consequence: **store the agent id next to every session id you persist.** Code
ported from Claude that keeps only the session id will not compile, and a schema ported from
Claude that stores only the session id will not be enough to resume the conversation.

### 2. There is an explicit `startAgent` step

Claude has no counterpart to this. A ZooClaw agent comes back from create with
`status.desired_state === 'stopped'`, and every session call on a stopped agent fails.

```ts
// Ported straight from Claude: create, then use.
const created = await zc.createAgent({
  resource: { name: 'my-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})

await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'hi' }],
})
// ZooclawError: HTTP 409  (type: agent_not_running)
```

```ts
// Correct: create -> start -> wait on desired_state -> session.
const created = await zc.createAgent({
  resource: { name: 'my-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})

const { warnings } = await zc.startAgent(created.agent_id)
// warnings: ["channel_routes_reload_failed: routes reload returned 404"] - expected noise
await waitUntilRunning(created.agent_id)

const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'hi' }],
})
```

```ts
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitUntilRunning(agentId: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const agent = await zc.getAgent(agentId)
    if (agent.status?.desired_state === 'running') return
    await sleep(500)
  }
  throw new Error(`agent ${agentId} did not reach desired_state=running`)
}
```

::: danger Poll `desired_state`, never `actual_state`
`actual_state` reports chat-channel connectivity, not API readiness. An API-only agent has
zero channels, so it stays at `activating` forever and `active` is unreachable - and
`running` is not even a member of the `actual_state` enum
(`activating | active | degraded | error | stopped | deleting`), so polling for it never
returns. `desired_state` flips to `running` in well under a second. Sessions work perfectly
while `actual_state` is still `activating`.
:::

`startAgent()` and `stopAgent()` both return `{ warnings: string[] }`, and an API-only agent
reports `channel_routes_reload_failed` on every call because it has no chat-channel routes to
reload. A non-empty `warnings` array is not a failure - do not retry on it.

### 3. There is no environment creation step

Claude's quickstart puts an environment between the agent and the session: you create one,
it defines the sandbox image and the network policy, and its id is threaded into the session.

```
Claude:   create agent -> create environment -> create session -> stream
ZooClaw:  create agent -> START agent        -> create session -> stream
```

There is nothing to delete from your port - the step simply has no ZooClaw call, and
`createSession` takes no environment argument:

```ts
// The whole provisioning path. No environment anywhere.
const created = await zc.createAgent({
  resource: {
    name: 'porting-demo',
    model: { primary: 'litellm/claude-sonnet-5' },
    sandbox: { scope: 'session' },   // the only sandbox knob on this path
    onboarding: false,
  },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})
await zc.startAgent(created.agent_id)
await waitUntilRunning(created.agent_id)
const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
```

`sandbox.scope` decides whether the agent's sessions share one sandbox (`'agent'`, the
default) or get one each (`'session'`). That is the entire equivalent of the environment
concept on the session path. If you were relying on an environment to preinstall packages or
to restrict outbound hosts, read [Environments](/en/build/environments) before you assume the
capability is there.

### 4. End of turn is `run.finished`, not idle plus `stop_reason`

The Claude programming model is: read events until the session reports it has gone idle, then
branch on the turn's `stop_reason` - `requires_action` means supply a tool result and
resubmit, anything else means the turn is over.

None of those exist here. There is no session status event, no `stop_reason`, and nothing
ever asks you for a tool result. One event ends the turn:

```ts
let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  text += assistantText(ev)          // '' for every event that is not agent.assistant

  if (isRunFinished(ev)) {           // ev.eventType === 'run.finished'
    outcome = runOutcome(ev)         // 'succeeded' | 'failed' | 'aborted'
    break                            // <- you must break; the stream stays open
  }
}
```

Two traps in that loop, both of which cost people real time:

- **`run.finished` ends the turn, not the stream.** The SSE stream is session-scoped and does
  not close when a run completes; the server closes it after an idle period. A loop that
  waits for the connection to end blocks until that timeout. Break out yourself.
- **`succeeded` does not mean no tool errored.** An `agent.tool` event with
  `payload.isError === true` is still followed by `run.finished` with `succeeded`. Do not
  infer turn success from the absence of tool errors, and do not infer tool success from the
  run outcome.

`agent.tool` also has a third phase Claude's tool events do not: `blocked`, meaning the call
is waiting on an approval and has not run. Treat it as pending, not as an end - a matching
`end` still follows once it resolves.

### 5. Deltas are snapshot-replace, not prefix-append

Claude's `event_delta` frames carry the newly added text, so the idiomatic handler appends.
ZooClaw's delta frames carry the **current full text of the item**. The same handler
therefore produces "HeHelHellHello".

Sketched against a hypothetical iterator over the delta frames, the difference is the
assignment operator:

```ts
// PORTED FROM CLAUDE - WRONG HERE. Produces duplicated, growing text.
let text = ''
for await (const frame of deltaFrames) {
  text += textOf(frame)         // append: correct for Claude, wrong for ZooClaw
}
```

```ts
// Correct for a snapshot lane: replace, never concatenate.
let preview = ''
for await (const frame of deltaFrames) {
  preview = textOf(frame)       // each frame IS the whole text so far
}
```

::: warning Not yet verified
The delta preview lane is opt-in on the raw HTTP route
(`GET /agents/{id}/sessions/{id}/events/stream?deltas=agent.message`), emits SSE frames whose
`event:` field is `event_delta`, and is documented as snapshot-replace. It requires Redis to
be configured on the deployment and answers `501 not_configured` when it is not. We have not
exercised it against a live deployment, so do not build a UI that depends on it.
:::

The verified path is the durable one, and the SDK steers you onto it: `streamEvents()` skips
`event_delta` frames entirely and yields only durable events, so concatenating
`assistantText(ev)` across the turn is safe and gives you the complete reply.

```ts
let text = ''
for await (const ev of zc.streamEvents(agentId, sessionId)) {
  text += assistantText(ev)
  if (isRunFinished(ev)) break
}
```

That concatenation is asserted byte-for-byte against a REST replay of the same session on
every run of our live smoke test, so the two paths agree.

### 6. Reconnect is better here: server-side resume

This is the one place where a port gets simpler. Claude gives you no resume: when a stream
drops you re-list the session's history and de-duplicate by event id against what you already
processed.

```ts
// The Claude shape: re-list everything, then throw away what you have seen.
const seen = new Set<string>()
// ... on every reconnect: list the session's events, skip ids already in `seen`,
//     and hope the page you got covers the gap.
```

Every ZooClaw SSE frame carries a durable per-session `seq` in its `id:` line, and the stream
route accepts `?after=<seq>`, which replays from that point **server-side**. Remember one
number and hand it back:

```ts
let lastSeq = 0

for (;;) {
  try {
    for await (const ev of zc.streamEvents(agentId, sessionId, { after: lastSeq })) {
      lastSeq = ev.seq            // the only state you have to keep
      text += assistantText(ev)
      if (isRunFinished(ev)) return runOutcome(ev)
    }
    // The generator returned: the server closed an idle stream. Reconnect from lastSeq.
  } catch (e) {
    // Transport failure. Same recovery - nothing was lost.
  }
}
```

No de-duplication set, no history re-read, no gap to reason about. The same `seq` cursor also
pages `listEvents(agentId, sessionId, { after })`, so a REST reader and a stream reader share
one bookmark.

::: warning Not yet verified
`streamEvents()` does **not** reconnect for you - the loop above is yours to write. We have
driven short streams end to end through the public gateway; we have not measured how a long
stream behaves across gateway idle timeouts. Write the reconnect loop even if your first test
never needs it.
:::

## Things that require a redesign

These have no ZooClaw equivalent and no workaround we have seen work. If your product idea
depends on one, change the idea rather than looking for a way around it. Full detail and the
reasoning is on [Not supported](/en/reference/not-supported).

- **Client-executed custom tools.** "The agent calls my function, my process queries my
  database, I hand the result back" is not expressible. There is no custom tool type and no
  result event. The only adjacent surface is declaring a remote HTTP MCP server on the agent;
  we have not driven that end to end, so do not plan around it either.
- **Outcomes and graders.** No `define_outcome`, no rubric, no iterate-until-satisfied loop.
  Anything shaped like an automatic evaluation harness has to run in your own code, judging
  the text you get back.
- **Vaults / end-user credential custody.** There is nowhere to store your users' third-party
  tokens, and the credential routes are `404` through the public gateway. A per-end-user
  "connect your Notion" flow cannot be built on this API.
- **Session `resources[]`: file and repository mounts.** No uploading a CSV for the agent to
  read, no mounting a Git repository for it to edit. There is no mount path and no repository
  resource.
- **Memory stores.** No shared knowledge base across agents, no versioning, no audit or
  rollback of what an agent remembers.
- **End-to-end human-in-the-loop approvals.** Approval-related events exist, but the round
  trip is not usable from the SDK. An agent blocked on an approval simply times out the turn.
- **Signed webhooks.** Nothing pushes to your server when a run ends. Poll, or hold the SSE
  stream open.
- **Listing sessions, and listing agents.** `ZooclawClient` has no `listSessions`,
  `listAgents`, `archiveSession`, `deleteSession`, or `patchSession`. Persist every
  `agent_id` and `session_id` you create, and put anything you will need to search on into
  `metadata` at create time - you cannot add it later.
- **Agent version history and pinning.** `config_version` counts up, but there is no route to
  read a past version, pin to one, or roll back. Keep your own copy of a configuration before
  you overwrite it.

## Things we have that Claude does not

- **Resumable event streams.** Every frame carries a durable `seq`, and `?after=<seq>` replays
  server-side, so a dropped connection costs you one integer of state instead of a history
  re-read and a de-duplication set.
- **Out-of-band `system.message` injection.** `postEvents` accepts
  `{ type: 'system.message', text: '...' }` between turns; the model has the note in context
  on the following turn. Verified by planting a fact and asking for it back on the next turn.
