# TypeScript SDK reference

Every symbol `@zooclaw-agents/sdk` exports, with the signature the compiler sees.

This page is the reference. For task-shaped guidance start at [Agents](/en/build/agents),
[Sessions](/en/build/sessions), or the [Quickstart](/en/get-started/quickstart).

## Install

```bash
pnpm add @zooclaw-agents/sdk
```

```bash
npm install @zooclaw-agents/sdk
```

The package is `@zooclaw-agents/sdk`. It ships **ESM only** and is compiled to ES2022, so set
`"type": "module"` in your `package.json`.

### Runtimes

The SDK has **zero runtime dependencies**. It uses the platform `fetch`, Web Streams, and
`TextDecoder` and nothing else, so it runs anywhere those exist:

| Runtime | Notes |
|---|---|
| Node 20 or later | The main target. `fetch` and `ReadableStream` are built in. |
| Cloudflare Workers, Deno, Bun, other edge runtimes | Supported by construction. The SSE parser is written against Web Streams, not Node streams. |
| Browsers | Technically works, but your API key authenticates your whole organization. Do not ship it to a client. See [Authentication](/en/get-started/authentication). |

The only options are `apiKey`, `baseUrl`, `auth`, and an injectable `fetch`.

### Injecting `fetch`

`ZooclawConfig.fetch` replaces `globalThis.fetch` for every request the client makes,
including the SSE stream. Use it to bind a runtime-specific fetch, to add tracing, or to
serve canned responses in tests.

```ts
const zc = createZooclawClient({
  apiKey: process.env.ZOOCLAW_API_KEY,
  fetch: async (input, init) => {
    const started = Date.now()
    const res = await fetch(input, init)
    console.log(`${init?.method ?? 'GET'} ${input} -> ${res.status} in ${Date.now() - started}ms`)
    return res
  },
})
```

The signature is `(input: string, init?: RequestInit) => Promise<Response>`. The first
argument is always a fully resolved URL string, never a `Request` object. A fetch you supply
for streaming must return a `Response` with a readable `body`.

## `createZooclawClient(config)`

```ts
function createZooclawClient(cfg: ZooclawConfig): ZooclawClient
```

Returns a `ZooclawClient`. It is a plain object of closures: no connections are opened, no
requests are made, and a missing API key throws at construction; everything else is validated on first use. Constructing a client
with a bad key succeeds; the first call fails with `401`.

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })
```

Clients are cheap and stateless. Create one per process and share it.

### `ZooclawConfig`

```ts
interface ZooclawConfig {
  baseUrl: string
  auth: ZooclawAuth
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `baseUrl` | `string` | no | The API base **including the version prefix**. Resolution order: this option, then `ZOOCLAW_BASE_URL`, then the exported `DEFAULT_BASE_URL` (the public gateway). Set it only to target a different deployment. Trailing slashes are stripped; paths such as `/models` and `/agents/{id}/sessions` are appended directly. |
| `auth` | `ZooclawAuth` | no | `{ apiKey }`. See below. |
| `fetch` | function | no | Defaults to `globalThis.fetch`. |

### `ZooclawAuth`

```ts
type ZooclawAuth = { serviceToken: string } | { apiKey: string }
```

**Use `{ apiKey }`.** It is your `zct_...` organization service token, sent as
`Authorization: Bearer zct_...` on every request including the SSE stream.

```ts
auth: { apiKey: process.env.ZOOCLAW_API_KEY! }
```

The `{ serviceToken }` variant exists for an internal deployment that reaches the API without
the gateway; it produces the identical bearer header and changes nothing else about the SDK's
behaviour, and it is not usable with an API key.

## Methods

`ZooclawClient` exposes 50 methods, grouped below the way the client groups them. Everything
the wire nests under an agent - sessions, events, approvals, schedules, `wake`, `exec` - takes
`agentId` first. The skill registry and Environments are top-level resources and take none.

**Models**

| Method | Returns | What it does |
|---|---|---|
| `listModels()` | `Promise<ModelInfo[]>` | Lists the model aliases your organization can select. The cheapest check that a key works. |

**Agents**

| Method | Returns | What it does |
|---|---|---|
| `createAgent(input, idempotencyKey?)` | `Promise<AgentRecord>` | Creates an agent. Returns the **flat create receipt**, not the read projection. The agent comes back stopped. |
| `listAgents(opts?)` | `Promise<AgentRecord[]>` | Lists the agents owned by your key's bound user. `opts.labels` filters on declared labels, `opts.page` is 1-based, page size is fixed at 100. The scope is `owner_uid` **and** `org_id`, so an agent a colleague created in your org is fetchable by id and absent from this list. |
| `getAgent(agentId)` | `Promise<AgentRecord>` | Reads an agent. Returns the **projection**: config under `declared`, version at `status.config_version`. |
| `updateAgent(agentId, sections)` | `Promise<AgentRecord>` | PUTs the named declared sections, merging per section. Bumps `config_version` on every call. |
| `deleteAgent(agentId)` | `Promise<void>` | Soft-deletes the agent. Does not stop it. |
| `putCredential(agentId, app, body)` | `Promise<void>` | Writes an agent credential. **`@deprecated`: returns 404 through the public gateway.** |
| `listCredentials(agentId)` | `Promise<{ app: string; ref: string }[]>` | Lists agent credential slots. **`@deprecated`: returns 404 through the public gateway.** |
| `startAgent(agentId)` | `Promise<{ warnings: string[] }>` | Flips `desired_state` to `running`. Required before any session call. |
| `stopAgent(agentId)` | `Promise<{ warnings: string[] }>` | Flips `desired_state` to `stopped`. |
| `waitUntilRunning(agentId, opts?)` | `Promise<AgentRecord>` | Polls `status.desired_state` until it reads `running`, then hands back that projection. Defaults: 30s budget, 500ms between polls. Throws `408`/`timeout`. |
| `listAgentSkills(agentId, opts?)` | `Promise<AgentSkill[]>` | Lists the skills resolved onto the agent. |
| `putAgentSkill(agentId, skillId, opts?)` | `Promise<{ config_version?: number; warnings?: string[] }>` | Attaches a skill your own tenant owns. Global-catalog ids return 404. |
| `deleteAgentSkill(agentId, skillId)` | `Promise<void>` | Detaches a skill. |

**Skill registry**

| Method | Returns | What it does |
|---|---|---|
| `uploadSkill(zip, opts)` | `Promise<SkillRecord>` | Uploads a skill package as a zip; one call creates the skill row **and** version 1. `opts.scope` is `org` or `personal` - `global` and `pack` are 403. The zip's single top-level directory name must equal the `name` in `SKILL.md`'s frontmatter. |
| `uploadSkillVersion(skillId, zip, opts?)` | `Promise<SkillRecord>` | Publishes a new version of an existing skill from a zip. Agents that installed it unpinned follow the new version on their own. |
| `listSkills(opts?)` | `Promise<SkillRecord[]>` | The registry catalog visible to your key: global skills plus your org and personal ones. `q` matches on name, `page` is 1-based, page size fixed at 100. |
| `deleteSkill(skillId)` | `Promise<void>` | Deletes a registry skill (204). No in-use guard for org and personal scopes: agents holding it simply lose it. |

**Sessions and events**

| Method | Returns | What it does |
|---|---|---|
| `createSession(agentId, input, idempotencyKey?)` | `Promise<SessionRecord>` | Opens a session. Requires a running agent, else `409 agent_not_running`. |
| `getSession(agentId, sessionId, opts?)` | `Promise<SessionRecord>` | Reads a session, optionally with the at-rest transcript. |
| `listSessions(agentId, opts?)` | `Promise<SessionRecord[]>` | One agent's sessions, newest first by `updated_at`, 50 per page, `page` 1-based. There is no cursor, and this is the surface that carries `run_status`. |
| `archiveSession(agentId, sessionId)` | `Promise<{ session_id?: string; archived: boolean }>` | Stamps `archived_at`. Afterwards writes are `409 session_archived` while reads keep working. Interrupt an in-flight run first. |
| `deleteSession(agentId, sessionId)` | `Promise<void>` | Soft-deletes the session (204), cancelling an in-flight run first. Transcripts and events survive for audit. |
| `postEvents(agentId, sessionId, events)` | `Promise<{ events: { id?: string; type?: string; accepted?: boolean }[] }>` | Writes user or system events into a session. |
| `listEvents(agentId, sessionId, opts?)` | `Promise<SessionEvent[]>` | Reads the durable event log. **One page per call.** |
| `listAllEvents(agentId, sessionId, opts?)` | `Promise<SessionEvent[]>` | Every durable event, by walking `after` until a short page comes back. Reach for this rather than paging `listEvents` by hand. |
| `streamEvents(agentId, sessionId, opts?)` | `AsyncGenerator<SessionEvent>` | Streams durable events over SSE, resumable with `after`. |

**Approvals**

| Method | Returns | What it does |
|---|---|---|
| `listApprovals(agentId, opts?)` | `Promise<ApprovalRecord[]>` | Tool calls parked on a human decision. `opts.status` may only be omitted or `'pending'`, so resolved ones cannot be listed. This is the platform's separate approvals resource, not the `user.tool_confirmation` event loop; without a Temporal signaler the route answers `501 not_configured`. |
| `resolveApproval(agentId, approvalId, input)` | `Promise<Record<string, unknown>>` | Resolves one approval with `allow-once`, `allow-always`, or `deny`; anything else is a 400. Same route family, same `501` without a signaler. |

**System prompt**

| Method | Returns | What it does |
|---|---|---|
| `getSystemPrompt(agentId)` | `Promise<SystemPromptInfo>` | The system-prompt pin as declared and the rendered template in effect. A fresh agent is born pinned to the active platform version; `declaration: null` marks a pre-templates agent still on virtual legacy behaviour. |
| `previewSystemPrompt(agentId, input)` | `Promise<SystemPromptPreview>` | Assembles the exact prompt for runtime facts you supply, without touching any session - deterministic, `transcript` always `[]`, one hash per template slot in `slot_hashes`. `input.config_version` must be the agent's current one, else `409 config_version_changed`. There is deliberately no `upgradeSystemPrompt`: the engine's upgrade route is 404 through the gateway, so the pin only moves at create time. |

**Artifacts**

Artifacts are published by the agent's own in-loop `artifact_publish` tool; these methods
manage what it produced. Every artifact route demands `owner_uid`+`org_id` selectors that the
gateway does not inject - the SDK derives both from the agent's own projection and caches
them per agent, so the first artifact call on an agent costs one extra GET.

| Method | Returns | What it does |
|---|---|---|
| `listArtifacts(agentId, opts?)` | `Promise<ArtifactPage>` | One page (`{artifacts, page, has_more}`) - and unlike `listEvents`, `has_more` tells you when it truncated. `limit` defaults to 50, capped at 100; filter with `sessionId`, `sourcePath`, `createdBefore`. |
| `getArtifact(agentId, artifactId)` | `Promise<ArtifactRecord>` | One artifact row. Foreign and unknown ids are both 404. |
| `downloadArtifact(agentId, artifactId)` | `Promise<{ artifact_id?: string; url?: string }>` | Mints a fresh access URL for a `ready` artifact. The URL is a revocable bearer capability - treat it as a secret. A row that never finalized answers `409 artifact_not_ready`. |
| `deleteArtifact(agentId, artifactId)` | `Promise<ArtifactRecord>` | Deletes one artifact and returns the row as the engine leaves it. |

**Automation: schedules and wake**

| Method | Returns | What it does |
|---|---|---|
| `listSchedules(agentId)` | `Promise<ScheduleRecord[]>` | The agent's schedules. The list answers the raw Temporal describe with the camelCase projection merged on top - read defensively. |
| `createSchedule(agentId, input, idempotencyKey?)` | `Promise<ScheduleRecord>` | Creates a schedule. `201` with a receipt carrying only `schedule_name`, not the definition. Schedules outlive `stopAgent()` and `deleteAgent()`; delete them yourself. |
| `getSchedule(agentId, scheduleId)` | `Promise<ScheduleRecord>` | Reads one schedule, in the camelCase read vocabulary. Nothing comes back under the name you sent it in. |
| `updateSchedule(agentId, scheduleId, update)` | `Promise<ScheduleRecord>` | Replaces the definition. To change the cadence send `schedule`, never the `scheduleSpec` a read hands you - that one answers `200` and is silently ignored. The SDK strips all six refused fields, so a read-tweak-write round trip works from JavaScript too. |
| `deleteSchedule(agentId, scheduleId)` | `Promise<void>` | Deletes a schedule. Like `updateSchedule`, it carries no cross-timeout idempotency guarantee - reconcile by listing rather than blind-retrying. |
| `triggerSchedule(agentId, scheduleId)` | `Promise<{ schedule_name?: string; triggered: boolean }>` | Fires it once, now, out of band. Does not disturb the cadence. |
| `listScheduleRuns(agentId, scheduleId, opts?)` | `Promise<ScheduleRun[]>` | Past fires, newest first. `limit` defaults to 20 and is capped at 100. Rows mix two shapes - switch on `source`. |
| `wake(agentId, input)` | `Promise<WakeResult>` | Pushes a reminder into the agent's heartbeat queue. `next-heartbeat` (the default) only writes the pending row; `now` also kicks the heartbeat schedule and is `409` when no heartbeat is enabled. |

**Exec**

| Method | Returns | What it does |
|---|---|---|
| `exec(agentId, args)` | `Promise<ExecResult>` | Runs argv - not a shell string - in the agent's sandbox, cwd fixed to `/workspace`. **A non-zero exit is still HTTP 200**: this promise resolves, so check `exit_code`. Requires an agent-scope sandbox and a rendered config. |

**Environments**

| Method | Returns | What it does |
|---|---|---|
| `listEnvironments(opts?)` | `Promise<EnvironmentRecord[]>` | The Environments visible to your org, `page` 1-based. The platform default an untouched agent is pinned to is not among them. |
| `getEnvironment(environmentId)` | `Promise<EnvironmentRecord>` | Reads one Environment. `404` for anything outside your org, the platform default included - a selector mismatch, not a permission problem. |
| `createEnvironment(input, idempotencyKey?)` | `Promise<EnvironmentRecord>` | Creates an Environment and its first version. `resource.config` takes exactly `packages`, `files`, `build`, and `networking`; anything else is `400 invalid_environment_config`. |
| `archiveEnvironment(environmentId)` | `Promise<EnvironmentRecord>` | Archives it. The SDK percent-encodes the colon in `{id}:archive` for you - a raw `:` makes the engine miss the route and answer 404, which is the whole reason this method exists. |
| `createEnvironmentVersion(environmentId, config, idempotencyKey?)` | `Promise<EnvironmentVersionRecord>` | Adds an immutable version to an existing Environment. The SDK wraps your `config` as `{ resource: { config } }`, mirroring create. |
| `getEnvironmentVersion(environmentId, version)` | `Promise<EnvironmentVersionRecord>` | Reads one version. Poll **this**, on `status`, to decide whether a version is usable; there is no `state` field here, and a loop written against one never terminates. |

The sections below cover the methods whose behaviour needs spelling out at length; the rest are
one call each. A method being on the client is not a claim that its route has been exercised -
the [capability matrix](/en/reference/capabilities) is where that is recorded, family by
family.

All snippets below assume:

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })
```

---

### `listModels()`

```ts
listModels(): Promise<ModelInfo[]>
```

No parameters. Returns the runtime model catalog as a flat array; the SDK accepts both the
bare-array and the `{ models: [...] }` wire shapes and always hands you an array.

```ts
const models = await zc.listModels()
console.log(models.length, models[0]?.model)
```

```json
[
  {
    "model": "litellm/claude-sonnet-5",
    "display_name": "Claude Sonnet 5",
    "family": "anthropic",
    "api": "anthropic-messages"
  }
]
```

Pass a `model` value verbatim into `resource.model.primary`. Do not hardcode the underlying
provider model name behind the alias.

---

### `createAgent(input, idempotencyKey?)`

```ts
createAgent(
  input: { resource: AgentResource; ownership: Ownership },
  idempotencyKey?: string,
): Promise<AgentRecord>
```

| Parameter | Type | Notes |
|---|---|---|
| `input.resource` | `AgentResource` | The configuration. `name` is required. |
| `input.ownership` | `Ownership` | Required by the wire contract. The gateway overwrites both fields with the anchors bound to your key, so placeholders are fine. |
| `idempotencyKey` | `string` | Sent as the `Idempotency-Key` header. Omitted entirely when you do not pass it. |

Returns the **create receipt**: a flat object with `agent_id`, a top-level `config_version`,
`ownership`, and `resolved_skills`. It carries no `declared` and no `status`.

```ts
const created = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary: 'litellm/claude-sonnet-5' },
      onboarding: false,
    },
    ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
  },
  'provision-research-agent-1',
)

console.log(created.agent_id, created.config_version) // "agt_...", 1
```

The new agent is **stopped**. Call `startAgent()` before you open a session, or
`createSession()` fails with `409 agent_not_running`.

The `config_version` on this receipt goes stale immediately: the gateway seeds the agent's
model credentials right after creation, and each write bumps the version, so a receipt saying
`1` is commonly followed by a `getAgent()` saying `3`.

---

### `getAgent(agentId)`

```ts
getAgent(agentId: string): Promise<AgentRecord>
```

Returns the **read projection**, which is a different shape from the create receipt: the
configuration is under `declared`, the version is at `status.config_version`, and there is no
top-level `config_version` and no top-level `name`.

```ts
const agent = await zc.getAgent(agentId)

console.log(agent.declared?.name)            // 'research-agent'
console.log(agent.status?.desired_state)     // 'running'
console.log(agent.status?.config_version)    // 3
```

Write one accessor that covers both shapes and use it everywhere:

```ts
import type { AgentRecord } from '@zooclaw-agents/sdk'

const configVersion = (a: AgentRecord): number | undefined =>
  a.status?.config_version ?? a.config_version
```

An unknown, soft-deleted, or other-organization agent id returns `404 not_found`.

---

### `updateAgent(agentId, sections)`

```ts
updateAgent(agentId: string, sections: Record<string, unknown>): Promise<AgentRecord>
```

PUTs the declared sections you name and returns the read projection.

**Sections you omit are preserved.** The merge is per section and one level deep: a section
you do send replaces the old value of that section wholesale.

```ts
const updated = await zc.updateAgent(agentId, { labels: { tier: 'paid' } })

console.log(updated.declared?.name)   // unchanged - `name` was not in the body
console.log(updated.declared?.labels) // { tier: 'paid' } - replaced, not merged key-by-key
```

`tool_policy` is the exception even to that: every PUT naming it replaces the whole object,
and `{}` clears the policy back to the full tool manifest.

**Every successful PUT bumps `config_version`, including one whose body is byte-identical to
what is stored.** There is no no-op detection, so "the version did not change" is not a
signal you can read, and the version is not a receipt for your own write. See
[Errors and retries](/en/reference/errors).

`skills`, `warm`, `credentials`, and unknown fields in the PUT body return `400`.

---

### `deleteAgent(agentId)`

```ts
deleteAgent(agentId: string): Promise<void>
```

Soft-deletes the agent and resolves with nothing. Repeated calls succeed. After deletion,
`getAgent()` returns `404 not_found`.

It does **not** stop the agent, cancel running workflows, delete schedules, or release the
sandbox. Stop first, then delete:

```ts
await zc.stopAgent(agentId)
await zc.deleteAgent(agentId)
```

---

### `putCredential(agentId, app, body)`

```ts
putCredential(agentId: string, app: string, body: Record<string, unknown>): Promise<void>
```

::: danger Not supported through the public gateway
The credential routes return **404** with an API key. The gateway seeds the agent's model
credentials itself; it deliberately does not expose credential writes. There is no supported
way to store your own or your end users' third-party credentials.

The method remains on the interface because the same SDK also drives an internal deployment.
Do not build against it. See [Authentication](/en/get-started/authentication).
:::

For that internal deployment: the body shape is credential-specific (`{ api_key }` for the
model backend, `{ token }` for the user-internal token), each PUT appends a new secret
version, and a timed-out PUT must be reconciled with `listCredentials()` before any retry.

---

### `listCredentials(agentId)`

```ts
listCredentials(agentId: string): Promise<{ app: string; ref: string }[]>
```

Returns the agent's credential slots, unwrapped from the wire's `{ credentials: [...] }`
envelope; an absent list becomes `[]`.

::: danger Not supported through the public gateway
Returns **404** with an API key, same as `putCredential()`.
:::

---

### `startAgent(agentId)`

```ts
startAgent(agentId: string): Promise<{ warnings: string[] }>
```

Flips `desired_state` to `running`. This is the precondition for `createSession()` and
`postEvents()`. It is fast - sub-second in practice.

```ts
const { warnings } = await zc.startAgent(agentId)
console.log(warnings)
// [ 'channel_routes_reload_failed: routes reload returned 404' ]
```

**`warnings` is informational, not a failure.** An API-only agent has no chat-channel routes
to reload, so it reports `channel_routes_reload_failed` on every start and every stop. Log it
and continue. Do not retry on it.

Then wait for `status.desired_state === 'running'`, and never for `status.actual_state`. That
wait is a method - do not write the loop yourself:

```ts
const agent = await zc.waitUntilRunning(agentId)
console.log(agent.status?.desired_state) // 'running'
```

```ts
waitUntilRunning(
  agentId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<AgentRecord>
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `opts.timeoutMs` | `number` | `30_000` | Total budget. Start is sub-second in practice, so this is for a bad day. |
| `opts.intervalMs` | `number` | `500` | Gap between polls. |
| `opts.signal` | `AbortSignal` | - | Cancels the wait, including the request in flight. |

It polls `getAgent()` and resolves with the first projection that reads `running`. On timeout
it throws a `ZooclawError` with `status: 408` and `type: 'timeout'`; on abort, `status: 0` and
`type: 'aborted'`. **Both are synthesized locally** - the server never sends either, and the
abort does not leak a `DOMException`.

Both bounds cover an **in-flight request**, not just the gap between polls: every poll carries
its own signal that fires on your `signal` or on whatever is left of the budget. `fetch`
imposes no timeout of its own anywhere the SDK runs, so a gateway that accepts the connection
and then never answers would park a hand-rolled loop forever - an `attempts` counter or a
`Date.now() >= deadline` check between polls never gets to run.

---

### `stopAgent(agentId)`

```ts
stopAgent(agentId: string): Promise<{ warnings: string[] }>
```

Flips `desired_state` to `stopped`, with the same warning behaviour as `startAgent()`. After
a stop, `createSession()` on that agent returns `409 agent_not_running`.

```ts
const { warnings } = await zc.stopAgent(agentId)
```

Both start and stop re-run their convergence actions on every call, so they are safe to call
against the same id again.

---

### `listAgentSkills(agentId, opts?)`

```ts
listAgentSkills(agentId: string, opts?: { verbose?: boolean }): Promise<AgentSkill[]>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.verbose` | `boolean` | Sends `?verbose=true`, which also returns ineligible and excluded entries. |

Returns the skills resolved and merged onto the agent, unwrapped from the wire's
`{ skills: [...] }` envelope.

```ts
const skills = await zc.listAgentSkills(agentId)
console.log(skills.length, skills.map((s) => s.name).slice(0, 5))
```

A freshly created agent already has the whole global catalog attached, so call this before
you try to install anything.

---

### `putAgentSkill(agentId, skillId, opts?)`

```ts
putAgentSkill(
  agentId: string,
  skillId: string,
  opts?: { enabled?: boolean; versionPin?: number | null },
): Promise<{ config_version?: number; warnings?: string[] }>
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `opts.enabled` | `boolean` | `true` | Sent as `enabled` in the body. |
| `opts.versionPin` | `number \| null` | `null` | Sent as `version_pin` in the body. |

```ts
const { config_version } = await zc.putAgentSkill(agentId, 'skl_yourown', { enabled: true })
```

Only skills **your own tenant uploaded** (`org` or `personal` scope) are installable through
the public gateway. A `global` catalog id is listable but answers `404` here. Those global
skills are already attached at creation, so there is nothing to install and nothing to remove.

::: warning Not yet verified
We have exercised the 404 on a global-scope id. We have not installed an org-scope or
personal-scope skill end to end, because no such skill existed under the test tenant. The
route is open to those scopes; confirm it yourself before you depend on it.
:::

---

### `deleteAgentSkill(agentId, skillId)`

```ts
deleteAgentSkill(agentId: string, skillId: string): Promise<void>
```

Detaches a skill and resolves with nothing. Subject to the same scope rule as
`putAgentSkill()`.

```ts
await zc.deleteAgentSkill(agentId, 'skl_yourown')
```

---

### `createSession(agentId, input, idempotencyKey?)`

```ts
createSession(
  agentId: string,
  input: { initial_events?: OutboundEvent[]; metadata?: Record<string, unknown> },
  idempotencyKey?: string,
): Promise<SessionRecord>
```

| Parameter | Type | Notes |
|---|---|---|
| `input.initial_events` | `OutboundEvent[]` | Accepts only `user.message`, at most 50 entries. Supplying one starts the first turn immediately. |
| `input.metadata` | object | Arbitrary JSON stored with the session and echoed by `getSession()`. Nothing interprets it. You cannot add to it later. |
| `idempotencyKey` | `string` | Sent as the `Idempotency-Key` header. |

```ts
const session = await zc.createSession(
  agentId,
  {
    initial_events: [{ type: 'user.message', content: 'Summarize this brief.' }],
    metadata: { source: 'my-app' },
  },
  `chat-${incomingMessageId}`,
)

console.log(session.session_id)  // "ses_example"
console.log(session.session_key) // "api:example"
```

The agent must be running. Against a stopped agent this throws
`ZooclawError` with `status: 409` and `type: 'agent_not_running'`.

Derive the idempotency key from something stable in your own system, not from a value
generated at call time - its whole purpose is to survive the retry after a timeout.

---

### `getSession(agentId, sessionId, opts?)`

```ts
getSession(
  agentId: string,
  sessionId: string,
  opts?: { history?: boolean; limit?: number },
): Promise<SessionRecord>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.history` | `boolean` | Only `true` is sent, as `?history=true`. Adds the at-rest transcript. |
| `opts.limit` | `number` | Number of most recent transcript rows. Server default 100, maximum 500. Only meaningful with `history: true`. |

```ts
import { messageText } from '@zooclaw-agents/sdk'

const s = await zc.getSession(agentId, sessionId, { history: true, limit: 20 })

console.log(s.run_status)  // 'succeeded'  <- the live field
console.log(s.status)      // null         <- always

for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  console.log(row.seq, messageText(row.entry.message))
}
```

::: danger `status` is always `null`
`SessionRecord.status` comes back `null` on every read. It is not a state machine. The live
field is `run_status`. Code branching on `session.status` takes the same branch forever.
:::

---

### `postEvents(agentId, sessionId, events)`

```ts
postEvents(
  agentId: string,
  sessionId: string,
  events: OutboundEvent[],
): Promise<{ events: { id?: string; type?: string; accepted?: boolean }[] }>
```

Writes events into an existing session. Responds `202` with one entry per event, unwrapped
from the wire envelope; an absent list becomes `[]`.

The write path accepts four types: `user.message`, `user.interrupt`, `system.message`, and
`user.tool_confirmation`.

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'What is my display name?' },
])
```

`accepted` means the event was queued, not that a turn finished. A turn ends at
`run.finished`.

**`user.interrupt` against a live run aborts it**: the response carries `accepted: true` and
the run ends with `run.finished` whose `payload.status` is `aborted`.

```ts
const r = await zc.postEvents(agentId, sessionId, [{ type: 'user.interrupt' }])
console.log(r.events[0]?.accepted)
```

With no run in flight, `user.interrupt` answers `accepted: false`. **That is a no-op, not an
error** - nothing throws, and there is nothing to handle.

**`system.message` reaches the model on the following turn.** It is an out-of-band injection
channel:

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'system.message', text: "Operator note: the user's display name is Ada." },
])
```

There is no idempotency key on this route. A `postEvents` retried after a timeout can deliver
the same message twice; de-duplicate on your side.

---

### `listEvents(agentId, sessionId, opts?)`

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.after` | `number` | Seq cursor. Returns events with a higher `seq`. |
| `opts.types` | `string[]` | Server-side filter, joined with commas onto `?types=`. |
| `opts.limit` | `number` | Server default 100, maximum 500. |

Every entry is passed through `normalizeEvent()`, so REST and SSE hand you the identical
`SessionEvent` shape.

```ts
const events = await zc.listEvents(agentId, sessionId, { types: ['agent.assistant'] })
```

::: warning One page per call - long sessions truncate silently
The server returns 100 events by default and at most 500, and `listEvents` returns exactly
one page. There is no `has_more` flag and no error: a session with 900 events answers with
the first 100 and looks complete.
:::

`listAllEvents` exists for exactly that reason. It pages with `after` until a page comes back
shorter than the limit it asked for:

```ts
const all = await zc.listAllEvents(agentId, sessionId)
```

```ts
listAllEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; types?: string[]; pageSize?: number },
): Promise<SessionEvent[]>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.after` | `number` | Start cursor. Everything at or below it is left out. |
| `opts.types` | `string[]` | Same server-side filter as `listEvents`, applied to every page. |
| `opts.pageSize` | `number` | The per-request `limit`. Defaults to 500 and is clamped to it. |

Events come back in ascending `seq`. Two guards a hand-rolled loop usually lacks: events at or
below the cursor are dropped, so a boundary event replayed at a page edge does not reach you
twice, and the walk stops if the highest `seq` in a page fails to advance the cursor, so a
server that ignored `after` returns a duplicate page instead of spinning forever.

---

### `streamEvents(agentId, sessionId, opts?)`

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.after` | `number` | Resume cursor. Sent as `?after=<seq>` when greater than 0; the server replays from there. |
| `opts.signal` | `AbortSignal` | Aborts the underlying request. When the signal is already aborted the generator returns quietly instead of throwing. |

An async generator of `SessionEvent`. Consume it with `for await`.

```ts
import { assistantText, isRunFinished, runOutcome } from '@zooclaw-agents/sdk'

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let lastSeq = 0
let outcome: string | undefined

for await (const ev of zc.streamEvents(agentId, sessionId, { signal: ctl.signal })) {
  lastSeq = ev.seq
  text += assistantText(ev)
  if (isRunFinished(ev)) {
    outcome = runOutcome(ev)
    break
  }
}

clearTimeout(budget)
ctl.abort()
console.log(outcome, text)
```

Four behaviours worth knowing:

- **The stream is session-scoped and does not close when a turn ends.** `run.finished` is the
  end of a turn, not of the stream. Break out yourself with `isRunFinished`, and always abort
  the controller when you leave the loop.
- **The server closes the stream on idle.** Reconnect with
  `streamEvents(agentId, sessionId, { after: lastSeq })`. Resume is server-side, so nothing
  between the two windows is lost. The SDK does not reconnect for you.
- **`chat.delta` preview frames are skipped.** They arrive as SSE `event_delta` frames on a
  separate non-durable lane with snapshot-replace semantics, and the SDK drops them. You only
  ever see durable events.
- **Boundary events are de-duplicated.** Each frame's durable `seq` comes from the SSE `id:`
  line, and the generator discards any event whose `seq` is not greater than the last one it
  yielded, so a replayed boundary event on reconnect does not reach you twice.

A non-2xx response throws a `ZooclawError`. That particular error is built from the status
line alone, so **`type` is always `undefined` on a stream failure** - branch on `status`.

## Types

Every response type ends with `[k: string]: unknown`. The API is Developer Preview and may
add fields within a version: ignore what you do not recognize rather than failing on it.

The sections here cover the types you handle on the paths this page walks. The skill-registry,
approval, schedule, wake, exec, and Environment types are all in the
[complete export list](#complete-export-list), and each carries its field-level traps in the
JSDoc your editor shows on hover - `ScheduleRecord` and `ScheduleUpdate` especially, because
the write shape and the read shape of a schedule are different documents.

### `SessionEvent`

```ts
interface SessionEvent {
  seq: number
  eventType: SessionEventType | string
  payload: Record<string, unknown>
  runId?: string
  turn?: number
  createdAt?: string
}
```

| Field | Notes |
|---|---|
| `seq` | Durable per-session sequence. This is the `after` cursor for both `listEvents` and `streamEvents`. `-1` when the wire carried neither a `seq` field nor a numeric SSE `id:`. |
| `eventType` | One of `SESSION_EVENT_TYPES`, or an unknown string that passed through. `''` if the wire carried no type at all. |
| `payload` | The event body. Shape varies by type; use the helpers below rather than reaching in blind. |
| `runId` | The run this event belongs to. |
| `turn` | Turn number within the session. |
| `createdAt` | ISO timestamp. |

The wire presents the same event in two spellings, and **neither has a top-level `type`
field**:

```
REST  GET .../events         { seq, run_id, turn, event_type, payload, created_at }
SSE   GET .../events/stream  { seq, runId, turn, eventType, payload, createdAt, ... }
```

`normalizeEvent()` absorbs both, which is why every SDK read hands you one shape. Anyone
calling the HTTP API directly has to handle both spellings.

### `AgentRecord`

```ts
interface AgentRecord {
  agent_id: string
  computer_id?: string
  config_version?: number
  declared?: Record<string, unknown>
  resolved_skills?: { skill_id: string; name?: string; version?: number | string; eligible?: boolean }[]
  status?: AgentStatus
  ownership?: Ownership
  [k: string]: unknown
}
```

One interface, two response shapes:

| | create receipt (`createAgent`) | read projection (`getAgent`, `updateAgent`) |
|---|---|---|
| version | `config_version` (top level) | `status.config_version` |
| name | not present | `declared.name` |
| lifecycle state | not present | `status.desired_state` |
| `declared` | absent | present |
| `status` | absent | present |

`config_version` is marked optional for exactly this reason. Read it as
`agent.status?.config_version ?? agent.config_version`.

### `AgentStatus`

```ts
interface AgentStatus {
  desired_state?: 'running' | 'stopped' | 'deleted' | string
  actual_state?: 'activating' | 'active' | 'degraded' | 'error' | 'stopped' | 'deleting' | string
  config_version?: number
  render_state?: string
  status_message?: string | null
  channels?: { expected?: number; connected?: number; degraded_since?: string | null }
  [k: string]: unknown
}
```

::: danger Never gate on `actual_state`
Two fields that sound interchangeable and are not.

`desired_state` is the one that gates the API. `running` is the precondition for
`createSession()` and `postEvents()`; anything else is `409 agent_not_running`. It flips to
`running` in well under a second after `startAgent()`.

`actual_state` is **chat-channel health** - Mattermost and Feishu route connectivity - not
API readiness. An API-only agent has no channels to connect (`channels.expected === 0`), so
it sits at `activating` forever and `active` is unreachable. `running` is not even a member
of the `actual_state` enum, so a loop polling for it never returns. We have driven full
turns to `succeeded` on an agent whose `actual_state` never left `activating`.

Poll `status.desired_state`. Never poll `status.actual_state`.
:::

`config_version` here is the authoritative version on the read path.

### `AgentResource`

```ts
interface AgentResource {
  name: string
  model?: { primary: string; input?: string[] }
  persona?: { docs: { name: string; content: string; seed_policy?: string }[] }
  skills?: { skill_id: string; version?: number | 'latest' }[]
  labels?: Record<string, string>
  tool_policy?: Record<string, unknown>
  mcp?: McpServerDeclaration[]
  system_prompt?: SystemPromptDeclaration
  outcome?: OutcomeConfig | null
  sandbox?: { scope: 'agent' | 'session' }
  environment_id?: string
  environment_version?: number
  warm?: boolean
  onboarding?: boolean
  [k: string]: unknown
}
```

The configuration you send to `createAgent()`. `name` is the only required field. `mcp`
declares remote MCP servers, and `onboarding: false` skips the persona bootstrap turns - set
it on every API-driven agent unless you actually want them. `system_prompt` pins a template
version (omitted on create means "the platform version active right now", pinned from then
on; replace-on-write on PUT like `tool_policy`), and `outcome` is the agent-level default
gate for unattended cron fires. The index signature is what keeps a field a newer server
accepts from failing to type-check.

Two fields the type allows that you should not send through the public gateway: `skills` at
create time (use `putAgentSkill()`), and `warm` (rejected by `updateAgent()`). See
[Agents](/en/build/agents) for the field-by-field notes.

### `AgentSkill`

```ts
interface AgentSkill {
  skill_id?: string
  name?: string
  version?: number | string
  scope?: 'global' | 'org' | 'personal' | 'pack' | string
  eligible?: boolean
  files?: { path: string; size?: number; sha256?: string }[]
  [k: string]: unknown
}
```

`scope` is the field that decides whether you can manage the skill: only `org` and `personal`
are installable through the public gateway.

### `SessionRecord`

```ts
interface SessionRecord {
  session_id: string
  session_key?: string
  channel?: string
  run_status?: string
  status?: string | null
  metadata?: Record<string, unknown>
  archived?: boolean
  updated_at?: string
  history?: SessionHistoryEntry[]
  [k: string]: unknown
}
```

`history` is present only when the read asked for `history: true`; it holds the most recent
`limit` rows, in ascending `seq` order.

`status` is always `null` in practice - `run_status` is the live field, and `listSessions` is
the surface that carries it. `session_key` is channel-qualified: sessions you create through
the API are `api:<session_id>`. `channel` is `api` for sessions you create and `cron` for ones
a schedule fired.

### `SessionHistoryEntry`

```ts
interface SessionHistoryEntry {
  seq: number
  entry_type: string
  entry: Record<string, unknown>
  created_at?: string
}
```

One transcript row. This is the **at-rest transcript, not the event log**: conversation text
lives under `entry.message` as `{ role, content }` for `entry_type: 'message'`. Other
`entry_type` values exist (session anchors, compaction markers, model changes); filter for
`message` and skip the rest.

Use it to recover an answer whose events you missed; use `listEvents` when you want the event
stream.

### `OutboundEvent`

```ts
interface OutboundEvent {
  type: string
  content?: unknown
  [k: string]: unknown
}
```

A write-side event. `type` is one of `user.message`, `user.interrupt`,
`user.tool_confirmation`, or `system.message`. The index signature carries the per-type
fields: `content` for `user.message`, `text` for `system.message`.

`type` is typed as `string`, so a typo compiles. The server rejects it.

### `ModelInfo`

```ts
interface ModelInfo {
  model: string
  display_name?: string
  family?: string
  api?: string
  [k: string]: unknown
}
```

`model` is the stable alias to submit as `resource.model.primary`. `family` is display
metadata; `api` is the protocol face (`anthropic-messages` or `openai-completions`).

### `Ownership`

```ts
interface Ownership {
  owner_uid: string
  org_id: string
}
```

A persistence anchor, not an auth claim. `createAgent()` requires it, and the gateway
overwrites both fields with the anchors bound to your key. Send placeholders and read the
real values back from `created.ownership`.

### `ToolCall`

```ts
interface ToolCall {
  phase: 'start' | 'end' | 'blocked'
  toolName: string
  toolCallId: string
  args?: Record<string, unknown>
  isError?: boolean
  resultPreview?: string
}
```

The decoded form of an `agent.tool` event, returned by `toolCall()`.

- One tool call produces **two events sharing a `toolCallId`**: `phase: 'start'` carries
  `args`; `phase: 'end'` carries `isError` and `resultPreview`. Pair them by `toolCallId` -
  they are **not adjacent** in the stream when calls run concurrently.
- `phase: 'blocked'` is a third state: the call is waiting on an approval and has **not**
  run. Treat it as pending, not as an end. The matching `agent.approval` event carries the
  request, and an `end` still follows once it resolves.
- **A tool failing does not fail the run.** An `agent.tool` event with `isError: true` is
  still followed by `run.finished` with `succeeded`. Do not infer turn success from the
  absence of tool errors.

### Config types

`ZooclawConfig`, `ZooclawAuth`, and `ZooclawClient` are covered under
[`createZooclawClient`](#createzooclawclientconfig). `ZooclawClient` is exported as a type so
you can pass a client into your own helpers:

```ts
import type { ZooclawClient } from '@zooclaw-agents/sdk'

async function reply(zc: ZooclawClient, agentId: string, text: string) { /* ... */ }
```

### `ZooclawError`

```ts
class ZooclawError extends Error {
  status: number
  type?: string
}
```

Thrown by every method on a non-2xx response. Match on `error.type`, never on the message.
See [Errors and retries](/en/reference/errors) for the full treatment.

## Event helpers

Pure functions over a `SessionEvent`. None of them touch the network.

| Helper | Signature | Returns |
|---|---|---|
| `isRunFinished` | `(e: SessionEvent) => boolean` | `true` for `run.finished`. |
| `runOutcome` | `(e: SessionEvent) => 'succeeded' \| 'failed' \| 'aborted' \| undefined` | The run's outcome, or `undefined` for any other event. |
| `assistantText` | `(e: SessionEvent) => string` | Assistant text for `agent.assistant`; `''` for every other type. |
| `thinkingText` | `(e: SessionEvent) => string` | Reasoning text for `agent.thinking`; `''` for every other type. |
| `toolCall` | `(e: SessionEvent) => ToolCall \| undefined` | Decoded tool activity for `agent.tool`; `undefined` otherwise. |
| `messageText` | `(message: unknown) => string` | Text of one `{ role, content }` message. |
| `normalizeEvent` | `(raw: unknown, sseId?: string) => SessionEvent` | Absorbs either wire shape into a `SessionEvent`. |

Because the text helpers return `''` for non-matching types, you can accumulate
unconditionally:

```ts
import { assistantText, thinkingText, toolCall, isRunFinished, runOutcome } from '@zooclaw-agents/sdk'

let text = ''

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  text += assistantText(ev)

  const think = thinkingText(ev)
  if (think) console.log(`thinking: ${think.slice(0, 60)}`)

  const call = toolCall(ev)
  if (call) console.log(`tool ${call.toolName} ${call.phase}${call.isError ? ' (error)' : ''}`)

  if (isRunFinished(ev)) {
    console.log('run', runOutcome(ev))
    break
  }
}
```

### `messageText(message)`

Assistant text lives at `payload.message.content[]`, and `content` is normally an array of
blocks where **only `{ type: 'text', text }` blocks carry text** - thinking and tool-call
blocks do not, and one message may hold several text blocks. A plain string is accepted too,
which is how write-side `user.message` content comes back.

`messageText` handles both, which makes it the right tool for transcript rows as well as
events:

```ts
import { messageText } from '@zooclaw-agents/sdk'

const s = await zc.getSession(agentId, sessionId, { history: true })
for (const row of s.history ?? []) {
  if (row.entry_type === 'message') console.log(messageText(row.entry.message))
}
```

`assistantText(e)` is `messageText(e.payload.message)` guarded by the event type.

### `normalizeEvent(raw, sseId?)`

```ts
function normalizeEvent(raw: unknown, sseId?: string): SessionEvent
```

Accepts either wire shape and never throws. `sseId` is the SSE `id:` line, used as the `seq`
fallback when the JSON body does not carry one. The SDK calls it for you in `listEvents` and
`streamEvents`; call it directly only when you are parsing the wire yourself.

Unknown event types pass through unchanged rather than throwing, because the API may add
types within a version.

### `SESSION_EVENT_TYPES`

```ts
const SESSION_EVENT_TYPES: readonly [
  'run.started', 'run.finished',
  'chat.delta', 'chat.final', 'chat.aborted', 'chat.error',
  'agent.lifecycle', 'agent.assistant', 'agent.thinking', 'agent.tool', 'agent.item',
  'agent.plan', 'agent.approval', 'agent.command_output', 'agent.patch',
  'agent.compaction', 'agent.error',
  'attachment.created', 'message.outbound',
]

type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]
```

The full read-side vocabulary: 19 types. `SessionEvent.eventType` is
`SessionEventType | string`, so an unknown type from a newer server still type-checks and
still reaches you.

Use the array to validate or to build filters:

```ts
import { SESSION_EVENT_TYPES, type SessionEventType } from '@zooclaw-agents/sdk'

const known = new Set<string>(SESSION_EVENT_TYPES)
if (!known.has(ev.eventType)) console.warn('unknown event type', ev.eventType)
```

`run.finished` is the end of a turn, with `payload.status` of `succeeded`, `failed`, or
`aborted`. `chat.delta` never reaches you from `streamEvents` - those frames are skipped.

## `parseSSE`

```ts
function parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage>

interface SSEMessage {
  event: string
  id?: string
  data: unknown
}
```

The raw SSE line parser, exported for advanced use. `streamEvents()` already uses it, and you
do not need it for normal work.

It yields one `SSEMessage` per frame: `event` is the SSE event name (defaulting to
`message`), `id` is the `id:` line - which for durable event frames is the `seq` - and `data`
is the JSON-parsed body, falling back to the raw string when the payload is not JSON.

Reach for it when you are calling the stream endpoint yourself, for instance to see the
`event_delta` preview frames that `streamEvents()` deliberately skips:

```ts
import { parseSSE, normalizeEvent } from '@zooclaw-agents/sdk'

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
})

for await (const msg of parseSSE(res.body!)) {
  if (msg.event === 'event_delta') continue
  console.log(normalizeEvent(msg.data, msg.id))
}
```

Dropping the `id:` line would freeze your resume cursor, which is why the parser surfaces it.

## Complete export list

```ts
import {
  // client
  createZooclawClient,
  DEFAULT_BASE_URL,
  ZooclawError,
  type ZooclawClient,
  type ZooclawConfig,
  type ZooclawAuth,

  // resource types
  type Ownership,
  type ModelInfo,
  type AgentResource,
  type AgentRecord,
  type AgentStatus,
  type AgentSkill,
  type McpServerDeclaration,
  type SkillRecord,
  type SessionRecord,
  type SessionHistoryEntry,
  type SessionEvent,
  type OutboundEvent,

  // approvals
  type ApprovalDecision,
  type ApprovalRecord,

  // system prompt
  type SystemPromptDeclaration,
  type SystemPromptInfo,
  type SystemPromptPreview,
  type SystemPromptPreviewInput,

  // artifacts
  type ArtifactStatus,
  type ArtifactRecord,
  type ArtifactPage,

  // outcome
  type OutcomeConfig,
  type OutcomeEvaluator,

  // schedules, wake, exec
  type ScheduleSpec,
  type SchedulePayload,
  type ScheduleInput,
  type ScheduleUpdate,
  type ScheduleRecord,
  type ScheduleRun,
  type WakeResult,
  type ExecResult,

  // environments
  type EnvironmentConfig,
  type EnvironmentResource,
  type EnvironmentRecord,
  type EnvironmentVersionRecord,

  // events
  SESSION_EVENT_TYPES,
  type SessionEventType,
  normalizeEvent,
  isRunFinished,
  runOutcome,
  messageText,
  assistantText,
  thinkingText,
  toolCall,
  type ToolCall,

  // sse
  parseSSE,
  type SSEMessage,
} from '@zooclaw-agents/sdk'
```

Twelve values and forty-one types, pinned by a test that asserts the entry point's exports as
a set - a missing symbol and an accidental extra one both fail it. `DEFAULT_BASE_URL` is the
public gateway base that `ZOOCLAW_BASE_URL` and the `baseUrl` option override; it is exported
so you can compare against it or build a URL by hand.

That is the entire public surface. Anything not on this list does not exist - in particular
there is no `patchSession`. `PATCH /agents/{id}/sessions/{sid}` answers `405` through the
gateway, whose catch-all registers GET, POST, PUT, and DELETE only, so PATCH is not proxied at
all and a session's `metadata` is write-once at `createSession()`. See
[Not supported](/en/reference/not-supported).

## Next

- [Errors and retries](/en/reference/errors) - the `ZooclawError.type` values worth branching on.
- [Agents](/en/build/agents) - create, start, update, and the two response shapes.
- [Sessions](/en/build/sessions) - drive a turn, page the event log, read the transcript.
