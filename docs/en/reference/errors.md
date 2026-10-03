---
description: Handle ZooworkError, choose safe retries, and use idempotency correctly.
---

# Errors and retries

Every SDK method throws a `ZooworkError` when the API answers with a non-2xx status. This
page is what to catch, what to branch on, and what is safe to send twice.

## `ZooworkError`

```ts
class ZooworkError extends Error {
  name: 'ZooworkError'
  status: number
  message: string
  type?: string
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | `number` | The HTTP status. Always set. |
| `message` | `string` | Human text lifted from the response body, or `HTTP <status>` when the body carried none. **For humans and logs only.** |
| `type` | `string \| undefined` | The machine-readable code from the error envelope. **This is the field to branch on** - when it is there. |

```ts
import { ZooworkError } from '@zoowork-ai/sdk'

try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooworkError) {
    console.error(e.status, e.type, e.message)
  }
}
```

`ZooworkError` is a real class, so `instanceof` works. Narrow with it before you read
`.status` or `.type` - a network failure, a DNS error, or an aborted request surfaces as the
runtime's own `TypeError` or `AbortError`, not as a `ZooworkError`. The one exception is
`waitUntilRunning()`, which synthesizes its own locally: a budget that runs out is
`ZooworkError` `408` / `'timeout'`, and an aborted wait is `0` / `'aborted'`. The server sends
neither, and neither leaks a `DOMException` from the abort underneath.

## Match on `error.type`, never parse messages

Message text is not part of the contract. It is written for a person reading a log, it
differs between the API and the gateway, and it can change without notice.

```ts
// Wrong. Breaks the first time someone rewords the string.
if (e.message.includes('not running')) await zc.startAgent(agentId)

// Right.
if (e instanceof ZooworkError && e.type === 'agent_not_running') await zc.startAgent(agentId)
```

The one qualification, which the next section is about: `type` is not always present.

## Two error envelopes

Your requests pass through a gateway that authenticates your key and scopes you to your
organization, then reach the API. **Both can produce an error, and they produce it in their
own envelope.**

**Runtime responses below 500 are relayed; runtime 5xx failures are normalized.** A runtime 5xx becomes gateway HTTP 502 with code `agent.runtime_error`. Authentication and scope checks can also fail before forwarding. A common runtime envelope for a 409 is:

```json
{ "error": { "type": "agent_not_running", "message": "agent is not running" } }
```

**The gateway emits its own envelope for authentication and tenancy failures** - the checks
it runs before forwarding. An invalid API key returns `401 platform.api_key_invalid`. A missing or unsupported Bearer credential can return `401 service_token.required`.

The API side is itself two families, not one. Sessions and schedules answer
`{ error: { type, message } }` with a bare code (`agent_not_running`, `session_archived`); the
agents family answers `{ code, detail }` with a dotted one (`service_api.not_found`). Both land
on `ZooworkError`, and the codes are kept verbatim - the SDK does not invent a shared
vocabulary for them - so read the `not_found` row below before you compare a type with `===`.

::: warning `type` can be `undefined`
Two cases leave you with no type at all:

1. Any non-JSON error body - an HTML error page from an intermediary, an empty body, a proxy
   timeout. The SDK keeps a clean `HTTP <status>` message and no type.
2. **A non-JSON SSE connection error.** `streamEvents()` shares HTTP error parsing and retains a type from a recognized JSON error envelope. Non-JSON failures can have no type, and transport interruptions can raise runtime errors. Optional `requestId`, `contentType`, `bodySnippet`, `cfRay`, and `retryable` provide diagnostics; they are not guaranteed on every response.

So branch on `status` as well as `type`, and always have a `status`-only fallback.
:::

```ts
if (e instanceof ZooworkError) {
  if (e.type === 'agent_not_running') { /* specific */ }
  else if (e.status === 401)          { /* auth, whichever envelope produced it */ }
  else if (e.status === 404)          { /* missing or not yours */ }
  else                                { throw e }
}
```

One more oddity worth knowing: a `ZooworkError` can carry a **2xx** status. If a successful
response arrives with a body that is not valid JSON, the SDK throws
`ZooworkError(res.status, 'non-JSON response: <path>')`. Do not assume `status >= 400` inside
your catch block.

## Common error types

| `type` | HTTP | Cause | What to do |
|---|---:|---|---|
| `agent_not_running` | 409 | `createSession()` or `postEvents()` on an agent whose `status.desired_state` is not `running`. A newly created agent is stopped, and so is one you stopped yourself. | Call `startAgent()`, poll `status.desired_state` until it reads `running`, then retry. Never poll `actual_state`. |
| `model_not_selectable` | 409 | A create or update selects a model catalog row that remains visible for existing references but no longer accepts new selection. | Refresh `listModels()`, choose a row whose `selectable` is not `false`, and use `expired_fallback_to` when the catalog supplies one. Do not retry the same alias unchanged. |
| `not_found` / `service_api.not_found` | 404 | Unknown or deleted Agent or Session ID, or a resource outside the key's organization, Project, or owner scope. The Agent routes use `service_api.not_found`; Session and Schedule routes can use `not_found`. | Match both spellings or use `status === 404`. A 404 does not prove deletion. Keep a record of the IDs you create and use the key for their scope. |
| `idempotency_conflict` | 409 | The same `Idempotency-Key` was replayed on `createAgent()` with a **different** body. Same key plus same body is a replay and returns the first result. | Use a new key, or send the original body. Derive keys from something stable in your own system. |
| `invalid_request` | 400 | A malformed or rejected request body: a read missing its selector, a skill version pinned to a version that is not ready. | Fix the request. Retrying unchanged fails identically. |
| *(may be absent)* | 404 | `putAgentSkill()` with an unknown Skill ID or one outside the key's visible scopes. | Branch on `status === 404` because this response may omit `type`. Check the Skill's visibility; see [Skills](../build/skills.md). |

### More 400s

`updateAgent()` answers **400** when the body names `skills`, `credentials`, or any
unknown field. Skills go through `putAgentSkill()`; credentials are not configured through
`updateAgent()`.

Two create-time rejections carry their own narrower type rather than `invalid_request`:
`invalid_persona_doc_name` for a `persona.docs` entry named `MEMORY.md` or anything under the
reserved `memory/` namespace, and `sandbox_template_deprecated` for a `sandbox.template`
field. Operationally they are the same as any other 400: fix the body, do not retry.

These two errors are both HTTP 400. Use the narrower `type` when present and keep a
status-based fallback.

`postEvents()` answers **400** for any event outside the five accepted types - see
[Events](../build/events.md). The response may omit `error.type`, so branch on `status === 400`
for `postEvents()` failures, and treat them as programming errors rather than transient ones:
your event shape is wrong and a retry will not change that.

### Other error types

Use these values when `type` is present, while retaining the HTTP-status fallback described
above.

| `type` | HTTP | Meaning |
|---|---:|---|
| `forbidden` | 403 | A recognized credential used on the wrong surface, or a policy reject after authentication. |
| `conflict` | 409 | Generic state conflict; re-read the resource. |
| `platform_credentials_required` | 409 | An agent start attempted before its platform credentials exist. The gateway seeds these for you. |
| `payload_too_large` | 413 | Body or skill payload over the limit. |
| `quota_exceeded` | 429 | Rate or quantity limit. |
| `internal_error` | 500 | Server-side failure. Back off and retry reads; reconcile writes first. |
| `agent.runtime_error` | 502 | A runtime dependency returned a server failure. Retry reads with backoff; reconcile writes before retrying. |

## Platform and Usage errors

Match the HTTP status as well as the code. A runtime-credential or billing prerequisite is not fixed by retrying an unchanged request.

| Code | HTTP | What to do |
|---|---:|---|
| `service_token.required` | 401 | Supply a supported Bearer credential. |
| `platform.api_key_invalid` | 401 | Check the secret, revocation, organization, Project, and owner state. |
| `platform.authentication_unavailable` | 503 | Retry later; an authentication dependency is unavailable. |
| `platform.key_credentials_not_bound` | 409 on Agent creation | Ask the organization owner to sign in to Platform, create a replacement key, and update the application. See [Authentication](../get-started/authentication.md#replace-or-revoke-a-key). |
| `platform.billing_not_ready` | 409 | Sign in to Platform and wait for organization billing setup to complete. If it fails, select **Retry billing setup**. This code alone does not mean the balance is insufficient. |
| `platform.runtime_credentials_unavailable` | 503 | Retry later; a runtime-credential dependency is unavailable. |
| `usage.access_denied` | 403 | Query only within the key's Usage scope. |
| `usage.snapshot_expired` | 409 | Start a fresh Usage query. |
| `usage.invalid_query` | 400 | Fix semantic query errors, such as an invalid timezone. |
| *(may be absent)* | 422 | Usage query validation can return a `detail` array without a business error type, for example an unsupported range or out-of-bounds page size. Fix the parameters; do not retry unchanged. |
| `usage.busy` | 429 | Retry the read with backoff. |
| `usage.unavailable` | 503 | Retry later; do not interpret an incomplete response as zero usage. |

See [Authentication](../get-started/authentication.md) and [Usage](./usage.md). Diagnostic request IDs are optional; the public gateway does not guarantee an Engine request-ID header on every response.

## What is safe to retry

Retry safety is per operation, not per error. Nothing in the SDK retries for you.

| Operation | Safe to retry? | Why |
|---|---|---|
| `listModels`, `getAgent`, `getSession`, `listEvents`, `listAgentSkills`, and the other `list*` / `get*` reads | **Yes** | Reads. Retry on network errors and 5xx with exponential backoff. |
| `startAgent`, `stopAgent` | **Reconcile first** | A failed stop can follow a desired-state change. Read back before retrying. Warnings belong to successful responses; non-2xx still throws. |
| `deleteAgent` | **Reconcile first** | First success is 204; repeated deletion returns 404. Treat it as cleanup complete only for an Agent you know belonged to the unchanged key scope; a general 404 also hides inaccessible resources. |
| `streamEvents` | **Yes** | Reconnect with the last event's resume token — `{ cursor: ev.cursor }`. The server resumes the log; checkpoint after successful processing. This does not make application side effects exactly-once. Do **not** reconnect with `{ after: lastSeq }`: that selects the deprecated engine-only lane, which drops your own input events (`user.message`, `user.interrupt`, `user.tool_confirmation`, `user.custom_tool_result`, `system.message`). |
| `createAgent`, `createSession` | **Reuse the HTTP key** | Reuse the same stable `Idempotency-Key` and body. A new key means a new request. |
| `createSchedule` | **Stable ID and definition** | Reuse `schedule_id` with the same definition; a different definition conflicts. The HTTP key is not its deduplication mechanism. |
| `updateAgent`, `putAgentSkill`, `deleteAgentSkill` | **No** | Each success bumps `config_version`. After a timeout, `getAgent()` first and reconcile before you decide. |
| `updateSchedule`, `deleteSchedule` | **No** | Neither carries a cross-timeout idempotency guarantee. After a timeout, reconcile by listing the agent's schedules and reading their runs rather than sending the write again. |
| `postEvents` | **Reuse each event's key** | Retry the same message with its stable `idempotency_key` in the event body, not an HTTP header. Without it, a blind retry can deliver twice. |

### `Idempotency-Key` on the create calls

Idempotency works differently across operations. HTTP keys, event keys, stable resource IDs,
and content deduplication are separate mechanisms; none creates an exactly-once guarantee.
Agent and Session create methods take an HTTP key as a trailing argument. Two
common examples:

```ts
const created = await zc.createAgent(
  { resource: { name: 'research-agent' } },
  'provision-research-agent-1',
)

const session = await zc.createSession(
  agentId,
  { initial_events: [{ type: 'user.message', content: userInput }] },
  `chat-${incomingMessageId}`,
)
```

The uniqueness domain for agent create is `(agent.create, key)`. Replaying the same key with
an identical body returns the first result. Replaying it with a different body is
`409 idempotency_conflict`.

**Derive the key from something stable in your own system** - the id of the inbound message,
the row id of the job you are provisioning for - not from a value generated at call time. A
fresh random key on every attempt makes the header useless, because the retry is exactly the
call that needs to converge on the first one.

### `config_version` is not an idempotency receipt

The temptation is to use the version number to work out whether a write landed. It does not
work in either direction.

- **Configuration writes bump it, including a byte-identical one.** Ownership-only writes do not. There is no no-op
  detection, so "the version changed" does not mean your values changed anything.
- **Writes you did not make bump it too.** Right after `createAgent()` the gateway seeds the
  agent's model credentials, and each of those bumps the version: a create receipt saying `1`
  is commonly followed by a first `getAgent()` saying `3`.

```ts
const before = (await zc.getAgent(agentId)).status?.config_version   // 4
await zc.updateAgent(agentId, { labels: { probe: 'x' } })
const first  = (await zc.getAgent(agentId)).status?.config_version   // 5
await zc.updateAgent(agentId, { labels: { probe: 'x' } })            // identical body
const second = (await zc.getAgent(agentId)).status?.config_version   // 6 - bumped anyway
```

Treat it as an opaque monotonic counter. To find out whether a timed-out `updateAgent()`
landed, read the values back out of `declared` and compare those.

Production `updateAgent()` rejects `expected_config_version` with `400 invalid_declared_key`.
Omit it for ordinary last-write-wins updates and serialize competing writes in your application.
A read followed by an update does not provide atomic optimistic concurrency.
The separate `upgradeSystemPrompt()` precondition still uses `409 config_version_changed`.

## A worked example

Provisioning that survives the two failures you will actually meet: a stopped agent, and a
create that may or may not have landed.

```ts
import { createZooworkClient, ZooworkError } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

async function openSession(agentId: string, text: string, jobId: string) {
  try {
    return await zc.createSession(
      agentId,
      { initial_events: [{ type: 'user.message', content: text }] },
      `job-${jobId}`, // stable key: a retry converges on the first session
    )
  } catch (e) {
    if (!(e instanceof ZooworkError)) throw e // network or abort, not an API answer

    if (e.type === 'agent_not_running') {
      await zc.startAgent(agentId)      // warnings here are informational
      // Polls desired_state, the only field that gates session calls. Throws 408/'timeout'.
      await zc.waitUntilRunning(agentId)
      return zc.createSession(
        agentId,
        { initial_events: [{ type: 'user.message', content: text }] },
        `job-${jobId}`,
      )
    }

    if (e.status === 404) {
      // Missing, soft-deleted, or another organization's. Not necessarily "deleted".
      throw new Error(`agent ${agentId} is not visible to this key`)
    }

    if (e.status === 401) {
      // Authentication failure; check the API key.
      throw new Error('API key rejected - check ZOOWORK_API_KEY')
    }

    throw e
  }
}
```

Three things this does on purpose:

- It narrows with `instanceof ZooworkError` before touching `.type`, so a transport failure
  propagates instead of being mistaken for an API answer.
- It branches on `type` where a type exists and falls back to `status` where one may not.
- It reuses the same `Idempotency-Key` on the retry. That is the whole point of the key.

## Next

- [TypeScript SDK reference](./typescript-sdk.md) - every method, type, and helper.
- [Agents](../build/agents.md) - start, stop, and the `config_version` semantics behind this page.
