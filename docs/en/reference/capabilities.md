---
description: Check which managed-agent capabilities are verified, unverified, or unavailable.
---

# Capability matrix

What works, what exists but has never been driven, and what is absent. One row per
capability, with the caveat that matters in the note column.

Read this page before you commit to an architecture. The gaps are not evenly distributed:
the agent-session-event core is solid and exercised, while several resources around it are
routes we have read but not run.

## Verification levels

| Level | Meaning |
|---|---|
| **Verified** | We ran it against a live deployment and observed the result. |
| **Available, not verified** | The route exists and its contract is documented, but we have not driven it. It may behave exactly as described. Treat it as work you still have to do, and keep it off your demo path. |
| **Not available** | It does not exist. [Not supported](./not-supported.md) says what to do instead. |

Everything marked **Verified** was observed on a live deployment with an org API key — the
same path your key takes — on 2026-08-06, with the newer surfaces (system prompt, artifacts,
outcome) on 2026-08-14 and the built-in skill credential path on 2026-08-16.

## Agents

| Capability | Status | Note |
|---|---|---|
| `listModels()` | Verified | Returns the model alias catalog your organization can select — the cheapest liveness check for a key. Submit the alias (`litellm/...`), never a provider model name. |
| `createAgent()` | Verified | Returns a **flat create receipt** with a top-level `config_version`. |
| `Idempotency-Key` on agent create | Available, not verified | The header is accepted and the create succeeds with it. We have never replayed one with the same key to observe the dedupe, so do not assume a retry is free. |
| `getAgent()` | Verified | Returns a **different shape** from create: configuration under `declared`, version at `status.config_version`, and no top-level `config_version` or `name`. Read the version as `agent.status?.config_version ?? agent.config_version`. |
| `startAgent()` | Verified | Required. A new agent is `stopped`. `desired_state` flips to `running` in well under a second. The returned `channel_routes_reload_failed` warning is normal noise for an API-only agent, not a failure. |
| `stopAgent()` | Verified | Sub-second. Afterwards `createSession()` returns `409 agent_not_running`. |
| Gate readiness on `status.desired_state` | Verified | The only correct readiness signal. Poll until it is `running`. |
| Gate readiness on `status.actual_state` | Not available | `actual_state` reports chat-channel connectivity, not API readiness. An agent with no channels stays at `activating` forever and `active` is unreachable; once a [channel](../build/channels.md) is bound it reports that channel's health — either way, `running` is not even a member of its enum, so a loop waiting for it never returns. |
| `updateAgent()` | Verified | Merges **per section**. Sections you omit are preserved: a PUT carrying only `labels` leaves `name`, `model`, and `persona` intact. |
| `tool_policy` / `system_prompt` replacement | Available, not verified | The two exceptions to the merge rule: every PUT replaces each of these sections wholesale. `{}` restores the full tool manifest. We have only exercised the merge behaviour on other sections. |
| `system_prompt` pin | Verified | A fresh create pins the platform template version active at that moment — `{source:'platform',version:1}` observed on 2026-08-14 — and the pin never follows a later platform activation on its own. `{source:'custom',base_version,template}` replaces the whole template (all 13 functional slots exactly once, 64 KiB cap). Moving the pin is one explicit call — the row below. |
| `getSystemPrompt()` / `previewSystemPrompt()` | Verified | The declaration plus the rendered template in effect; and deterministic assembly of the exact prompt for runtime facts you supply — 13 `slot_hashes`, `transcript` always `[]`, and a stale `config_version` answers `409 config_version_changed`. Verified 2026-08-14. |
| `upgradeSystemPrompt()` | Verified | Moves the pin to the active platform version (or a specific one via `template_version`). `expected_config_version` is a real CAS: stale answers `409 config_version_changed`, and the 200 receipt carries the NEW `config_version` — an upgrade is a config write like any other. Verified 2026-08-14; an older gateway deployment answers a gateway 404 on this one call. |
| `config_version` as an idempotency receipt | Not available | Every successful PUT increments it, including a PUT with identical values, and writes you did not make increment it too. It is a change counter, not a content hash. See [Errors and retries](./errors.md). |
| `deleteAgent()` | Verified | A soft delete. It does not stop the agent, does not remove its schedules, and does not release its sandbox. Call `stopAgent()` first, and remove schedules yourself. |
| Listing agents | Available, not verified | `listAgents(opts?)` calls it. The wire route takes `owner_uid` plus `org_id` as an exact AND selector, so an agent created by a different key in your organization can be fetched by id but never appears in your list; keep your own record of those ids. `labels` filters on declared labels and `page` is 1-based, with the page size fixed at 100. `{ labels: { workspace_id: '...' } }` resolves a chat-URL workspace id to its agent. |
| Agent id from another organization | Verified | Returns **404**, not 403. Existence is hidden, so 404 does not mean "deleted". |
| Invalid or missing key | Verified | `401` with `error.type` of `service_token.invalid`. Match on `ZooworkError.status` and `.type`, never on message text. |
| `persona.docs[]` | Available, not verified | Only entries with inline `content` are stored. `MEMORY.md` and any `memory/` name are rejected with `400 invalid_persona_doc_name`. Documents outside the canonical name set are saved but are not assembled into the prompt. |
| `environment_id` / `environment_version` pin | Available, not verified | Accepted at the top level of `resource` on create and in the PUT body. Supplying only a version is a `400`. |
| Agent version history, pinning, rollback | Not available | No route lists or fetches a previous `config_version`, and nothing pins a session to one. |
| A credential API | Not available | The platform seeds model credentials itself when the agent is created; keep your own secrets in your own service. |

## Sessions

| Capability | Status | Note |
|---|---|---|
| `createSession(agentId, input)` | Verified | A session is a **sub-resource of an agent**: `POST /agents/{id}/sessions`. |
| `initial_events` with `user.message` | Verified | Only `user.message` is accepted here, up to 50 entries. |
| `Idempotency-Key` on session create | Verified | Honoured. Safe to retry a create with the same key. |
| `409 agent_not_running` | Verified | Stable and matchable on `error.type`. This is what you get if you skip `startAgent()`. |
| `getSession()` | Verified | `status` comes back as `null` on this path; the run state lives in `run_status`. |
| `getSession({ history: true, limit })` | Verified | `history[]` rows are `{ seq, entry_type, entry, created_at }`. For `entry_type: 'message'`, the text is at `entry.message`. This is the only place you can see token usage and the model that actually answered. |
| Session `metadata` on create | Available, not verified | Accepted at create time; we have not asserted that it reads back unchanged. |
| Listing sessions under one agent | Available, not verified | A paginated route exists (fixed 50 per page, newest first). `listSessions(agentId, { page })` calls it; `page` is 1-based and there is no cursor. |
| Archive and soft-delete a session | Available, not verified | `archiveSession()` stamps `archived_at`: afterwards writes answer `409 session_archived` while reads keep working, so interrupt an in-flight run first. `deleteSession()` is a soft delete (`204`) that cancels an in-flight run and leaves transcripts and events for audit. There is no `patchSession`: `PATCH` on a session answers `405` through the gateway, so `metadata` is write-once at create. |
| Listing sessions across all agents | Not available | There is no top-level session collection. |
| `resources[]`, file mounts, `vault_ids`, `agent_with_overrides` | Not available | `createSession` takes `initial_events` and `metadata`. Nothing else. |

## Events and streaming

| Capability | Status | Note |
|---|---|---|
| `postEvents()` with `user.message` | Verified | Multi-turn works: the agent recalls earlier turns in the same session. |
| `user.interrupt` against a live run | Verified | Returns `accepted: true` and the run ends with `run.finished` carrying `status: 'aborted'`. It took roughly 20 seconds to take effect in our run, so do not expect an instant stop. |
| `user.interrupt` with no run in flight | Verified | `202` with `accepted: false`. That is a no-op, not an error. Do not treat it as a failure. |
| `system.message` | Verified | Accepted, and the model has it in context on the **following** turn. An out-of-band injection channel — state your application owns, pushed in without appearing as a user turn. |
| `user.tool_confirmation` | Available, not verified | Accepted as a write-side type. The documented body is `{ type, approval_id, decision }` where `decision` is `allow-once`, `allow-always`, or `deny`; other shapes are rejected. We have never produced a real pending approval, so the round trip is unproven. |
| Any other write-side event type | Not available | The write surface is exactly four types: `user.message`, `user.interrupt`, `user.tool_confirmation`, `system.message`. |
| `listEvents()` | Verified | Server default 100, maximum 500, **one page per call**. A long session truncates silently with no error. `listAllEvents()` walks the pages for you. |
| `types` filter on `listEvents()` | Verified | `?types=agent.assistant` narrows the result as expected. |
| `streamEvents()` (SSE) | Verified | The stream is **session-scoped**: it does not close when a turn ends. Detect the end of a turn with `isRunFinished`. The server closes the connection when the session goes idle. |
| Resume a dropped stream | Verified | The server replays server-side, so a reconnect costs you nothing and needs no client-side de-duplication pass. Send the last frame's `id:` value back — it is an opaque resume token, surfaced by the SDK as `ev.cursor` and passed as `{ cursor }` (`?cursor=` or `Last-Event-ID` over raw HTTP). `?after=<seq>` also replays, but selects the deprecated engine-only lane, which omits your own input events. |
| `?deltas=` incremental preview | Available, not verified | **Snapshot-replace** semantics, not prefix append: each frame is the whole text so far. Concatenating them duplicates text. Returns `501 not_configured` where the delta lane is not wired. The SDK skips these frames. |
| `run.finished` as the end of a turn | Verified | `payload.status` is `succeeded`, `failed`, or `aborted`. |
| `agent.tool` phases `start` and `end` | Verified | One call emits one event per phase, all sharing a `toolCallId`, and they are not adjacent when calls run concurrently — pair by id, never by position. |
| `agent.tool` phase `blocked` | Available, not verified | A third phase meaning the call is waiting on an approval and has not run. Treat it as pending, never as an end. |
| A failing tool does not fail the run | Verified | `agent.tool` with `isError: true` is still followed by `run.finished` with `succeeded`. Never infer turn success from the absence of tool errors. |
| `agent.approval` | Available, not verified | In the event vocabulary. We have not observed one. |
| Two wire spellings for one event | Verified | REST answers snake_case and SSE answers camelCase, neither carries a top-level `type`, and the SDK normalizes both into one `SessionEvent`. |
| Full event vocabulary | Available, not verified | A normal turn produces `run.started`, `agent.lifecycle`, `agent.item`, `agent.thinking`, `agent.assistant`, `agent.tool`, `run.finished`, all observed. The remaining members of `SESSION_EVENT_TYPES` are declared by the contract and we have not seen every one. Unknown types pass through the SDK rather than throwing. |
| `session.status_*`, `span.*`, `stop_reason` | Not available | Not in the vocabulary. The `status_idle` plus `stop_reason.type === 'requires_action'` programming model has no counterpart here; use `run.finished`. |
| Push delivery of events to your server | Not available | See [Not supported](./not-supported.md). Hold the stream or poll with `after`. |

## Channels

Verified 2026-08-28, on a deployment carrying the channels release. The family is still
rolling out; a deployment without it answers 404 in the engine-passthrough envelope
(`{"error":{"type":"not_found"}}`), which is how you tell that case apart.
See [Channels](../build/channels.md).

| Surface | Status | Notes |
|---|---|---|
| Platforms you can bind | Verified | `feishu`, `slack`, `wecom` bind through `addChannel`; `feishu`, `wecom`, `weixin` bind through the QR flow. `weixin`/`wechat` on `addChannel` answer `400 channel.weixin_setup_required` — the QR flow it points at exists, so follow it. Anything else answers `400 channel.invalid_request`. |
| `dm_policy: 'pairing'` | Not available | `400 channel.pairing_unsupported` on both create and update. |
| `listChannels()` | Verified | `{ channels: [] }` for a pure API agent. |
| `addChannel()` | Verified | Answers `201` — but **credentials are not validated at bind time**. Bogus ones returned `201` with `health: 'unknown'` / `status: 'configured'`, then listed as `health: 'unhealthy'` / `status: 'error'`. Read the verdict from a follow-up list, never from the 201. `allow_from` is write-once at create. Re-posting an identical body replays the same `201`, but the same `platform` + `account` with a **different** `config` answers `409 channel.conflict` — rotating credentials means remove-then-add. |
| `updateChannel()` | Verified | Returns the channel in its new state. `enabled: false` also moves `status` to `'disabled'` and resets `health` to `'unknown'`. `404 channel.not_found` when that platform has no binding. |
| `removeChannel()` | Verified | `{ ok: true }`, and the channel is gone from the next list. |
| QR flow — `startChannelSetup()` / `pollChannelSetup()` / `cancelChannelSetup()` | Verified | On all three guided platforms. Feishu: `verification_uri_complete`, `expires_in: 600`, `poll_interval: 5`, and `brand: 'lark'` really switches the URI host to `open.larksuite.com`. WeCom and WeChat: `qrcode_url`, `expires_in: 300`, no `poll_interval`. A cancelled session answers `404 channel.{platform}_session_not_found` on the next poll. |
| WeChat setup body | Verified | `dm_policy` only, and only `'open'`/`'disabled'` — `'allowlist'` answers `400 channel.allowlist_unsupported`. The account is pinned to `'default'`, the group policy to `'disabled'`, and anything else in the body is ignored rather than rejected. |
| `waitForChannelSetup()` | Verified | Drives the loop at the server's interval and returns body-reported terminal statuses. A session that stopped existing throws instead — see the caveat on the Channels page. The Feishu-only spellings (`startFeishuSetup()` etc.) still work and call these. |
| A scanned-to-completion binding | Available, not verified | Every route was exercised, but no run has taken a real person through the QR approval, so `status: 'success'` and a healthy channel are unobserved. |
| Channel cleanup on `deleteAgent()` | Available, not verified | A successful delete best-effort disables the agent's channels; a cleanup failure never turns the delete into an error. Confirmed only that the channels routes answer `404 service_api.not_found` once the agent is deleted. |

## Tools

| Capability | Status | Note |
|---|---|---|
| Built-in tools available to the model | Verified | A normal turn produces paired `agent.tool` events. The exact tool names arrive on those events at runtime; there is no published catalog route to enumerate them first. |
| `tool_policy` allow and deny | Available, not verified | `{}` means the full manifest. A non-empty object is read as an allow/deny policy that narrows the surface. We have not exercised a narrowed policy, so confirm your policy took effect by watching which tools appear in `agent.tool`. |
| Client-executed custom tools | Not available | There is no custom tool type and no `user.custom_tool_result` event. This is the largest single gap. [Read the alternatives](./not-supported.md#client-executed-custom-tools) before designing around it. |
| Remote HTTP MCP server | Verified | Declared on the agent (`resource.mcp[]`), not as its own resource; transports are `streamable-http` (the default) and `sse`. Tools appear in the model's manifest as `mcp__<server>__<tool>` — the server name must not contain an underscore — and really execute against a public server. The catalog pins per `config_version`; a failed probe pins an empty catalog and emits `agent.error` with `kind: 'mcp_connection_failed'` rather than failing the run. This is the only route by which your own code can back an agent tool, and it works **unauthenticated only**: the `credential` slug is accepted but the store behind it answers 404 through the gateway, so a server that needs auth cannot be made to work today. |
| stdio MCP servers, MCP OAuth | Not available | Remote HTTP is the whole of it. |
| Approval-gated tool execution, end to end | Not available | The pieces exist in the vocabulary; the closed loop is unproven. `listApprovals()` and `resolveApproval()` drive a REST resource, not the `user.tool_confirmation` event loop, and where that backend is not wired they answer `501 not_configured`. A run parked on an approval burns its whole turn budget waiting. See [Not supported](./not-supported.md#end-to-end-human-approval). |
| `POST /agents/{id}/exec` | Available, not verified | An operations extension that runs a command in the agent's sandbox, not a path for agent tool use. `exec(agentId, args)` calls it, and `args` is argv: use `['bash', '-lc', 'pwd']` for shell semantics. Requires an agent-scope sandbox: session-scoped agents get `409 exec_requires_agent_scope`, and a deployment with no sandbox backend gets `501 not_configured`. |

## Skills

| Capability | Status | Note |
|---|---|---|
| `listAgentSkills()` | Verified | A brand new agent already has the **entire global catalog attached**, including docx, pptx, xlsx, and pdf. You do not install these; they are there from creation. |
| Built-in skills that call platform services (speech, video, third-party connectors) | Verified | Zero setup on API-created agents: the platform injects the service credentials these skills need into the sandbox when it is created. There is no credential step on your side — and no way to add your own; see [Not supported](./not-supported.md). |
| Reading the skill catalog | Verified | `listSkills({ scope, q, page })` reads it. The catalog route answers 200. Every entry we saw had `scope: global`. `q` matches on name; `page` is 1-based with a fixed page size of 100. |
| `putAgentSkill()` on a global-catalog skill | Not available | Returns `404` through the gateway. The install route is only meaningful for skills your own tenant uploaded. Since global skills are attached at creation, this is mostly "you already have them, and you cannot manage them" rather than "you cannot use them". |
| `putAgentSkill()` on an `org` skill | Verified | Install and read-back both work: the skill comes back from `listAgentSkills()` with `eligible: true`, and the next turn answers from its own content. |
| `putAgentSkill()` on a `personal` skill, `deleteAgentSkill()` | Available, not verified | The gateway forwards both scopes. Confirm a removal with `listAgentSkills()` rather than trusting the returned `config_version`. |
| Uploading your own skill | Available, not verified | A multipart create takes a single `.zip` plus a scope of `org` or `personal`; `name` and `description` default to the `SKILL.md` frontmatter inside the archive, and an explicit `description` option overrides the frontmatter one. A `fileName` option names the uploaded part. Global scope is not writable from an org key. |
| Session-level skill selection | Not available | Skills attach to the agent. There is no per-session skill set. |

## Environments

An environment is an optional, immutable sandbox image you pin on an agent: pre-installed
packages, controlled files, a build script, and a network policy.

| Capability | Status | Note |
|---|---|---|
| Environments are reachable through the gateway | Verified | `listEnvironments()` answers `200` with an empty list. That is the whole of what we have exercised: nothing on the build path below has been run. |
| Create an environment and build a version | Available, not verified | Versions are immutable and their `status` moves `queued -> submitting -> building -> verifying -> ready`, with `failed` reachable from any build phase. Poll the version's `status`, not the environment's top-level row. |
| apt, npm, pip pre-install | Available, not verified | Installation order is fixed: apt, then npm, then pip. |
| cargo, gem, go | Not available | Three package managers, not six. |
| Network policy | Available, not verified | `unrestricted`, or `limited` with an `allowed_hosts` list of domains (a `*.` prefix covers one sub-domain level). `allowed_hosts` on `unrestricted` is a `400`. |
| Controlled files and a build script | Available, not verified | Files land under a fixed directory; executable top-level `bin/*` entries are linked onto the path. The build script runs at image build time only. |
| Direct upload for large files, build logs, retry, archive | Available, not verified | See [Environments](../build/environments.md) for the upload flow, the size caps, and how a retry behaves. |
| Environment lock | Available, not verified | An agent's environment can be changed until its first successful sandbox creation, then answers `409 environment_locked`. Stopping the agent does not unlock it. Pin deliberately the first time. |
| Secrets, runtime environment variables, sandbox start hooks | Not available | An environment is a build-time artifact. It accepts none of these. |
| Arbitrary base image inheritance | Not available | A custom environment always inherits the platform base. |
| Running tools on your own machine | Not available | See [Not supported](./not-supported.md#self-hosted-tool-execution). |

## Automation

| Capability | Status | Note |
|---|---|---|
| Schedules as an agent sub-resource | Available, not verified | List, create, replace, delete, trigger, and read runs, all under `/agents/{id}/schedules`, and all seven are on the client: `listSchedules`, `createSchedule`, `getSchedule`, `updateSchedule`, `deleteSchedule`, `triggerSchedule`, `listScheduleRuns`. Two things the types cannot fix for you. The cadence changes only through `schedule: { kind: 'cron', expr, tz }`; the `scheduleSpec` a read hands back is refused by `ScheduleUpdate` and ignored by the server. And `triggerSchedule` against a disabled schedule answers `triggered: true` while the run projection records `status: 'skipped'`. |
| `cron`, `every`, `at` | Available, not verified | Cron is a five-field expression at most, with no macros. Overlap is fixed to SKIP by the server and is not configurable. |
| An outcome gate on a cron job (`payload.outcome`) | Verified | What "done" looks like, checked inside the run: a `description`, a `command` evaluator (sandbox exit 0 = satisfied, `timeoutSec` 1–600 default 120, plus optional `cwd` and `skipIfUnchanged`, command ≤8 KiB) or a `rubric` one (LLM grader in a fresh context, `rubric.type` must be `text`, ≤32 KiB, optional `model`), `maxIterations` 1–5 defaulting to 3, and `publish: after_satisfied \| always \| never` — under the default, a result that failed evaluation is not announced. `description` is what the evaluator judges against, ≤4096 characters. A third evaluator type, `subagent`, is a reserved slot the API still rejects. Validation is write-strict at every level: an unknown key anywhere in the outcome object is a 400 naming the field. An agent-level default lives at `resource.outcome`; a job's own value overrides it and an explicit `null` opts the job out. Cron fires only. What we verified on 2026-08-14 is the **storage round trip** — accepted, stored, read back verbatim, no defaults injected; no evaluated fire has been observed yet. |
| Where the scheduler backend is not wired | Not available | Those deployments answer `501 not_configured`. Do not retry the same call. Check this before you build a product on scheduling. |
| Heartbeat | Available, not verified | Not a route: a `heartbeat` section in the agent's declared config. `AgentResource` has no `heartbeat` member, so a create cannot carry one — it reaches the agent through `updateAgent(agentId, sections)` and is reconciled on every PUT. Setting `every` to `0` pauses it and keeps run history. Reconciliation is best effort and failures are not reported back to your call. |
| Wake | Available, not verified | `wake(agentId, { text, mode })` queues a reminder for the next heartbeat turn, or triggers the heartbeat schedule immediately. Immediate mode returns `409` when no heartbeat is enabled. Pass `deliverToUser: false` to keep the reminder internal to the agent's reasoning instead of surfacing it. |
| Webhook delivery from a schedule | Not available | `delivery` accepts `none` and a typed `announce`. Webhook delivery is rejected. |
| Pause and unpause, archive, run history across schedules | Not available | Delete and recreate instead, and read runs one schedule at a time. |
| Automatic cleanup on agent delete | Not available | Schedules survive both stopping and deleting an agent. List and delete them yourself first, or they keep firing. |

## Files

| Capability | Status | Note |
|---|---|---|
| Write, read, or download a workspace file | Not available | The routes exist on the wire, but **no `ZooworkClient` method covers files** and the backend behind them is not wired. Keep files in your own store. |
| Durable storage for user files | Not available | The backend is not wired to a shared persistent workspace. Do not make this your store of record. |
| Attaching a file to a session | Not available | See [Not supported](./not-supported.md#session-file-attachment-and-repository-mounting). |
| Publishing an artifact from your own code | Not available | Publishing stays in-loop: the model's `artifact_publish` tool turns a workspace file into an immutable snapshot behind a revocable capability URL. Your process cannot create one. |
| Listing and reading published artifacts | Verified | `listArtifacts()` / `getArtifact()`. One page per call with a real `has_more` (this list, unlike `listEvents`, says when it truncated), and filters on `session_id`, `source_path`, `created_before`. The routes demand `owner_uid`+`org_id` selectors and the gateway does not inject them; the SDK derives both from the agent's own projection. Verified 2026-08-14 against an agent with no artifacts — the row shape of a populated page is still unobserved. |
| Re-resolving and deleting an artifact | Available, not verified | `downloadArtifact()` mints a fresh access URL for a `ready` artifact — treat the URL as a secret, and expect `409 artifact_not_ready` before finalization — and `deleteArtifact()` removes one. Both routes are reachable (an unknown id answers 404, hidden like every other foreign id), but neither has been driven against an artifact that actually exists. |

## Memory

| Capability | Status | Note |
|---|---|---|
| A memory store resource | Not available | No CRUD, no mount, no versioning, no optimistic concurrency, nothing to attach across agents. |
| Model-side memory tools | Available, not verified | The model may have memory tools scoped to one agent. They can be disabled at the deployment level, they are invisible over the API, and you cannot read, seed, audit, or roll them back. Do not build on state you cannot inspect. |
| Seeding memory through `persona.docs` | Not available | `MEMORY.md` and the `memory/` namespace are reserved: declaring either returns `400 invalid_persona_doc_name`. |
| Your own state, injected per turn | Verified | Keep the state in your database and push what matters in with `system.message`. The model reads it on the following turn. This is the supported way to give an agent memory you control. |

## Multi-agent

| Capability | Status | Note |
|---|---|---|
| Several agents driven from your own code | Verified | Create N agents, run their sessions, and sequence them in your own process. Every primitive involved is verified. This is the supported multi-agent pattern. |
| A declarative coordinator roster | Not available | No roster resource, no delegation configuration. |
| Session threads and `thread_*` events | Not available | Nothing in the event vocabulary corresponds to a sub-agent thread. |
| Sub-agents spawned by the model itself | Available, not verified | The model may spawn work in-session, with a nesting depth of one and a cap on concurrent children, and it can message along the parent-child edge with a `sessions_send` runtime tool — durable fire-and-forget, hop-capped, no synchronous wait, parent↔child only. All of it is model-side: you cannot configure it, address it, or observe it from the API, so do not design around it either way. |

## How to report a gap

Contact whoever issued your API key. Include the time of the request, the HTTP status and
`error.type` from the error envelope, and the smallest call that reproduces it. Say which
row of this page you were relying on: a row marked **Verified** that fails for you is a
regression and we want to know quickly, while a row marked **Available, not verified** that
fails is new information that will change this page. There is no public issue tracker or
support address for this preview, so the team that gave you the key is the route.
