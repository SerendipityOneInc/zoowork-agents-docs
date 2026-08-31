---
description: Create, configure, start, update, and delete agents, including versioned response shapes.
---

# Agents

An agent is a persistent configuration object: a name, a model, persona documents, labels,
and a tool policy. You create it once, start it, and then open [sessions](./sessions.md) against
it. The configuration lives on the server, so every session inherits it without you resending
anything.

Three things about ZooWork agents surprise people who arrive from other managed-agent APIs.
Read these before you write code.

1. A newly created agent is **stopped**. You must call `startAgent()`, or `createSession()`
   fails with `409 agent_not_running`.
2. Wait for `status.desired_state === 'running'`. **Never** wait for `status.actual_state`:
   it reports chat-channel connectivity, and an API-only agent has no channels, so it stays
   at `activating` forever and your poll loop never returns.
3. The same agent comes back in **two different shapes**. `createAgent()` returns a flat
   receipt; `getAgent()` and `updateAgent()` return a projection. The version lives in a
   different place in each.

## Setup

Every snippet on this page assumes this client.

```ts
import { createZooworkClient, ZooworkError } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY }) // zct_...
```

## Create an agent

`createAgent(input, idempotencyKey?)` takes a `resource` (the configuration) and returns an
`AgentRecord`.

```ts
import type { AgentRecord } from '@zoowork-ai/sdk'

const created: AgentRecord = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary: 'litellm/claude-sonnet-5' },
      labels: { app: 'my-app' },
    },
  },
  'provision-research-agent-1', // Idempotency-Key
)

console.log(created.agent_id, created.config_version)
```

The `Idempotency-Key` is scoped to `agent.create + key`: same key and same body converges on
the first response, same key and a different body returns `409`. See
[Errors](../reference/errors.md).

The onboarding interview is always skipped, so the agent answers your first message directly.

### The `resource` fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required, non-empty. |
| `model.primary` | string | Model alias in `provider/model-id` form, e.g. `litellm/claude-sonnet-5`. A bare name is normalized to `litellm/<model-id>`. Get the list from `listModels()`. |
| `model.input` | `string[]` | `text` and/or `image`. Declaring `image` says the primary model reads images itself. |
| `model.max_tokens` | integer | Output-token cap per model request. Omit to use the platform default; invalid values are rejected at create. |
| `persona.docs[]` | `{ name, content, seed_policy? }[]` | Guidance documents. Only inline `content` is stored. Only the canonical names are read when the prompt is assembled: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`. Other names are saved but never reach the model. `MEMORY.md` and the `memory/` namespace are reserved and return `400 invalid_persona_doc_name`. |
| `labels` | `Record<string, string>` | Your own key-value tags. Filterable with `listAgents({ labels })`. |
| `tool_policy` | object | `{}` means the full tool manifest. A non-empty object is an allow/deny policy, e.g. `{ allow: ['read', 'web_search'] }`. See [Tools](./tools.md). |
| `sandbox.scope` | `'agent' \| 'session'` | Whether the sandbox is shared across the agent's sessions or created per session. Defaults to `agent`. |
| `mcp` | array | Remote MCP server declarations. See [Tools](./tools.md). |

```ts
const agent = await zc.createAgent({
  resource: {
    name: 'support-triage',
    model: { primary: 'litellm/claude-sonnet-5', input: ['text', 'image'] },
    persona: {
      docs: [
        { name: 'AGENTS.md', content: 'You triage inbound support tickets. Be terse.' },
        { name: 'SOUL.md', content: 'Dry, precise, never apologetic.' },
      ],
    },
    tool_policy: { allow: ['read', 'web_search'] },
    sandbox: { scope: 'session' },
    labels: { tier: 'free' },
  },
})
```

::: warning Not yet verified
`name`, `model` (including `max_tokens`, which visibly caps a reply), `labels` and `mcp` are
verified end to end. `persona.docs`, `tool_policy` and `sandbox.scope` are accepted by the
create route per the API contract, but no turn has proven each one changed the agent's
behaviour. Verify the effect you depend on before you build on it.
:::

`skills` at create time does work (staging-verified 2026-08-30): the skill is installed, but
neither the create receipt nor `getAgent`'s `declared` echoes the field - confirm the install
with `listAgentSkills(agentId)`, not the receipt. See [Skills](./skills.md). `environment_id` and `environment_version` do work
here; [Environments](./environments.md) has the resolution rules.

## Read an agent, and the two response shapes

This is the single most common source of `undefined` in ZooWork code. `POST /agents` answers
with a flat create receipt. `GET` and `PUT` answer with a projection. They are not the same
object.

```ts
// createAgent() - flat receipt
{
  agent_id: 'agt_...',
  computer_id: 'cmp_...',
  config_version: 1,            // <- top level
  resolved_skills: [ /* ... */ ],
  ownership: { owner_uid: '...', org_id: '...' }
  // no `declared`, no `status`
}
```

```ts
// getAgent() / updateAgent() - projection
{
  agent_id: 'agt_...',
  computer_id: 'cmp_...',
  declared: {                   // <- the configuration lives here
    name: 'research-agent',
    model: { primary: 'litellm/claude-sonnet-5', input: ['text', 'image'] },
    labels: { app: 'my-app' },
    sandbox: { scope: 'agent' }
  },
  labels: { app: 'my-app' },
  resolved_skills: [ /* ... */ ],
  status: {
    desired_state: 'stopped',
    actual_state: 'stopped',
    config_version: 3,          // <- the version lives here
    render_state: 'ready',
    status_message: null,
    channels: { expected: 0, connected: 0, degraded_since: null }
  }
  // no top-level `config_version`, no top-level `name`
}
```

| | create receipt | read projection |
|---|---|---|
| version | `agent.config_version` | `agent.status.config_version` |
| name | not present | `agent.declared.name` |
| lifecycle state | not present | `agent.status.desired_state` |

Write one accessor and use it everywhere:

```ts
const configVersion = (a: AgentRecord): number | undefined =>
  a.status?.config_version ?? a.config_version
```

The number also jumps between the two reads: the first version you read back is commonly
higher than the one on the create receipt, before you have written anything. Treat
`config_version` as an opaque monotonic counter, never as a receipt for your own write.
[Errors](../reference/errors.md) has the full rules.

```ts
const agent = await zc.getAgent(created.agent_id)
console.log(agent.declared?.name, agent.status?.desired_state, configVersion(agent))
```

A non-existent, soft-deleted, or other-tenant agent id returns `404 not_found` - cross-tenant
reads are hidden as 404, not rejected as 403.

## Start the agent

`startAgent()` flips `desired_state` to `running`. This is the precondition for every session
call. It is fast - sub-second in practice.

```ts
const { warnings } = await zc.startAgent(agent.agent_id)
console.log(warnings)
// [ 'channel_routes_reload_failed: routes reload returned 404' ]
```

### The start/stop warning you will always see

Both `startAgent()` and `stopAgent()` return `{ warnings: string[] }`. An API-only agent -
one with no chat channel attached - reports
`channel_routes_reload_failed` on **every** start and **every** stop, because there are no
channel routes to reload. This is expected noise. Do not treat a non-empty `warnings` array as
a failure, and do not retry on it. Log it and move on.

### `desired_state` vs `actual_state`

`AgentStatus` carries two state fields that sound interchangeable and are not.

| Field | What it means | Values |
|---|---|---|
| `desired_state` | The lifecycle intent. **This is what gates the API.** | `running`, `stopped`, `deleted` |
| `actual_state` | Chat-channel route health. Nothing to do with API readiness. | `activating`, `active`, `degraded`, `error`, `stopped`, `deleting` |

An API-only agent has zero channels (`status.channels.expected === 0`), so nothing ever
connects, so `actual_state` sits at `activating` indefinitely and `active` is unreachable.
`running` is not even a member of the `actual_state` enum, so polling for it never returns.
Sessions work perfectly while `actual_state` is `activating` - full turns in that state are
verified. Binding a [channel](./channels.md) is the one thing that makes `actual_state`
move: it then reports that channel's connectivity - and it is still not an API-readiness
signal.

Poll `desired_state`, with a timeout. `waitUntilRunning()` is that loop, already written:

```ts
const agent = await zc.waitUntilRunning(agentId)
console.log(agent.status?.desired_state)  // 'running'
```

It polls `status.desired_state` - never `actual_state` - and hands back the projection it read.
The defaults are a 30s budget and 500ms between polls; both are adjustable, and an
`AbortSignal` cancels the wait.

```ts
const ac = new AbortController()
await zc.waitUntilRunning(agentId, { timeoutMs: 60_000, intervalMs: 1_000, signal: ac.signal })
```

A wait that runs out throws a `ZooworkError` with `status: 408` and `type: 'timeout'`; an
aborted one throws `status: 0` and `type: 'aborted'`. Both are synthesized locally - the
server never sends either, and an abort does not leak a `DOMException` at you.

Both bounds cover an **in-flight** poll, not just the gap between polls: every request carries
its own signal, fired by your `signal` or by whatever is left of the budget. A gateway that
accepts the connection and then never answers therefore ends the wait on schedule instead of
hanging it. That is the part a hand-rolled loop misses - `fetch` has no timeout of its own
anywhere the SDK runs, so a `Date.now() >= deadline` check that only runs between requests
never gets a turn.

Full provisioning path:

```ts
const created = await zc.createAgent({
  resource: { name: 'research-agent', model: { primary: 'litellm/claude-sonnet-5' } },
})

await zc.startAgent(created.agent_id)      // warnings are informational
await zc.waitUntilRunning(created.agent_id)

const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
```

Skip the start and the next call tells you so:

```ts
try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooworkError && e.type === 'agent_not_running') {
    await zc.startAgent(agentId)
    await zc.waitUntilRunning(agentId)
  } else {
    throw e
  }
}
```

Match on `e.type`, never on `e.message`. See [Errors](../reference/errors.md).

## Update an agent

`updateAgent(agentId, sections)` PUTs the declared sections you name. It returns the read
projection.

**Sections you omit are preserved.** Top-level object sections are merged one level deep;
arrays and scalars inside them replace the old value.

```ts
// The agent was created with name, model, persona and labels.
// This PUT sends only `labels`.
const updated = await zc.updateAgent(agent.agent_id, {
  labels: { tier: 'paid', region: 'apac' },
})

console.log(Object.keys(updated.declared ?? {}))
// [ 'name', 'model', 'imageModel', 'imageGenerationModel', 'pdfModel', 'persona', 'labels', 'sandbox', ... ]

console.log(updated.declared?.name)   // 'research-agent'  - survived
console.log(updated.declared?.model)  // { primary: 'litellm/claude-sonnet-5', ... } - survived
console.log(updated.declared?.labels) // { tier: 'paid', region: 'apac' } - replaced wholesale
```

`declared` is wider than what you sent. `imageModel`, `imageGenerationModel` and `pdfModel` are
server-side defaults that appear there on every read; they are not members of `AgentResource`,
and sending them is a type error.

`name`, `model` and `persona` are untouched because they were not in the body. Note that
`labels` itself was replaced, not merged key-by-key: the merge is per section, not recursive.

### `tool_policy` and `system_prompt` are replaced wholesale

Two sections are exceptions to the merge: every PUT that names `tool_policy` or
`system_prompt` replaces the whole object. See [Tools](./tools.md).

So there is no partial write for either. To add to a policy, read the current one out of
`declared` and send the union yourself.

### Every PUT bumps the version

`config_version` increments on every successful PUT, including one whose values are byte-identical
to what is already stored. There is no no-op detection.

```ts
const before = configVersion(await zc.getAgent(agentId))          // 4
await zc.updateAgent(agentId, { labels: { probe: 'x' } })
const first = configVersion(await zc.getAgent(agentId))           // 5
await zc.updateAgent(agentId, { labels: { probe: 'x' } })         // identical body
const second = configVersion(await zc.getAgent(agentId))          // 6 - bumped anyway
```

So a PUT-per-turn pattern churns the version endlessly, and you cannot use "the version did
not change" to detect that your write was a no-op. The next turn reads the new version;
turns already in flight keep the old one.

### What a PUT rejects

`skills`, `credentials`, and any unknown field in the PUT body return `400`. Skills
are managed through their own routes - see [Skills](./skills.md).

## Stop and delete

```ts
const { warnings } = await zc.stopAgent(agentId)
// desired_state -> 'stopped'; the same channel_routes_reload_failed warning appears here too.
```

After a stop, `createSession()` on that agent returns `409 agent_not_running` again, stably.

`deleteAgent()` is a **soft delete**. It marks the agent runtime deleted and returns `204`.
It does not stop the agent, does not cancel running workflows, does not delete schedules, and
does not release the sandbox. Deleting without stopping leaves resources running that you can
no longer address.

```ts
await zc.stopAgent(agentId)   // do this first
await zc.deleteAgent(agentId) // then this
```

Repeated deletes also return `204`. After deletion, `getAgent()` returns `404 not_found`.

## Skills on an agent

Three methods, covered in full on [Skills](./skills.md).

```ts
const skills = await zc.listAgentSkills(agentId)                 // attached skills, resolved and merged
await zc.putAgentSkill(agentId, 'skl_yourown', { enabled: true }) // attach one your tenant owns
await zc.deleteAgentSkill(agentId, 'skl_yourown')                 // detach it
```

A freshly created agent already has the entire global skill catalog attached, so
`putAgentSkill()` on a global-scope skill returns `404` - do not retry it. See
[Skills](./skills.md).

## List your agents

`listAgents({ labels, page })` enumerates the agents owned by the user your key is bound to.

```ts
const mine = await zc.listAgents()
const forWorkspace = await zc.listAgents({ labels: { workspace_id: 'wsp_example' } })
```

The listing is scoped to your key, not to your organization. An agent a colleague created in
the same org is readable by `getAgent()` if you know its id, but it never appears in your
listing - so for anything that spans keys, keep your own record of the ids. Page size is fixed
at 100, so `page` is the only way past the first hundred.

`labels` filters on the labels you declared at create time, one `label.<key>` selector per
entry. `{ labels: { workspace_id: '...' } }` is the one worth remembering: it turns the
workspace id in a ZooWork chat URL - the first path segment - back into the agent behind it.

## Not supported

::: danger Not supported
**No agent version history and no version pinning.** `config_version` counts up, but there is
no route to list past versions, read one, pin traffic to one, or roll back. If you need to
recover an old configuration, store it yourself before you PUT.
:::

::: danger Not supported
**No optimistic concurrency.** There is no `version` precondition on `updateAgent()`, and
concurrent writers never see a `409`. Two processes updating the same agent silently
last-write-wins per section. Serialize your own writes if that matters.
:::

## Next

- [Sessions](./sessions.md) - open a session against a running agent and drive a turn.
- [An agent per user](./per-user-agents.md) - the multi-user shape for when users must not share sandbox files and memory.
- [Events and streaming](./events.md) - read what the agent does, with resumable SSE.
- [Skills](./skills.md) - what is attached by default and what you can change.
- [Errors](../reference/errors.md) - the `ZooworkError.type` values worth branching on.
