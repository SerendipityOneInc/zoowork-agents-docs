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

**API errors are passed through unchanged.** The commonest API envelope is:

```json
{ "error": { "type": "agent_not_running", "message": "agent is not running" } }
```

**The gateway emits its own envelope for authentication and tenancy failures** - the checks
it runs before it ever forwards your request. A rejected key answers `401` with the type
`service_token.invalid`, which is a gateway code, not an API one.

The API side is itself two families, not one. Sessions, schedules, and environments answer
`{ error: { type, message } }` with a bare code (`agent_not_running`, `session_archived`); the
agents family answers `{ code, detail }` with a dotted one (`service_api.not_found`). Both land
on `ZooworkError`, and the codes are kept verbatim - the SDK does not invent a shared
vocabulary for them - so read the `not_found` row below before you compare a type with `===`.

::: warning `type` can be `undefined`
Two cases leave you with no type at all:

1. Any non-JSON error body - an HTML error page from an intermediary, an empty body, a proxy
   timeout. The SDK keeps a clean `HTTP <status>` message and no type.
2. **Every SSE stream failure.** `streamEvents()` builds its error from the status line
   alone, so `type` is always `undefined` there even when the body had one.

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
| `not_found` / `service_api.not_found` | 404 | Unknown agent or session id, a soft-deleted one, **or one that belongs to another organization**. Both spellings exist: the agents family answers `service_api.not_found`, the sessions, schedules, and environments family answers a bare `not_found`. | Match on both spellings, or prefer `status === 404`. Do not read this as "deleted": cross-tenant reads are hidden as 404, never rejected as 403. Keep your own record of the ids you create. |
| `service_token.invalid` | 401 | The key is missing, malformed, revoked, or its bound user left the organization. Emitted by the gateway, in the gateway's envelope. | Fix the credential. Do not retry - it will fail identically. Verify with `listModels()`. |
| `idempotency_conflict` | 409 | The same `Idempotency-Key` was replayed on `createAgent()` with a **different** body. Same key plus same body is a replay and returns the first result. | Use a new key, or send the original body. Derive keys from something stable in your own system. |
| `invalid_request` | 400 | A malformed or rejected request body: a read missing its selector, a skill version pinned to a version that is not ready. | Fix the request. Retrying unchanged fails identically. |
| *(may be absent)* | 404 | `putAgentSkill()` with a global-catalog skill id. Only skills your own tenant uploaded are installable here, and the global catalog is already attached to every new agent, so there is nothing to install. | Branch on `status === 404` because this response may omit `type`. See [Skills](../build/skills.md). |

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
| `not_configured` | 501 | The backing service is not configured in this environment. Do not retry as-is. |

## What is safe to retry

Retry safety is per operation, not per error. Nothing in the SDK retries for you.

| Operation | Safe to retry? | Why |
|---|---|---|
| `listModels`, `getAgent`, `getSession`, `listEvents`, `listAgentSkills`, and the other `list*` / `get*` reads | **Yes** | Reads. Retry on network errors and 5xx with exponential backoff. |
| `startAgent`, `stopAgent` | **Reconcile first** | A failed stop can follow a desired-state change. Read back before retrying. Warnings belong to successful responses; non-2xx still throws. |
| `deleteAgent` | **Yes** | Soft delete. Repeated calls succeed. |
| `streamEvents` | **Yes** | Reconnect with the last event's resume token — `{ cursor: ev.cursor }`. The server resumes the log; checkpoint after successful processing. This does not make application side effects exactly-once. Do **not** reconnect with `{ after: lastSeq }`: that selects the deprecated engine-only lane, which drops your own input events (`user.message`, `user.interrupt`, `user.tool_confirmation`, `user.custom_tool_result`, `system.message`). |
| `createAgent`, `createSession`, `createEnvironment`, `createEnvironmentVersion` | **Reuse the HTTP key** | Reuse the same stable `Idempotency-Key` and body. A new key means a new request. |
| `createSchedule` | **Stable ID and definition** | Reuse `schedule_id` with the same definition; a different definition conflicts. The HTTP key is not its deduplication mechanism. |
| `uploadSkill` | **Read back first** | A successful create retried under the same active scope/name can return `409 skill_exists`. An HTTP key does not promise response replay. |
| `uploadSkillVersion` | **Same skill and content** | Identical content is deduplicated for that skill, not by the HTTP key. Confirm the resulting version; do not infer an exactly-once guarantee. |
| `updateAgent`, `putAgentSkill`, `deleteAgentSkill` | **No** | Each success bumps `config_version`. After a timeout, `getAgent()` first and reconcile before you decide. |
| `updateSchedule`, `deleteSchedule` | **No** | Neither carries a cross-timeout idempotency guarantee. After a timeout, reconcile by listing the agent's schedules and reading their runs rather than sending the write again. |
| `postEvents` | **Reuse each event's key** | Retry the same message with its stable `idempotency_key` in the event body, not an HTTP header. Without it, a blind retry can deliver twice. |

### `Idempotency-Key` on the create calls

Idempotency works differently across operations. HTTP keys, event keys, stable resource IDs,
and content deduplication are separate mechanisms; none creates an exactly-once guarantee.
Agent, Session, and Environment create methods take an HTTP key as a trailing argument. Two
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

- **Every successful PUT bumps it, including a byte-identical one.** There is no no-op
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

There is also no optimistic concurrency: `updateAgent()` takes no version precondition, and
two concurrent writers never see a conflict. They silently last-write-wins, per section.

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
      // Gateway envelope; e.type is service_token.invalid. Retrying will not help.
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
