# Errors and retries

Every SDK method throws a `ZooclawError` when the API answers with a non-2xx status. This
page is what to catch, what to branch on, and what is safe to send twice.

## `ZooclawError`

```ts
class ZooclawError extends Error {
  name: 'ZooclawError'
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
import { ZooclawError } from '@zooclaw-agents/sdk'

try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooclawError) {
    console.error(e.status, e.type, e.message)
  }
}
```

`ZooclawError` is a real class, so `instanceof` works. Narrow with it before you read
`.status` or `.type` - a network failure, a DNS error, or an aborted request surfaces as the
runtime's own `TypeError` or `AbortError`, not as a `ZooclawError`.

## Match on `error.type`, never parse messages

Message text is not part of the contract. It is written for a person reading a log, it
differs between the API and the gateway, and it can change without notice.

```ts
// Wrong. Breaks the first time someone rewords the string.
if (e.message.includes('not running')) await zc.startAgent(agentId)

// Right.
if (e instanceof ZooclawError && e.type === 'agent_not_running') await zc.startAgent(agentId)
```

The one qualification, which the next section is about: `type` is not always present.

## Two error envelopes

Your requests pass through a gateway that authenticates your key and scopes you to your
organization, then reach the API. **Both can produce an error, and they produce it in their
own envelope.**

**API errors are passed through unchanged.** The API envelope is:

```json
{ "error": { "type": "agent_not_running", "message": "agent is not running" } }
```

**The gateway emits its own envelope for authentication and tenancy failures** - the checks
it runs before it ever forwards your request. A rejected key answers `401` with the type
`service_token.invalid`, which is a gateway code, not an API one.

The SDK reads `error.type` from whatever envelope comes back, and `error.message` with a
`message` fallback:

```ts
const j = JSON.parse(text)
msg  = j?.error?.message || j?.message || `HTTP ${res.status}`
type = j?.error?.type
```

::: warning `type` can be `undefined`
Three cases leave you with no type at all:

1. A gateway-originated failure whose envelope does not carry `error.type` in that position.
2. Any non-JSON error body - an HTML error page from an intermediary, an empty body, a proxy
   timeout. The SDK keeps a clean `HTTP <status>` message and no type.
3. **Every SSE stream failure.** `streamEvents()` builds its error from the status line
   alone, so `type` is always `undefined` there even when the body had one.

So branch on `status` as well as `type`, and always have a `status`-only fallback.
:::

```ts
if (e instanceof ZooclawError) {
  if (e.type === 'agent_not_running') { /* specific */ }
  else if (e.status === 401)          { /* auth, whichever envelope produced it */ }
  else if (e.status === 404)          { /* missing or not yours */ }
  else                                { throw e }
}
```

One more oddity worth knowing: a `ZooclawError` can carry a **2xx** status. If a successful
response arrives with a body that is not valid JSON, the SDK throws
`ZooclawError(res.status, 'non-JSON response: <path>')`. Do not assume `status >= 400` inside
your catch block.

## The types you will actually hit

Observed on the public gateway against a live deployment, unless a row says otherwise.

| `type` | HTTP | Cause | What to do |
|---|---:|---|---|
| `agent_not_running` | 409 | `createSession()` or `postEvents()` on an agent whose `status.desired_state` is not `running`. A newly created agent is stopped, and so is one you stopped yourself. | Call `startAgent()`, poll `status.desired_state` until it reads `running`, then retry. Never poll `actual_state`. |
| `not_found` | 404 | Unknown agent or session id, a soft-deleted one, **or one that belongs to another organization**. | Do not read this as "deleted". See [Authentication](/en/get-started/authentication) - cross-tenant reads are hidden as 404, never rejected as 403. Keep your own record of the ids you create. |
| `service_token.invalid` | 401 | The key is missing, malformed, revoked, or its bound user left the organization. Emitted by the gateway, in the gateway's envelope. | Fix the credential. Do not retry - it will fail identically. Verify with `listModels()`. |
| `idempotency_conflict` | 409 | The same `Idempotency-Key` was replayed on `createAgent()` with a **different** `{ resource, ownership }` body. Same key plus same body is a replay and returns the first result. | Use a new key, or send the original body. Derive keys from something stable in your own system. |
| `invalid_request` | 400 | A malformed or rejected request body: a missing `ownership` on create, a read missing its selector, a skill version pinned to a version that is not ready. | Fix the request. Retrying unchanged fails identically. |

::: warning Not yet verified
`idempotency_conflict` is documented by the API and we have exercised the success path of
`Idempotency-Key` on `createAgent()` and `createSession()`, but we have not deliberately
provoked the conflict. Handle it; do not assume the exact wording of the message.
:::

### More 400s

`updateAgent()` answers **400** when the body names `skills`, `warm`, `credentials`, or any
unknown field. Skills go through `putAgentSkill()`; `warm` is create-only; credentials are not
writable through the public gateway at all.

Two create-time rejections carry their own narrower type rather than `invalid_request`:
`invalid_persona_doc_name` for a `persona.docs` entry named `MEMORY.md` or anything under the
reserved `memory/` namespace, and `sandbox_template_deprecated` for a `sandbox.template`
field. Operationally they are the same as any other 400: fix the body, do not retry.

::: warning Not yet verified
Those two type strings come from the API's own reference; we have not provoked either. What
is safe to rely on is the status.
:::

### Installing a global skill

`putAgentSkill()` with a global-catalog skill id answers **404** on the public gateway - we
have observed that status directly. Only skills your own tenant uploaded are installable here,
and the global catalog is already attached to every new agent, so there is nothing to install.

::: warning Not yet verified
We did not capture the `error.type` on that 404, and the check runs in the gateway rather
than the API, so branch on `status === 404` for skill installs.
:::

### Rejected event bodies

The event write path validates each event's shape and rejects anything outside the four
accepted types - `user.message`, `user.interrupt`, `system.message`,
`user.tool_confirmation` - with **`400`**. `user.tool_confirmation` in particular is parsed
strictly and any other shape is refused outright.

::: warning Not yet verified
We have not captured the exact `error.type` on a rejected event body, so this page does not
name one. **Branch on `status === 400` for `postEvents()` failures**, and treat them as
programming errors rather than transient ones - a 400 here means your event shape is wrong
and a retry will not change that.
:::

### Other types the API documents

::: warning Not yet verified
These appear in the API's own error reference but we have not observed them through the
public gateway. Listed so you recognize one if it arrives, not as a taxonomy to code against.

| `type` | HTTP | Meaning |
|---|---:|---|
| `forbidden` | 403 | A recognized credential used on the wrong surface, or a policy reject after authentication. |
| `conflict` | 409 | Generic state conflict; re-read the resource. |
| `platform_credentials_required` | 409 | An agent start attempted before its platform credentials exist. The gateway seeds these for you. |
| `payload_too_large` | 413 | Body or skill payload over the limit. |
| `quota_exceeded` | 429 | Rate or quantity limit. |
| `internal_error` | 500 | Server-side failure. Back off and retry reads; reconcile writes first. |
| `not_configured` | 501 | The backing service is not wired in this environment. Do not retry as-is. |
:::

## What is safe to retry

Retry safety is per operation, not per error. Nothing in the SDK retries for you.

| Operation | Safe to retry? | Why |
|---|---|---|
| `listModels`, `getAgent`, `getSession`, `listEvents`, `listAgentSkills` | **Yes** | Reads. Retry on network errors and 5xx with exponential backoff. |
| `startAgent`, `stopAgent` | **Yes** | Each call re-runs its convergence actions against the same id. Check `warnings`, and remember `channel_routes_reload_failed` is expected noise on an API-only agent, not a failure. |
| `deleteAgent` | **Yes** | Soft delete. Repeated calls succeed. |
| `streamEvents` | **Yes** | Reconnect with `{ after: lastSeq }`. Resume is server-side, so nothing between windows is lost. |
| `createAgent`, `createSession` | **Only with an `Idempotency-Key`** | Without one, a retry after a timeout creates a second agent, or a second session that runs the opening turn again. |
| `updateAgent`, `putAgentSkill`, `deleteAgentSkill`, `putCredential` | **No** | Each success bumps `config_version`, and `putCredential` also appends a secret version. After a timeout, `getAgent()` first and reconcile before you decide. |
| `postEvents` | **No** | There is no idempotency key on this route. A blind retry can deliver the same `user.message` twice and pollute the conversation. De-duplicate on your side. |

### `Idempotency-Key` on the create calls

Both create methods take the key as their last argument, sent as the `Idempotency-Key`
header:

```ts
const created = await zc.createAgent(
  { resource: { name: 'research-agent' }, ownership: { owner_uid: 'placeholder', org_id: 'placeholder' } },
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
import { createZooclawClient, ZooclawError, type ZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

async function waitUntilRunning(zc: ZooclawClient, agentId: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const agent = await zc.getAgent(agentId)
    // desired_state is the only field that gates session calls.
    if (agent.status?.desired_state === 'running') return
    if (Date.now() >= deadline) {
      throw new Error(`agent ${agentId} still ${agent.status?.desired_state} after ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function openSession(agentId: string, text: string, jobId: string) {
  try {
    return await zc.createSession(
      agentId,
      { initial_events: [{ type: 'user.message', content: text }] },
      `job-${jobId}`, // stable key: a retry converges on the first session
    )
  } catch (e) {
    if (!(e instanceof ZooclawError)) throw e // network or abort, not an API answer

    if (e.type === 'agent_not_running') {
      await zc.startAgent(agentId)      // warnings here are informational
      await waitUntilRunning(zc, agentId)
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
      throw new Error('API key rejected - check ZOOCLAW_API_KEY')
    }

    throw e
  }
}
```

Three things this does on purpose:

- It narrows with `instanceof ZooclawError` before touching `.type`, so a transport failure
  propagates instead of being mistaken for an API answer.
- It branches on `type` where a type exists and falls back to `status` where one may not.
- It reuses the same `Idempotency-Key` on the retry. That is the whole point of the key.

## Next

- [TypeScript SDK reference](/en/reference/typescript-sdk) - every method, type, and helper.
- [Authentication](/en/get-started/authentication) - why a cross-tenant id is a 404.
- [Agents](/en/build/agents) - start, stop, and the `config_version` semantics behind this page.
