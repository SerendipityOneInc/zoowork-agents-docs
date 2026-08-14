# Capability matrix

What works, what exists but has never been driven, and what is absent. One row per
capability, with the caveat that matters in the note column.

Read this page before you commit to an architecture. The gaps are not evenly distributed:
the agent-session-event core is solid and exercised, while several resources around it are
routes we have read but not run.

## Verification levels

| Level | Meaning |
|---|---|
| **Verified** | We ran it against a live deployment and observed the result. Most of these rows come from a replayable probe that creates a throwaway agent, walks its whole lifecycle, and deletes it again. |
| **Available, not verified** | The route exists and its contract is documented, but we have not driven it. It may behave exactly as described. Treat it as work you still have to do, and keep it off your demo path. |
| **Not available** | It does not exist. [Not supported](/en/reference/not-supported) says what to do instead. |

Everything marked **Verified** was observed on a live deployment through the public gateway
with an org API key — the same path your key takes — on 2026-08-06, with the newer surfaces
(system prompt, artifacts, outcome) re-verified the same way on 2026-08-14. Nothing here is
inferred from a specification alone.

If a row says Verified and it fails for you, that is a regression and worth reporting. If a
row says Available, not verified and it fails for you, you have found the answer before we
did.

## Agents

| Capability | Status | Note |
|---|---|---|
| `listModels()` | Verified | Returns the model alias catalog your organization can select. Cheapest liveness check for a key: it touches no agent and creates nothing. Submit the alias (`litellm/...`), never a provider model name. |
| `createAgent()` | Verified | Returns a **flat create receipt** with a top-level `config_version`. The gateway overwrites the `ownership` you send with your key's own anchors, so placeholders are fine. |
| `Idempotency-Key` on create | Available, not verified | The header is accepted. We have never replayed a create with the same key to observe the dedupe, so do not assume a retry is free. |
| `getAgent()` | Verified | Returns a **different shape** from create: configuration under `declared`, version at `status.config_version`, and no top-level `config_version` or `name`. Read the version as `agent.status?.config_version ?? agent.config_version`. |
| `startAgent()` | Verified | Required. A new agent is `stopped`. `desired_state` flips to `running` in well under a second. The returned `channel_routes_reload_failed` warning is normal noise for an API-only agent, not a failure. |
| `stopAgent()` | Verified | Sub-second. Afterwards `createSession()` returns `409 agent_not_running`. |
| Gate readiness on `status.desired_state` | Verified | The only correct readiness signal. Poll until it is `running`. |
| Gate readiness on `status.actual_state` | Not available | `actual_state` reports chat-channel connectivity, not API readiness. An API-only agent has no channels, so it stays at `activating` forever and `active` is unreachable. `running` is not even a member of its enum, so a loop waiting for it never returns. |
| `updateAgent()` | Verified | Merges **per section**. Sections you omit are preserved: a PUT carrying only `labels` leaves `name`, `model`, and `persona` intact. |
| `tool_policy` / `system_prompt` replacement | Available, not verified | The two exceptions to the merge rule: every PUT replaces each of these sections wholesale. `{}` restores the full tool manifest. We have only exercised the merge behaviour on other sections. |
| `system_prompt` pin | Verified | A fresh create pins the platform template version active at that moment — `{source:'platform',version:1}` observed on 2026-08-14 — and the pin never follows a later platform activation on its own. `{source:'custom',base_version,template}` replaces the whole template (all 13 functional slots exactly once, 64 KiB cap). Moving the pin is one explicit call — the row below. |
| `getSystemPrompt()` / `previewSystemPrompt()` | Verified | The declaration plus the rendered template in effect; and deterministic assembly of the exact prompt for runtime facts you supply — 13 `slot_hashes`, `transcript` always `[]`, and a stale `config_version` answers `409 config_version_changed`. Verified 2026-08-14. |
| `upgradeSystemPrompt()` | Verified | Moves the pin to the active platform version (or a specific one via `template_version`). `expected_config_version` is a real CAS: stale answers `409 config_version_changed`, and the 200 receipt carries the NEW `config_version` — an upgrade is a config write like any other. Verified 2026-08-14, the day gateway fix #3387 opened the `{id}:verb` route grammar; on an older gateway deployment this one call answers a gateway 404. |
| `config_version` as an idempotency receipt | Not available | Every successful PUT increments it, including a PUT with identical values. Credential seeding at create time bumps it twice more, so the `1` on your create receipt is already `3` by your first `getAgent()`. It is a change counter, not a content hash. |
| `deleteAgent()` | Verified | A soft delete. It does not stop the agent, does not remove its schedules, and does not release its sandbox. Call `stopAgent()` first, and remove schedules yourself. |
| Listing agents | Available, not verified | `listAgents(opts?)` calls it. The wire route takes `owner_uid` plus `org_id` as an exact AND selector, so an agent created by a different key in your organization can be fetched by id but never appears in your list; keep your own record of those ids. `labels` filters on declared labels and `page` is 1-based, with the page size fixed at 100. `{ labels: { workspace_id: '...' } }` resolves a chat-URL workspace id to its agent. |
| Agent id from another organization | Verified | Returns **404**, not 403. Existence is hidden, so 404 does not mean "deleted". |
| Invalid or missing key | Verified | `401` with `error.type` of `service_token.invalid`. Match on `ZooclawError.status` and `.type`, never on message text. |
| `persona.docs[]` | Available, not verified | Only entries with inline `content` are stored. `MEMORY.md` and any `memory/` name are rejected with `400 invalid_persona_doc_name`. Documents outside the canonical name set are saved but are not assembled into the prompt. |
| `environment_id` / `environment_version` pin | Available, not verified | Accepted at the top level of `resource` on create and in the PUT body. Supplying only a version is a `400`. |
| `warm: true` on create | Available, not verified | Signals sandbox pre-warm at create time. Where the backing wiring is absent, creation still succeeds and the warm-up is a silent no-op. |
| `heartbeat` section | Available, not verified | See [Automation](#automation). |
| Agent version history, pinning, rollback | Not available | No route lists or fetches a previous `config_version`, and nothing pins a session to one. |
| `putCredential()` / `listCredentials()` | Not available | Present on the SDK interface, `404` through the gateway by design. The platform seeds the model credential itself. |

## Sessions

| Capability | Status | Note |
|---|---|---|
| `createSession(agentId, input)` | Verified | A session is a **sub-resource of an agent**: `POST /agents/{id}/sessions`. Code ported from a top-level `/sessions` API will not compile against this SDK. |
| `initial_events` with `user.message` | Verified | Only `user.message` is accepted here, up to 50 entries. |
| `Idempotency-Key` on session create | Verified | Honoured. Safe to retry a create with the same key. |
| `409 agent_not_running` | Verified | Stable and matchable on `error.type`. This is what you get if you skip `startAgent()`. |
| `getSession()` | Verified | `status` comes back as `null` on this path; the run state lives in `run_status`. The response also carries a `pending_approvals` count. |
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
| `listEvents()` | Verified | Server default 100, maximum 500, **one page per call**. A long session truncates silently with no error. Page with `after` until you get fewer rows than your limit. |
| `types` filter on `listEvents()` | Verified | `?types=agent.assistant` narrows the result as expected. |
| `streamEvents()` (SSE) | Verified | The stream is **session-scoped**: it does not close when a turn ends. Detect the end of a turn with `isRunFinished`. The server closes the connection when the session goes idle. |
| Resume with `?after=<seq>` | Verified | Every SSE frame carries a durable `seq` in its `id:` line, and the server replays from that seq. Reconnect costs you nothing and needs no client-side de-duplication. |
| Resume with the `Last-Event-ID` header | Available, not verified | Documented as equivalent. The SDK uses the query parameter, which is the path we have exercised. |
| `?deltas=` incremental preview | Available, not verified | **Snapshot-replace** semantics, not prefix append: each frame is the whole text so far. Concatenating them duplicates text. Returns `501 not_configured` where the delta lane is not wired. The SDK skips these frames. |
| `run.finished` as the end of a turn | Verified | `payload.status` is `succeeded`, `failed`, or `aborted`. |
| `agent.tool` phases `start` and `end` | Verified | One call produces two events sharing a `toolCallId`. They are not adjacent when calls run concurrently, so pair by id rather than by position. |
| `agent.tool` phase `blocked` | Available, not verified | A third phase meaning the call is waiting on an approval and has not run. Treat it as pending, never as an end. |
| A failing tool does not fail the run | Verified | `agent.tool` with `isError: true` is still followed by `run.finished` with `succeeded`. Never infer turn success from the absence of tool errors. |
| `agent.approval` | Available, not verified | In the event vocabulary. We have not observed one. |
| Two wire spellings for one event | Verified | REST answers snake_case (`event_type`, `run_id`, `created_at`), SSE answers camelCase (`eventType`, `runId`, `createdAt`). Neither carries a top-level `type`. The SDK normalizes both into one `SessionEvent`; calling the HTTP API directly means writing both mappings. |
| Full event vocabulary | Available, not verified | A normal turn produces `run.started`, `agent.lifecycle`, `agent.item`, `agent.thinking`, `agent.assistant`, `agent.tool`, `run.finished`, all observed. The remaining members of `SESSION_EVENT_TYPES` are declared by the contract and we have not seen every one. Unknown types pass through the SDK rather than throwing. |
| `session.status_*`, `span.*`, `stop_reason` | Not available | Not in the vocabulary. The `status_idle` plus `stop_reason.type === 'requires_action'` programming model has no counterpart here; use `run.finished`. |
| Push delivery of events to your server | Not available | See [Not supported](/en/reference/not-supported). Hold the stream or poll with `after`. |

## Tools

| Capability | Status | Note |
|---|---|---|
| Built-in tools available to the model | Verified | A normal turn produces paired `agent.tool` events. The exact tool names arrive on those events at runtime; there is no published catalog route to enumerate them first. |
| `tool_policy` allow and deny | Available, not verified | `{}` means the full manifest. A non-empty object is read as an allow/deny policy that narrows the surface. We have not exercised a narrowed policy, so confirm your policy took effect by watching which tools appear in `agent.tool`. |
| Client-executed custom tools | Not available | There is no custom tool type and no `user.custom_tool_result` event. This is the largest single gap. [Read the alternatives](/en/reference/not-supported#client-executed-custom-tools) before designing around it. |
| Remote HTTP MCP server | Verified | Declared on the agent (`resource.mcp[]`), not as its own resource; transports are `streamable-http` (the default) and `sse`. Tools appear in the model's manifest as `mcp__<server>__<tool>` — the server name must not contain an underscore — and really execute against a public server. The catalog pins per `config_version`; a failed probe pins an empty catalog and emits `agent.error` with `kind: 'mcp_connection_failed'` rather than failing the run. This is the only route by which your own code can back an agent tool, and it works **unauthenticated only**: the `credential` slug is accepted but the store behind it answers 404 through the gateway, so a server that needs auth cannot be made to work today. |
| stdio MCP servers, MCP OAuth | Not available | Remote HTTP is the whole of it. |
| Approval-gated tool execution, end to end | Not available | The pieces exist in the vocabulary; the closed loop is unproven. See [Not supported](/en/reference/not-supported#end-to-end-human-approval). |
| `POST /agents/{id}/exec` | Available, not verified | An operations extension that runs a command in the agent's sandbox, not a path for agent tool use. `exec(agentId, args)` calls it, and `args` is argv: use `['bash', '-lc', 'pwd']` for shell semantics. Requires an agent-scope sandbox: session-scoped agents get `409 exec_requires_agent_scope`, and a deployment with no sandbox backend gets `501 not_configured`. |

## Skills

| Capability | Status | Note |
|---|---|---|
| `listAgentSkills()` | Verified | A brand new agent already has the **entire global catalog attached**, including docx, pptx, xlsx, and pdf. You do not install these; they are there from creation. |
| Reading the skill catalog | Verified | `listSkills({ scope, q, page })` reads it. The catalog route answers 200. Every entry we saw had `scope: global`. `q` matches on name; `page` is 1-based with a fixed page size of 100. |
| `putAgentSkill()` on a global-catalog skill | Not available | Returns `404` through the gateway. The install route is only meaningful for skills your own tenant uploaded. Since global skills are attached at creation, this is mostly "you already have them, and you cannot manage them" rather than "you cannot use them". |
| `putAgentSkill()` / `deleteAgentSkill()` on an `org` or `personal` skill | Available, not verified | The gateway forwards these two scopes. We never had a non-global skill to install, so the whole install-then-read-back cycle is untested. |
| Uploading your own skill | Available, not verified | A multipart create takes a single `.zip` plus a scope of `org` or `personal`; `name` and `description` come from the `SKILL.md` frontmatter inside the archive. Global scope is not writable from an org key. |
| Session-level skill selection | Not available | Skills attach to the agent. There is no per-session skill set. |

## Environments

An environment is an optional, immutable sandbox image you pin on an agent: pre-installed
packages, controlled files, a build script, and a network policy.

| Capability | Status | Note |
|---|---|---|
| Environments are reachable through the gateway | Verified | `listEnvironments()` answers `200` with an empty list. That is the whole of what we have exercised: nothing on the build path below has been run. |
| Create an environment and build a version | Available, not verified | Versions are immutable and move `queued -> submitting -> building -> verifying -> ready`, with `failed` reachable from any build phase. Poll the specific version, not the environment's top-level state. |
| apt, npm, pip pre-install | Available, not verified | Installation order is fixed: apt, then npm, then pip. |
| cargo, gem, go | Not available | Three package managers, not six. |
| Network policy | Available, not verified | `unrestricted`, or `limited` with an `allowed_hosts` list of domains (a `*.` prefix covers one sub-domain level). `allowed_hosts` on `unrestricted` is a `400`. |
| Controlled files and a build script | Available, not verified | Files land under a fixed directory; executable top-level `bin/*` entries are linked onto the path. The build script runs at image build time only. |
| Direct upload for large files | Available, not verified | A four-step declare, upload, finalize, reference flow. Inline content is capped at 1 MB per request; the total is capped at 50 MB. |
| Build logs, retry, archive | Available, not verified | Logs are read incrementally by offset. A retry re-attempts the same version and keeps the audit trail. |
| Environment lock | Available, not verified | An agent's environment can be changed until its first successful sandbox creation, then answers `409 environment_locked`. Stopping the agent does not unlock it. Pin deliberately the first time. |
| Secrets, runtime environment variables, sandbox start hooks | Not available | An environment is a build-time artifact. It accepts none of these. |
| Arbitrary base image inheritance | Not available | A custom environment always inherits the platform base. |
| Running tools on your own machine | Not available | See [Not supported](/en/reference/not-supported#self-hosted-tool-execution). |

## Automation

| Capability | Status | Note |
|---|---|---|
| Schedules as an agent sub-resource | Available, not verified | List, create, replace, delete, trigger, and read runs, all under `/agents/{id}/schedules`, and all seven are on the client: `listSchedules`, `createSchedule`, `getSchedule`, `updateSchedule`, `deleteSchedule`, `triggerSchedule`, `listScheduleRuns`. Two things the types cannot fix for you. The cadence changes only through `schedule: { kind: 'cron', expr, tz }`; the `scheduleSpec` a read hands back is refused by `ScheduleUpdate` and ignored by the server. And `triggerSchedule` against a disabled schedule answers `triggered: true` while the run projection records `status: 'skipped'`. |
| `cron`, `every`, `at` | Available, not verified | Cron is a five-field expression at most, with no macros. Overlap is fixed to SKIP by the server and is not configurable. |
| An outcome gate on a cron job (`payload.outcome`) | Verified | What "done" looks like, checked inside the run: a `description`, a `command` evaluator (sandbox exit 0 = satisfied) or a `rubric` one (LLM grader in a fresh context), `maxIterations` 1–5, and `publish: after_satisfied \| always \| never` — under the default, a result that failed evaluation is not announced. An agent-level default lives at `resource.outcome`; a job's own value overrides it and an explicit `null` opts the job out. Cron fires only. What we verified on 2026-08-14 is the **storage round trip** — accepted, stored, read back verbatim, no defaults injected; no evaluated fire has been observed yet. |
| Where the scheduler backend is not wired | Not available | Those deployments answer `501 not_configured`. Do not retry the same call. Check this before you build a product on scheduling. |
| Heartbeat | Available, not verified | Not a route: a `heartbeat` section in the agent's declared config, reconciled on create and on every PUT. Setting `every` to `0` pauses it and keeps run history. Reconciliation is best effort and failures are not reported back to your call. |
| Wake | Available, not verified | `wake(agentId, { text, mode })` queues a reminder for the next heartbeat turn, or triggers the heartbeat schedule immediately. Immediate mode returns `409` when no heartbeat is enabled. |
| Webhook delivery from a schedule | Not available | `delivery` accepts `none` and a typed `announce`. Webhook delivery is rejected. |
| Pause and unpause, archive, run history across schedules | Not available | Delete and recreate instead, and read runs one schedule at a time. |
| Automatic cleanup on agent delete | Not available | Schedules survive both stopping and deleting an agent. List and delete them yourself first, or they keep firing. |

## Files

| Capability | Status | Note |
|---|---|---|
| Write a file into the agent workspace | Available, not verified | `POST /agents/{id}/files` with a path and content. Writing a context document also produces a new configuration snapshot. |
| Read a file | Available, not verified | `path`, `owner_uid`, and `org_id` are **all required**. Omitting `path` is a `400`, so this is not a "list my files" endpoint. Paths must stay under the agent root. |
| Download raw bytes | Available, not verified | A separate content endpoint returns bytes without UTF-8 coercion, capped at 100 MB per file. |
| Durable storage for user files | Not available | The backend is not wired to a shared persistent workspace. Do not make this your store of record. |
| Attaching a file to a session | Not available | See [Not supported](/en/reference/not-supported#session-file-attachment-and-repository-mounting). |
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
