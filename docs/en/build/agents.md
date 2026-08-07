# Agents

An agent is a persistent configuration object: a name, a model, persona documents, labels,
and a tool policy. You create it once, start it, and then open [sessions](./sessions) against
it. The configuration lives on the server, so every session inherits it without you resending
anything.

Three things about ZooClaw agents surprise people who arrive from other managed-agent APIs.
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
import { createZooclawClient, ZooclawError } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...
```

## Create an agent

`createAgent(input, idempotencyKey?)` takes a `resource` (the configuration) and an
`ownership` anchor, and returns an `AgentRecord`.

```ts
import type { AgentRecord } from '@zooclaw-agents/sdk'

const created: AgentRecord = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary: 'litellm/claude-sonnet-5' },
      labels: { app: 'my-app' },
      onboarding: false,
    },
    ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
  },
  'provision-research-agent-1', // Idempotency-Key
)

console.log(created.agent_id, created.config_version)
```

`ownership` is required by the wire contract, but the gateway overwrites both fields with the
anchors bound to your API key. Send placeholders; read the real values back from
`created.ownership`.

The `Idempotency-Key` is scoped to `agent.create + key`. Replaying the same key with the same
body converges on the first response. Replaying it with a different `resource` or `ownership`
returns `409`.

`onboarding: false` skips the interactive persona-writing bootstrap. Leave it off (the
default) only if you want the agent's first turns spent writing its own persona documents.
For an API-driven product, pass `false`.

### The `resource` fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required, non-empty. |
| `model.primary` | string | Model alias in `provider/model-id` form, e.g. `litellm/claude-sonnet-5`. A bare name is normalized to `litellm/<model-id>`. Get the list from `listModels()`. |
| `model.input` | `string[]` | `text` and/or `image`. Declaring `image` says the primary model reads images itself. |
| `persona.docs[]` | `{ name, content, seed_policy? }[]` | Guidance documents. Only inline `content` is stored. Only the canonical names are read when the prompt is assembled: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`. Other names are saved but never reach the model. `MEMORY.md` and the `memory/` namespace are reserved and return `400 invalid_persona_doc_name`. |
| `labels` | `Record<string, string>` | Your own key-value tags. Queryable on the wire list route. |
| `tool_policy` | object | `{}` means the full tool manifest. A non-empty object is an allow/deny policy, e.g. `{ allow: ['read', 'web_search'] }`. See [Tools](./tools). |
| `sandbox.scope` | `'agent' \| 'session'` | Whether the sandbox is shared across the agent's sessions or created per session. Defaults to `agent`. |
| `mcp` | array | Remote MCP server declarations. See [Tools](./tools). |
| `onboarding` | boolean | `false` skips the persona bootstrap turns. |

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
    onboarding: false,
  },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})
```

::: warning Not yet verified
`name`, `model`, `labels` and `onboarding` are exercised end to end on every run of our
lifecycle harness. `persona.docs`, `tool_policy`, `sandbox.scope` and `mcp` are accepted by
the create route per the API contract, but we have not driven a turn that proves each one
changed the agent's behaviour. Verify the effect you depend on before you build on it.
:::

Fields the SDK types allow but that you should not use through the public gateway:
`skills` at create time (see [Skills](./skills)), and `environment_id` /
`environment_version` (see [Environments](./environments)).

## Read an agent, and the two response shapes

This is the single most common source of `undefined` in ZooClaw code. `POST /agents` answers
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
  ownership: { owner_uid: '...', org_id: '...' },
  declared: {                   // <- the configuration lives here
    name: 'research-agent',
    model: { primary: 'litellm/claude-sonnet-5', input: ['text', 'image'] },
    labels: { app: 'my-app' },
    sandbox: { scope: 'agent' }
  },
  labels: { app: 'my-app' },
  resolved_skills: [ /* ... */ ],
  bootstrap_state: 'skipped',
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

The number also jumps between the two reads. The gateway injects platform credentials right
after creation, and each injection bumps the version: a create receipt saying `1` is commonly
followed by a first `getAgent()` saying `3`. Treat `config_version` as an opaque monotonic
counter, never as a receipt for your own write.

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
one with no Mattermost or Feishu chat channel attached - reports
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
Sessions work perfectly while `actual_state` is `activating` - we drive full turns in that
state on every harness run.

Poll `desired_state`, with a timeout:

```ts
import type { ZooclawClient } from '@zooclaw-agents/sdk'

/**
 * Block until the agent is startable-and-started. Polls `status.desired_state`,
 * which is the only field that gates createSession(). Never poll `actual_state`.
 */
export async function waitUntilRunning(
  zc: ZooclawClient,
  agentId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const intervalMs = opts.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const agent = await zc.getAgent(agentId)
    if (agent.status?.desired_state === 'running') return
    if (Date.now() >= deadline) {
      throw new Error(
        `agent ${agentId} did not reach desired_state=running within ${timeoutMs}ms ` +
          `(desired_state=${agent.status?.desired_state})`,
      )
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
```

Full provisioning path:

```ts
const created = await zc.createAgent({
  resource: { name: 'research-agent', model: { primary: 'litellm/claude-sonnet-5' }, onboarding: false },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})

await zc.startAgent(created.agent_id)      // warnings are informational
await waitUntilRunning(zc, created.agent_id)

const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
```

Skip the start and the next call tells you so:

```ts
try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooclawError && e.type === 'agent_not_running') {
    await zc.startAgent(agentId)
    await waitUntilRunning(zc, agentId)
  } else {
    throw e
  }
}
```

Match on `e.type`, never on `e.message`. See [Errors](../reference/errors).

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

`name`, `model` and `persona` are untouched because they were not in the body. Note that
`labels` itself was replaced, not merged key-by-key: the merge is per section, not recursive.

### `tool_policy` is replaced wholesale

`tool_policy` is the exception to the merge. Every PUT that names it replaces the whole
object. Sending `{}` clears the policy back to the full tool manifest.

```ts
await zc.updateAgent(agentId, { tool_policy: { allow: ['read'] } })
await zc.updateAgent(agentId, { tool_policy: { allow: ['web_search'] } })
// The policy is now { allow: ['web_search'] }. `read` is gone.

await zc.updateAgent(agentId, { tool_policy: {} })
// Policy cleared: the agent gets the full manifest again.
```

To add to a policy, read the current one out of `declared` and send the union yourself.

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

`skills`, `warm`, `credentials`, and any unknown field in the PUT body return `400`. Skills
are managed through their own routes - see [Skills](./skills).

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

Three methods, covered in full on [Skills](./skills).

```ts
const skills = await zc.listAgentSkills(agentId)                 // attached skills, resolved and merged
await zc.putAgentSkill(agentId, 'skl_yourown', { enabled: true }) // attach one your tenant owns
await zc.deleteAgentSkill(agentId, 'skl_yourown')                 // detach it
```

A freshly created agent already has the entire global skill catalog attached - call
`listAgentSkills()` before you try to install anything. `putAgentSkill()` returns `404` for
global-scope skills; it only works for skills your own tenant uploaded.

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

::: danger Not supported
**`listAgents` is not in the SDK.** There is no method to enumerate your agents. Store the
`agent_id` returned by `createAgent()` - it is the only handle you get. The wire route exists
but is asymmetric: it requires an exact `owner_uid` **and** `org_id` match, so an agent
created by another token in the same org can be fetched by id yet never appears in a listing.
:::

## Next

- [Sessions](./sessions) - open a session against a running agent and drive a turn.
- [Events and streaming](./events) - read what the agent does, with resumable SSE.
- [Skills](./skills) - what is attached by default and what you can change.
- [Errors](../reference/errors) - the `ZooclawError.type` values worth branching on.
