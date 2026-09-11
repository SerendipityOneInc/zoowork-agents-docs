---
description: Look up every TypeScript SDK client method, exported type, helper, and error class.
---

# TypeScript SDK reference

Every symbol `@zoowork-ai/sdk` exports, with the signature the compiler sees.

This page is the reference. For task-shaped guidance start at [Agents](../build/agents.md),
[Sessions](../build/sessions.md), or the [Quickstart](../get-started/quickstart.md).

## Install

```bash
pnpm add @zoowork-ai/sdk
```

```bash
npm install @zoowork-ai/sdk
```

The package is `@zoowork-ai/sdk`. It ships **ESM only** and is compiled to ES2022, so set
`"type": "module"` in your `package.json`.

### Runtimes

The SDK has **zero runtime dependencies**. It uses the platform `fetch`, Web Streams, and
`TextDecoder` and nothing else, so it runs anywhere those exist:

| Runtime | Notes |
|---|---|
| Node 20 or later | The main target. `fetch` and `ReadableStream` are built in. |
| Cloudflare Workers, Deno, Bun, other edge runtimes | Supported by construction. The SSE parser is written against Web Streams, not Node streams. |
| Browsers | Technically works, but your API key authenticates your whole organization. Do not ship it to a client. See [Authentication](../get-started/authentication.md). |

### Injecting `fetch`

`ZooworkConfig.fetch` replaces `globalThis.fetch` for every request the client makes,
including the SSE stream. Use it to bind a runtime-specific fetch, to add tracing, or to
serve canned responses in tests.

```ts
const zc = createZooworkClient({
  apiKey: process.env.ZOOWORK_API_KEY,
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

## `createZooworkClient(config)`

```ts
function createZooworkClient(cfg?: ZooworkConfig): ZooworkClient
```

Returns a `ZooworkClient`. No connections are opened, no requests are made, and a missing API
key throws at construction; everything else is validated on first use. Constructing a client
with a bad key succeeds; the first call fails with `401`.

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

Clients are cheap. Create one per process and share it.

### `ZooworkConfig`

```ts
interface ZooworkConfig {
  apiKey?: string
  baseUrl?: string
  auth?: ZooworkAuth
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}
```

Every field is optional, and with `ZOOWORK_API_KEY` exported so is the whole object:
`createZooworkClient()` is a valid call.

| Field | Type | Required | Notes |
|---|---|---|---|
| `apiKey` | `string` | no | Your `zct_...` key. Resolution order: this option, then `ZOOWORK_API_KEY`. This is the field to use. |
| `baseUrl` | `string` | no | The API base **including the version prefix**. Resolution order: this option, then `ZOOWORK_BASE_URL`, then the exported `DEFAULT_BASE_URL` (the public gateway). Set it only to target a different deployment. Trailing slashes are stripped; paths such as `/models` and `/agents/{id}/sessions` are appended directly. |
| `auth` | `ZooworkAuth` | no | Advanced. `{ apiKey }` here is equivalent to the top-level `apiKey`, and beats it if you pass both. See below. |
| `fetch` | function | no | Defaults to `globalThis.fetch`. |

### `ZooworkAuth`

```ts
type ZooworkAuth = { serviceToken: string } | { apiKey: string }
```

**Use `{ apiKey }`.** It is your `zct_...` organization service token, sent as
`Authorization: Bearer zct_...` on every request including the SSE stream.

```ts
auth: { apiKey: process.env.ZOOWORK_API_KEY! }
```

The `{ serviceToken }` variant is internal-only and not usable with an API key; with a
`zct_` key, always pass `{ apiKey }`.

## Methods

`ZooworkClient` exposes 62 methods, grouped below the way the client groups them. Everything
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
| `listAgents(opts?)` | [`AgentPagePromise`](#listagentsopts) | Lists the agents owned by your key's bound user. `opts.labels` filters on declared labels, `opts.page` is 1-based, page size is fixed at 100. The scope is `owner_uid` **and** `org_id`, so an agent a colleague created in your org is fetchable by id and absent from this list. |
| `getAgent(agentId)` | `Promise<AgentRecord>` | Reads an agent. Returns the **projection**: config under `declared`, version at `status.config_version`. |
| `updateAgent(agentId, sections)` | `Promise<AgentRecord>` | PUTs the named declared sections, merging per section. Bumps `config_version` on every call. |
| `deleteAgent(agentId)` | `Promise<void>` | Soft-deletes the agent. Does not stop it. |
| `startAgent(agentId)` | `Promise<{ warnings: string[] }>` | Flips `desired_state` to `running`. Required before any session call. |
| `stopAgent(agentId)` | `Promise<{ warnings: string[] }>` | Flips `desired_state` to `stopped`. |
| `waitUntilRunning(agentId, opts?)` | `Promise<AgentRecord>` | Polls `status.desired_state` until it reads `running`, then hands back that projection. Defaults: 30s budget, 500ms between polls. Throws `408`/`timeout`. |
| `listAgentSkills(agentId, opts?)` | `Promise<AgentSkill[]>` | Lists the skills resolved onto the agent. |
| `putAgentSkill(agentId, skillId, opts?)` | `Promise<{ config_version?: number; warnings?: string[] }>` | Attaches a skill your own tenant owns. Global-catalog ids return 404. |
| `deleteAgentSkill(agentId, skillId)` | `Promise<void>` | Detaches a skill. |

**Channels**

Bind a chat platform to an API-created agent, so the same agent also answers people in the
chat app. Feishu/Lark, WeCom and WeChat have a server-driven QR flow; Slack does not and binds
through `addChannel` with credentials you already hold, while WeChat is the reverse — the QR
flow is its only path. See [Channels](../build/channels.md) for the platform table and the traps.

| Method | Returns | What it does |
|---|---|---|
| `listChannels(agentId)` | `Promise<AgentChannel[]>` | The platform accounts bound to this agent, with their `health` and `status`. Empty for a pure API agent. |
| `addChannel(agentId, input)` | `Promise<AgentChannel>` | Binds a platform from explicit credentials in `config` (201). **201 means stored, not working** - credentials are not validated at bind time, so read the verdict from `health`/`status` on a follow-up `listChannels`. |
| `updateChannel(agentId, platform, input?)` | `Promise<AgentChannel>` | Changes `dm_policy`, `group_policy`, or `enabled` on one binding and returns it in its new state. The public gateway ignores `allow_from`; it is not a working allowlist. **Not** idempotent: a platform with no binding is `404 channel.not_found`. |
| `removeChannel(agentId, platform, opts?)` | `Promise<void>` | Unbinds one `platform` + `account` (`account` defaults to `'default'`). Idempotent, unlike `updateChannel` - removing a binding that is not there answers `200 { ok: true }`. |
| `startChannelSetup(agentId, platform, input?)` | `Promise<ChannelSetupSession>` | Starts a QR registration on `'feishu'`, `'wecom'` or `'weixin'`. Feishu answers `verification_uri_complete` and a `poll_interval`, with `expires_in: 600`; WeCom and WeChat answer `qrcode_url` with no interval and `expires_in: 300`, and WeChat's may be an inline `data:image/…` payload. You own the UI: render whichever one came back, usually as a QR code. `brand: 'lark'` (Feishu only) switches the URI host to `open.larksuite.com` and must match the workspace the person approves it in. |
| `pollChannelSetup(agentId, platform, sessionId)` | `Promise<ChannelPollResult>` | Polls that session once. A cancelled or vanished session answers `404 channel.{platform}_session_not_found` rather than a terminal status, so a hand-rolled loop must treat that 404 as an end condition, not a transport error to retry. |
| `cancelChannelSetup(agentId, platform, sessionId)` | `Promise<void>` | Abandons a setup session. Polling it afterwards 404s. |
| `waitForChannelSetup(agentId, platform, sessionId, opts?)` | `Promise<ChannelPollResult>` | Drives the poll loop until the session leaves `pending`, then hands back that terminal poll. A rejection is an outcome, not a throw: `expired`, `denied`, and `error` come back in `status`. Defaults: 10-minute budget, server-suggested interval (5s locally where the platform sends none). |
| `startFeishuSetup` / `pollFeishuSetup` / `cancelFeishuSetup` / `waitForFeishuSetup` | as above | The Feishu-only spellings, kept for callers written against 0.3.x-0.4.x. They call the four methods above with `platform: 'feishu'`. |

**Skill registry**

| Method | Returns | What it does |
|---|---|---|
| `uploadSkill(zip, opts)` | `Promise<SkillRecord>` | Creates the skill and version 1. Scope is `org` or `personal`; other values get HTTP 400. Put description in ZIP frontmatter: this create option is not forwarded. Read back on uncertain outcomes; HTTP keys do not guarantee replay. |
| `uploadSkillVersion(skillId, zip, opts?)` | `Promise<SkillVersionRecord>` | Source-reviewed version row: `skill_id`, `version`, `state`. Description override is supported here. Same-skill identical content is deduplicated; unpinned agents follow the version. |
| `listSkills(opts?)` | `Promise<SkillRecord[]>` | The registry catalog visible to your key: global skills plus your org and personal ones. `q` matches on name, `page` is 1-based, page size fixed at 100. |
| `deleteSkill(skillId)` | `Promise<void>` | Deletes a registry skill (204). No in-use guard for org and personal scopes: agents holding it simply lose it. |

**Sessions and events**

| Method | Returns | What it does |
|---|---|---|
| `createSession(agentId, input, idempotencyKey?)` | `Promise<SessionRecord>` | Opens a session. Requires a running agent, else `409 agent_not_running`. |
| `getSession(agentId, sessionId, opts?)` | `Promise<SessionRecord>` | Reads a session, optionally with the at-rest transcript. |
| `listSessions(agentId, opts?)` | `Promise<SessionRecord[]>` | One agent's sessions, newest first by `updated_at`, 50 per page, `page` 1-based. There is no cursor; each row carries `run_status` and omits `status`. |
| `archiveSession(agentId, sessionId)` | `Promise<{ session_id?: string; archived: boolean }>` | Stamps `archived_at`. Afterwards writes are `409 session_archived` while reads keep working. Interrupt an in-flight run first. |
| `deleteSession(agentId, sessionId)` | `Promise<void>` | Soft-deletes the session (204), cancelling an in-flight run first. Transcripts and events survive for audit. |
| `postEvents(agentId, sessionId, events)` | `Promise<{ events: { id?: string \| null; type?: string; accepted?: boolean; [k: string]: unknown }[] }>` | Writes user or system events into a session; accepted events echo back as full event objects. |
| `listEvents(agentId, sessionId, opts?)` | `Promise<SessionEvent[]>` | Reads the unified event log, your own inputs included. **One page per call.** |
| `listEventsPage(agentId, sessionId, opts?)` | `Promise<SessionEventPage>` | The same page WITH its `hasMore`/`nextCursor` — the hand-paging primitive. |
| `listAllEvents(agentId, sessionId, opts?)` | `Promise<SessionEvent[]>` | Every durable event, following the server's cursor. Reach for this rather than paging `listEvents` by hand. |
| `streamEvents(agentId, sessionId, opts?)` | `AsyncGenerator<SessionEvent>` | Streams durable events over SSE, resumable with `cursor`. |

**Approvals**

| Method | Returns | What it does |
|---|---|---|
| `listApprovals(agentId, opts?)` | `Promise<ApprovalRecord[]>` | Tool calls parked on a human decision. `opts.status` may only be omitted or `'pending'`, so resolved ones cannot be listed. This is the platform's separate approvals resource, not the `user.tool_confirmation` event loop; where its backend is not wired the route answers `501 not_configured`. |
| `resolveApproval(agentId, approvalId, input)` | `Promise<ApprovalRecord>` | Sends an allowed `decision` and optional `resolvedBy`. A 202 receipt with `signaled: true` can still be `pending`; it is not completed execution. Response fields are source-reviewed, not live-verified. |

**System prompt**

| Method | Returns | What it does |
|---|---|---|
| `getSystemPrompt(agentId)` | `Promise<SystemPromptInfo>` | The system-prompt pin as declared and the rendered template in effect. A fresh agent is born pinned to the active platform version; `declaration: null` marks a pre-templates agent still on virtual legacy behaviour. |
| `previewSystemPrompt(agentId, input)` | `Promise<SystemPromptPreview>` | Assembles the exact prompt for runtime facts you supply, without touching any session - deterministic, `transcript` always `[]`, one hash per template slot in `slot_hashes`. Six input fields are required, and omitting any one is a 400 naming it: `config_version` (must be the agent's current one, else `409 config_version_changed`), `now_ms`, `session_id`, `model_display`, `workspace_dir`, and `tool_names`. `channel`, `chat_type`, `session_key`, and `subagent` are optional. |
| `upgradeSystemPrompt(agentId, input)` | `Promise<SystemPromptUpgrade>` | The one write that moves the pin. `expected_config_version` is a required CAS (stale is `409 config_version_changed` - read fresh, then upgrade); omit `template_version` for the currently active platform version. The 200 receipt carries the new `config_version`. Needs a gateway from 2026-08-14 or later - older deployments answer a gateway 404 on this route's `{id}:verb` grammar. |

**Artifacts**

Artifacts are published by the agent's own in-loop `artifact_publish` tool; these methods
manage what it produced. The first artifact call on an agent costs one extra `getAgent()`,
cached per agent afterwards. An agent whose projection carries no ownership fails that
derivation with a `ZooworkError` of `status: 500` and `type: 'ownership_unavailable'` -
synthesized locally, so no server response explains it.

| Method | Returns | What it does |
|---|---|---|
| `listArtifacts(agentId, opts?)` | `Promise<ArtifactPage>` | One page (`{artifacts, page, has_more}`) - and unlike `listEvents`, `has_more` tells you when it truncated. `limit` defaults to 50, capped at 100; filter with `sessionId`, `sourcePath`, `createdBefore`. |
| `getArtifact(agentId, artifactId)` | `Promise<ArtifactRecord>` | One artifact row. Its `status` is `pending`, `ready`, `failed`, or `deleted`, and only a `ready` row carries a resolvable `url`. Foreign and unknown ids are both 404. |
| `downloadArtifact(agentId, artifactId)` | `Promise<{ artifact_id?: string; url?: string }>` | Mints a fresh access URL for a `ready` artifact. The URL is a revocable bearer capability - treat it as a secret. A row that never finalized answers `409 artifact_not_ready`. |
| `deleteArtifact(agentId, artifactId)` | `Promise<ArtifactRecord>` | Deletes one artifact and returns the row as the engine leaves it. |

**Automation: schedules and wake**

| Method | Returns | What it does |
|---|---|---|
| `listSchedules(agentId)` | `Promise<ScheduleRecord[]>` | The agent's schedules. The list answers the scheduler's own describe shape with the camelCase projection merged on top - read defensively. |
| `createSchedule(agentId, input, idempotencyKey?)` | `Promise<ScheduleRecord>` | Creates a schedule. `201` with a receipt carrying only `schedule_name`, not the definition. Schedules outlive `stopAgent()` and `deleteAgent()`; delete them yourself. |
| `getSchedule(agentId, scheduleId)` | `Promise<ScheduleRecord>` | Reads one schedule, in the camelCase read vocabulary. Nothing comes back under the name you sent it in. |
| `updateSchedule(agentId, scheduleId, update)` | `Promise<ScheduleRecord>` | Replaces the definition. To change the cadence send `schedule`, never the `scheduleSpec` a read hands you - that one answers `200` and is silently ignored. The SDK strips all six refused fields, so a read-tweak-write round trip works from JavaScript too. |
| `deleteSchedule(agentId, scheduleId)` | `Promise<void>` | Deletes a schedule. Like `updateSchedule`, it carries no cross-timeout idempotency guarantee - reconcile by listing rather than blind-retrying. |
| `triggerSchedule(agentId, scheduleId)` | `Promise<{ schedule_name?: string; triggered: boolean }>` | Fires it once, now, out of band. Does not disturb the cadence. |
| `listScheduleRuns(agentId, scheduleId, opts?)` | `Promise<ScheduleRun[]>` | Past fires, newest first. `limit` defaults to 20 and is capped at 100. Rows mix two shapes - switch on `source`. |
| `wake(agentId, input)` | `Promise<WakeResult>` | Pushes a reminder into the agent's heartbeat queue. `next-heartbeat` (the default) only writes the pending row; `now` also kicks the heartbeat schedule and is `409` when no heartbeat is enabled. A third option, `deliverToUser: false`, keeps the reminder internal to the agent's own reasoning. `WakeResult` is `{ mode, queued, triggered }`; `triggered` is meaningful only in `now` mode, and reports whether the heartbeat was actually kicked. |

`ScheduleInput` requires three fields. `schedule_id` is yours to choose, matching
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` - re-creating the same id with a *different* definition is
a `409`. `schedule` is the cadence. `payload.kind` must be `'agentTurn'`; it is the only kind
the management plane accepts.

```ts
await zc.createSchedule(agentId, {
  schedule_id: 'daily-digest',
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  payload: { kind: 'agentTurn', message: 'Summarise yesterday.' },
  sessionTarget: 'isolated',
})
```

The optional fields are `sessionTarget`, `delivery`, `enabled`, `deleteAfterRun`, and
`jobKind`. `sessionTarget` decides where the turn runs: omit it or pass `'isolated'` for a
fresh session per fire, or `session:<id>` to target an existing session of this agent. It is
**immutable** after create.

Then read it back and none of those names survive. Your `schedule_id` comes back as `name` -
that is the one you pass to `getSchedule`, `updateSchedule`, and `deleteSchedule`. The
`scheduleId` field is the fully-qualified `cron/{computer_id}/{agent_id}/{schedule_id}`, not
the id you chose. The cadence is `scheduleSpec.cronExpressions[0]`, the only place a read
carries it, and `sessionTarget` reads back as `execution.kind`.

`updateSchedule` refuses six fields, as compile errors and again by stripping them at runtime.
Two are the read shapes just described, `scheduleSpec` and `sessionTarget`. The other four -
`execution`, `originMetadata`, `contextSnapshot`, and `creatorPrincipalRef` - are server-derived
and answer `400 execution, originMetadata, creatorPrincipalRef, and contextSnapshot are
server-derived`. Every one of them is something `getSchedule()` hands you, which is why a
hand-written round trip needs the list and an SDK round trip does not.

**Exec**

| Method | Returns | What it does |
|---|---|---|
| `exec(agentId, args)` | `Promise<ExecResult>` | Runs argv - not a shell string - in the agent's sandbox, cwd fixed to `/workspace`. **A non-zero exit is still HTTP 200**: this promise resolves, so check `exit_code`. Requires an agent-scope sandbox and a rendered config: a session-scope agent is `409 exec_requires_agent_scope`, an unrendered one is `409 exec_config_not_ready`. |

The command times out after 300 seconds, and `stdout` and `stderr` are each truncated at
200,000 characters. Neither limit is reported to you as an error, so a long-running or chatty
command comes back looking like a short one.

**Environments**

| Method | Returns | What it does |
|---|---|---|
| `listEnvironments(opts?)` | `Promise<EnvironmentRecord[]>` | The Environments visible to your org, `page` 1-based. The platform default an untouched agent is pinned to is not among them. |
| `getEnvironment(environmentId)` | `Promise<EnvironmentRecord>` | Reads one Environment. `404` for anything outside your org, the platform default included - a selector mismatch, not a permission problem. |
| `createEnvironment(input, idempotencyKey?)` | `Promise<EnvironmentRecord>` | Creates an Environment and its first version. `resource.config` takes exactly `packages`, `files`, `build`, and `networking`; anything else is `400 invalid_environment_config`. |
| `archiveEnvironment(environmentId)` | `Promise<EnvironmentRecord>` | Archives it. The SDK percent-encodes the colon in `{id}:archive` for you - a raw `:` makes the engine miss the route and answer 404. |
| `createEnvironmentVersion(environmentId, config, idempotencyKey?)` | `Promise<EnvironmentVersionRecord>` | Adds an immutable version to an existing Environment. The SDK wraps your `config` as `{ resource: { config } }`, mirroring create. |
| `getEnvironmentVersion(environmentId, version, opts?)` | `Promise<EnvironmentVersionRecord>` | Reads aggregate status or optional `opts.resourceClass` (`starter`, `pro`, `ultra`). Handle `partial_ready` and enforce a deadline; see [Environments](../build/environments.md#build-states). Selector is source-reviewed, not live-verified here. |

Only the methods with a section below carry behaviour beyond their signature; the rest are
one call each. A method being on the client is not a claim that its route has been exercised -
the [capability matrix](./capabilities.md) is where that is recorded, family by
family.

All snippets below assume:

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
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
    "model": "litellm/gpt-5.6-terra",
    "display_name": "GPT-5.6 Terra",
    "family": "openai",
    "api": "openai-responses"
  }
]
```

Pass a `model` value verbatim into `resource.model.primary`. Do not hardcode the underlying
provider model name behind the alias.

---

### `createAgent(input, idempotencyKey?)`

```ts
createAgent(
  input: { resource: AgentResource; ownership?: Ownership },
  idempotencyKey?: string,
): Promise<AgentRecord>
```

| Parameter | Type | Notes |
|---|---|---|
| `input.resource` | `AgentResource` | The configuration. `name` is required. |
| `input.ownership` | `Ownership` | Omit it here. It is **required** on `createEnvironment`, where you take it from an agent record's `ownership`. |
| `idempotencyKey` | `string` | Sent as the `Idempotency-Key` header. Omitted entirely when you do not pass it. |

Returns the **create receipt**: a flat object with `agent_id`, a top-level `config_version`,
`ownership`, and `resolved_skills`. It carries no `declared` and no `status`.

```ts
const created = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary: 'litellm/gpt-5.6-terra' },
    },
  },
  'provision-research-agent-1',
)

console.log(created.agent_id, created.config_version) // "agt_...", 1
```

The new agent is **stopped**: `createSession()` before `startAgent()` is
`409 agent_not_running`. See [Quickstart](../get-started/quickstart.md).

The `config_version` on this receipt goes stale immediately - a receipt saying `1` is commonly
followed by a `getAgent()` saying `3`. See [Errors and retries](./errors.md).

---

### `listAgents(opts?)` {#listagentsopts}

::: warning SDK version and verification
This return shape is implemented in [SDK PR #26](https://github.com/SerendipityOneInc/zoowork-sdk-typescript/pull/26).
SDK 0.5.2 returns `Promise<AgentRecord[]>`; use a package release containing the pagination
change for these examples. The implementation and offline tests have been reviewed; this
is not live deployment verification.
:::

```ts
listAgents(opts?: AgentListParams): AgentPagePromise

interface AgentListParams {
  labels?: Record<string, string>
  page?: number
}
interface AgentPage extends AsyncIterable<AgentRecord> {
  readonly data: AgentRecord[]
  readonly page: number
  readonly page_size: number
  readonly total: number
  readonly next_page: number | null
  hasNextPage(): boolean
  getNextPage(): Promise<AgentPage>
  iterPages(): AsyncIterableIterator<AgentPage>
}
interface AgentPagePromise extends Promise<AgentPage>, AsyncIterable<AgentRecord> {}
```

Await the request to get one page, or use `for await` directly on it to fetch all matching
agents. The resolved page also supports async iteration and `iterPages()`.

```ts
const page = await zc.listAgents({ labels: { app: 'support' } })
console.log(page.data, page.total, page.next_page)
if (page.hasNextPage()) {
  const next = await page.getNextPage()
  console.log(next.data)
}

for await (const agent of zc.listAgents({ labels: { app: 'support' } })) {
  console.log(agent.agent_id)
}
```

`data` contains only the current page. `page`, `page_size`, and `total` come from the API;
the SDK derives `next_page`, a number or `null` at the end. Page numbers start at 1 and page
size is fixed at 100; there is no `limit` option or string cursor. `getNextPage()` preserves
label filters and rejects when there is no next page. Breaking iteration stops further
requests. HTTP errors and invalid or non-advancing pagination metadata reject the operation.
Concurrent additions or deletions can shift page contents; iteration is not a snapshot.

**Migration:** change `const agents = await zc.listAgents(opts)` to
`const { data: agents } = await zc.listAgents(opts)` for one page. Use `for await` for all
matches. See [List your agents](../build/agents.md#list-your-agents) for the full example.

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
import type { AgentRecord } from '@zoowork-ai/sdk'

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

**Sections you omit are preserved.** Plain-object sections shallow-merge one level; arrays
and scalars replace. For example, with existing labels `{ tier: 'free', region: 'apac' }`:

```ts
const updated = await zc.updateAgent(agentId, { labels: { tier: 'paid' } })

console.log(updated.declared?.name)   // unchanged - `name` was not in the body
console.log(updated.declared?.labels) // { tier: 'paid', region: 'apac' } - omitted key preserved
```

`tool_policy` and `system_prompt` are the exceptions even to that: every PUT naming one
replaces it wholesale. See [Tools](../build/tools.md).

**Every successful PUT bumps `config_version`, including one whose body is byte-identical to
what is stored.** See [Errors and retries](./errors.md).

`skills`, `credentials`, and unknown fields in the PUT body return `400`.

---

### `deleteAgent(agentId)`

```ts
deleteAgent(agentId: string): Promise<void>
```

Soft-deletes the agent and resolves with nothing. Repeated calls succeed. After deletion,
`getAgent()` returns `404 not_found`.

It does **not** stop the agent, cancel running workflows, delete schedules, or release the
sandbox - stop first, then delete. See [Agents](../build/agents.md).

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

Successful responses can contain warnings; they are not guaranteed on every call.
HTTP failures still throw. Do not treat a rejected call as a warning-only success.
See [Agents](../build/agents.md).

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
it throws a `ZooworkError` with `status: 408` and `type: 'timeout'`; on abort, `status: 0` and
`type: 'aborted'`. **Both are synthesized locally** - the server never sends either, and the
abort does not leak a `DOMException`.

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

Source-reviewed stop behavior can fail after desired state changes. Read back and reconcile
before retrying; `desired_state: 'stopped'` alone does not prove cleanup completed.

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

console.log(session.session_id)  // "0123456789abcdef0123456789abcdef"
console.log(session.session_key) // "api:0123456789abcdef0123456789abcdef"
console.log(session.status)      // "running"
```

`session_id` is opaque. Do not require a resource prefix; `api:` belongs to `session_key`.
The create receipt has `status: "running"` and no `run_status`. Read `run_status` from a later
`getSession()` call or from a `listSessions()` row when you need the latest run state.

The agent must be running. Against a stopped agent this throws
`ZooworkError` with `status: 409` and `type: 'agent_not_running'`.

Derive the idempotency key from something stable in your own system, never from a value
generated at call time. See [Errors and retries](./errors.md).

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
import { messageText } from '@zoowork-ai/sdk'

const s = await zc.getSession(agentId, sessionId, { history: true, limit: 20 })

console.log(s.run_status)  // 'succeeded'  <- the live field
console.log(s.status)      // null         <- observed on the current public read path

for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  console.log(row.seq, messageText(row.entry.message))
}
```

---

### `postEvents(agentId, sessionId, events)`

```ts
postEvents(
  agentId: string,
  sessionId: string,
  events: OutboundEvent[],
): Promise<{ events: { id?: string | null; type?: string; accepted?: boolean; [k: string]: unknown }[] }>
```

Writes events into an existing session. Responds `202` with one entry per event, unwrapped
from the wire envelope; an absent list becomes `[]`. An accepted event comes back as the full
event object the history will show (with its `seq`); an unaccepted one stays a
`{ id, type, accepted: false }` receipt.

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

**`system.message` reaches the model on the following turn**, out of band, and carries its
body in `text` rather than `content`. See [Events](../build/events.md).

Give each event an `idempotency_key` (any stable string) and a `postEvents` retried after a
timeout will not deliver it twice.

---

### `listEvents(agentId, sessionId, opts?)`

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.cursor` | `string` | Page cursor — a previous page's `next_cursor` or a streamed event's `cursor`. |
| `opts.after` | `number` | Seq cursor for the deprecated engine-only lane (no user inputs). Old stored cursors only. |
| `opts.types` | `string[]` | Server-side filter, joined with commas onto `?types=`. |
| `opts.limit` | `number` | Server default 100, maximum 500. |

Every entry is passed through `normalizeEvent()`, so REST and SSE hand you the identical
`SessionEvent` shape.

```ts
const events = await zc.listEvents(agentId, sessionId, { types: ['user.message', 'agent.assistant'] })
```

::: warning One page per call
The server returns 100 events by default and at most 500, and `listEvents` returns exactly
one page — dropping the page's pagination fields. `listEventsPage` is the same call keeping
them:

```ts
listEventsPage(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; types?: string[]; limit?: number },
): Promise<{ events: SessionEvent[]; hasMore?: boolean; nextCursor?: string | null }>
```

Feed `nextCursor` back as `cursor` to page by hand; unless you are, use `listAllEvents`.
:::

`listAllEvents` follows the server's `next_cursor` until `has_more` is false, and falls back
to walking `after` on servers without cursor pagination:

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
| `opts.after` | `number` | Forces the deprecated engine-only lane and walks it from this seq. |
| `opts.types` | `string[]` | Same server-side filter as `listEvents`, applied to every page. |
| `opts.pageSize` | `number` | The per-request `limit`. Defaults to 500 and is clamped to it. |

Events come back in ascending `seq`. Guards a hand-rolled loop usually lacks: both lanes stop
(without re-appending) when the cursor fails to advance, so a misbehaving server costs one
extra request instead of a spin; and on the fallback walk, events at or below the cursor are
dropped, so a boundary event replayed at a page edge does not reach you twice.

---

### `streamEvents(agentId, sessionId, opts?)`

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

| Parameter | Type | Notes |
|---|---|---|
| `opts.cursor` | `string` | Resume token — a previous event's `cursor`. The server replays from right after it. |
| `opts.after` | `number` | Resume for the deprecated engine-only lane. Old stored cursors only. |
| `opts.signal` | `AbortSignal` | Aborts the underlying request. When the signal is already aborted the generator returns quietly instead of throwing. |

An async generator of `SessionEvent`. Consume it with `for await`.

```ts
import { assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let cursor: string | undefined
let outcome: string | undefined

for await (const ev of zc.streamEvents(agentId, sessionId, { signal: ctl.signal })) {
  cursor = ev.cursor ?? cursor
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

- **The stream is session-scoped and does not close when a turn ends.** Break out yourself
  with `isRunFinished`, and always abort the controller when you leave the loop.
- **The server closes the stream on idle.** Reconnect with
  `streamEvents(agentId, sessionId, { cursor: lastCursor })`, tracking `lastCursor` from each
  event's `cursor`. Resume is server-side, so nothing between the two windows is lost. The SDK
  does not reconnect for you.
- **`chat.delta` preview frames are skipped.** They arrive as SSE `event_delta` frames on a
  separate non-durable lane with snapshot-replace semantics, and the SDK drops them. You only
  ever see durable events.
- **Boundary events are de-duplicated.** Each frame's durable `seq` comes from the JSON body,
  falling back to the SSE `id:` line, and the generator discards any event that carries a
  non-negative `seq` no greater than the last one it yielded, so a replayed boundary event on
  reconnect does not reach you twice. A frame that normalizes to `seq: -1` carries no usable
  cursor and is passed through rather than dropped.

A non-2xx stream-open response uses the same `ZooworkError` parser as other calls.
Structured responses can provide `type` and `requestId`; `contentType`, `bodySnippet`,
`cfRay` and `retryable` provide context when present. HTML failures may have no type.
Match status and an available type; never assume every stream failure lacks one.

## Source-reviewed contract details

These additions are reflected in SDK types and offline tests, not new live recordings:

- `OutboundEvent.actor`: `{ ref: string }` for API-session user messages. See the identity and
  isolation limits in [Events](../build/events.md#usermessage).
- Interval cadence: `{ kind: 'every', everyMs: 60_000, anchorMs: 0 }`. The obsolete `every`
  field is not converted; migrate explicitly. `ScheduleRun.session_id` is optional.
- `SkillVersionRecord`: `skill_id: string`, `version: string | number`, `state: string`.
  Do not read the create record's `latest_version/status` from a version upload.
- `SessionRecord.run_status` can be null, and `pending_approvals` is an optional count.
- `ApprovalRecord`: optional `requested_at`, `arguments_preview`, `allowed_decisions`,
  `timeout_at`, `resolved_by`, `resolved_at`, `signaled` and `decision`. Legacy
  `created_at` remains type-compatible but is not promised on current responses.
- Environment builds include `partial_ready`; use bounded polling and, if needed, the
  existing GET's optional `resourceClass`. Configuration creation and build retry differ.

## Types

Most response types end with `[k: string]: unknown`. The API is Developer Preview and may add
fields within a version: ignore what you do not recognize rather than failing on it.

The ones that do not are closed on purpose - `SessionEvent`, `SessionHistoryEntry`,
`ToolCall`, `ExecResult`, `WakeResult`, `Ownership`, `EnvironmentConfig`, `AgentResource`,
`OutcomeConfig`, `OutcomeEvaluator`, `SystemPromptDeclaration`, `SSEMessage`, `ZooworkConfig`,
`ZooworkAuth`, `AddChannelInput`, `UpdateChannelInput`, and `ChannelSetupInput` take no extra
keys, and an extra key on them is a compile error rather than a field that survives to the
wire.

The sections here cover the types you handle on the paths this page walks. The skill-registry,
approval, schedule, wake, exec, and Environment types are all in the
[complete export list](#complete-export-list), and each carries its field-level traps in the
JSDoc your editor shows on hover - `ScheduleRecord` and `ScheduleUpdate` especially, because
the write shape and the read shape of a schedule are different documents.

### `SessionEvent`

```ts
interface SessionEvent {
  cursor?: string
  id?: string
  processedAt?: string | null
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
| `seq` | Durable sequence; not the recommended resume token. Resume SSE with its opaque `cursor`. `after` is the legacy engine-only lane. `-1` means no usable sequence was supplied. |
| `cursor` | Opaque SSE resume token. Pass it unchanged as `{ cursor }`; do not derive it from `seq`. |
| `eventType` | One of `SESSION_EVENT_TYPES`, or an unknown string that passed through. `''` if the wire carried no type at all. |
| `payload` | The event body. Shape varies by type; use the helpers below rather than reaching in blind. |
| `runId` | The run this event belongs to. |
| `turn` | Turn number within the session. |
| `createdAt` | ISO timestamp. |

`SessionEvent` is camelCase while `SessionRecord` and `AgentRecord` next to it are
snake_case - that is the wire, not a typo, so do not "fix" `eventType` into `event_type`.
The default unified REST/SSE wire uses snake_case on both transports; the legacy SSE lane
uses camelCase. `normalizeEvent()` gives callers one SDK shape. See [Events](../build/events.md).

### `AgentRecord`

```ts
interface AgentRecord {
  agent_id: string
  computer_id?: string
  config_version?: number
  declared?: Record<string, unknown>
  resolved_skills?: { skill_id: string; name?: string; version?: number | string; eligible?: boolean }[]
  resolved_environment?: {
    environment_id?: string
    version?: number
    provider?: string
    template_ref?: string
    build_id?: string
    networking?: { type?: 'unrestricted' | 'limited' | string; allowed_hosts?: string[] }
    [k: string]: unknown
  }
  environment_locked?: boolean
  environment_locked_at?: string | null
  status?: AgentStatus
  ownership?: Ownership
  [k: string]: unknown
}
```

`environment_locked` is the one pre-flight check on this record worth reading. It flips to
`true` the first time a sandbox is created, and from then on every attempt to change the
agent's Environment is `409 environment_locked` - stopping the agent does not clear it.
`environment_locked_at` is when it flipped. `resolved_environment` is the Environment version
the agent is actually pinned to; its `networking` defaults to `{ type: 'unrestricted' }` when
the Environment declares none.

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
`desired_state` is the one that gates the API: `running` is the precondition for
`createSession()` and `postEvents()`, and anything else is `409 agent_not_running`.

`actual_state` is a best-effort chat-channel health projection, not API readiness. A GET can
report `active` with zero channel counts and a health-unverified `status_message` when
route-status is unsupported; a transient lookup failure remains `activating`, and list and GET
can briefly disagree. `running` is not even a member of its enum, so a loop polling for it never
returns. Poll `status.desired_state`. See [Agents](../build/agents.md).
:::

`config_version` here is the authoritative version on the read path.

### `AgentResource`

```ts
interface AgentResource {
  name: string
  model?: { primary: string; input?: string[]; max_tokens?: number }
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
}
```

The configuration you send to `createAgent()`. `name` is the only required field. `mcp`
declares remote MCP servers. `system_prompt` pins a template
version (omitted on create means "the platform version active right now", pinned from then
on; replace-on-write on PUT like `tool_policy`), and `outcome` is the agent-level default
gate for unattended cron fires.

Omitting `model` pins the platform defaults current at creation time. The source default is
currently `litellm/gpt-5.6-terra`, but deployments may differ and defaults can rotate. For
deterministic provisioning, call `listModels()` and set `primary` explicitly.

**`AgentResource` is closed.** It carries no index signature, so one extra key is a
TypeScript error rather than a field that reaches the server. A field a newer server accepts
has to reach it through `updateAgent(agentId, sections)`, which is typed
`Record<string, unknown>` and checks nothing.

`skills` at create time works but is echoed by no read surface - confirm the install with
`listAgentSkills()`, not the create receipt. See
[Agents](../build/agents.md) for the field-by-field notes.

### `McpServerDeclaration`

```ts
interface McpServerDeclaration {
  name: string
  url: string
  transport?: 'streamable-http' | 'sse'
  credential?: string
  toolFilter?: string[]
  exposure?: 'deferred' | 'direct'
  [k: string]: unknown
}
```

Omitted `exposure` defaults to `deferred`: tools stay behind `tool_search` / `tool_describe`
until loaded. `direct` declares them on the first model request. There is no `auto` value, and
a loaded deferred tool remains available on later turns in the same Session. Public API keys
still cannot populate `credential`; use public, unauthenticated MCP servers only. See
[Tools](../build/tools.md).

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
  run_status?: string | null
  pending_approvals?: number
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

The fields vary by response surface: `createSession()` returns `status: "running"` and no
`run_status`; the current public `getSession()` path returns `status: null` alongside
`run_status`; `listSessions()` rows carry `run_status` and omit `status`. The legacy `status`
field may differ across deployments and is not the run outcome. Use `run_status` for the latest
run state.
`session_key` is channel-qualified: sessions you create through
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
  actor?: { ref: string; token?: never }
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
metadata; `api` is the protocol face (`anthropic-messages`, `openai-completions`, or
`openai-responses`). Preserve unknown future values.

### `Ownership`

```ts
interface Ownership {
  owner_uid: string
  org_id: string
}
```

A persistence anchor, not an auth claim. Omit it on `createAgent()`, and read the two values
back from `created.ownership`. `createEnvironment()` is the call that **requires** it: pass
the pair you read off an agent record.

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

One tool call produces a sequence of events sharing a `toolCallId`, one per phase: `start`
carries `args`, `end` carries `isError` and `resultPreview`, and `blocked` means the call is
parked on an approval and has **not** run. Pair them by `toolCallId` - they are **not
adjacent** in the stream when calls run concurrently. A tool failing does not fail the run:
`isError: true` is still followed by `run.finished` with `succeeded`. See
[Events](../build/events.md).

### Config types

`ZooworkConfig`, `ZooworkAuth`, and `ZooworkClient` are covered under
[`createZooworkClient`](#createzooworkclient-config). `ZooworkClient` is exported as a type so
you can pass a client into your own helpers:

```ts
import type { ZooworkClient } from '@zoowork-ai/sdk'

async function reply(zc: ZooworkClient, agentId: string, text: string) { /* ... */ }
```

### `ZooworkError`

```ts
class ZooworkError extends Error {
  status: number
  type?: string
  contentType?: string
  bodySnippet?: string
  cfRay?: string
  requestId?: string
  retryable: boolean
}
```

Thrown by every method on a non-2xx response. Match on `error.type`, never on the message.
See [Errors and retries](./errors.md) for the full treatment.

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
unconditionally. See [Events](../build/events.md).

### `messageText(message)`

Assistant text lives at `payload.message.content[]`, and `content` is normally an array of
blocks where **only `{ type: 'text', text }` blocks carry text** - thinking and tool-call
blocks do not, and one message may hold several text blocks. A plain string is accepted too,
which is how write-side `user.message` content comes back.

`messageText` handles both, which makes it the right tool for transcript rows as well as
events:

```ts
import { messageText } from '@zoowork-ai/sdk'

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

Accepts either wire shape and never throws. `sseId` is the SSE `id:` line; only a numeric legacy ID can be a `seq`
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
import { SESSION_EVENT_TYPES, type SessionEventType } from '@zoowork-ai/sdk'

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
import { parseSSE, normalizeEvent } from '@zoowork-ai/sdk'

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
  createZooworkClient,
  DEFAULT_BASE_URL,
  ZooworkError,
  type ZooworkClient,
  type ZooworkConfig,
  type ZooworkAuth,

  // resource types
  type Ownership,
  type ModelInfo,
  type AgentResource,
  type AgentRecord,
  type AgentListParams,
  type AgentPage,
  type AgentPagePromise,
  type AgentStatus,
  type AgentSkill,

  // channels
  type AgentChannel,
  type ChannelPlatform,
  type AddChannelPlatform,
  type GuidedSetupPlatform,
  type AddChannelInput,
  type UpdateChannelInput,
  type ChannelSetupInput,
  type ChannelSetupSession,
  type ChannelPollResult,
  type FeishuSetupInput,
  type FeishuSetupSession,
  type FeishuPollResult,

  // more resource types
  type McpServerDeclaration,
  type SkillRecord,
  type SkillVersionRecord,
  type SessionRecord,
  type SessionHistoryEntry,
  type SessionEvent,
  type SessionEventPage,
  type OutboundEvent,
  type PostEventReceipt,

  // approvals
  type ApprovalDecision,
  type ApprovalRecord,

  // system prompt
  type SystemPromptDeclaration,
  type SystemPromptInfo,
  type SystemPromptPreview,
  type SystemPromptPreviewInput,
  type SystemPromptUpgrade,

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
  PUBLIC_INPUT_EVENT_TYPES,
  type PublicInputEventType,
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
} from '@zoowork-ai/sdk'
```

Thirteen values and fifty-eight types, pinned by a test that asserts the entry point's exports as
a set - a missing symbol and an accidental extra one both fail it. `DEFAULT_BASE_URL` is the
public gateway base that `ZOOWORK_BASE_URL` and the `baseUrl` option override; it is exported
so you can compare against it or build a URL by hand.

That is the entire public surface. Anything not on this list does not exist - in particular
there is no `patchSession`: `PATCH /agents/{id}/sessions/{sid}` answers `405`, and a session's
`metadata` is write-once at `createSession()`. See
[Not supported](./not-supported.md).

## Next

- [Errors and retries](./errors.md) - the `ZooworkError.type` values worth branching on.
- [Agents](../build/agents.md) - create, start, update, and the two response shapes.
- [Sessions](../build/sessions.md) - drive a turn, page the event log, read the transcript.
