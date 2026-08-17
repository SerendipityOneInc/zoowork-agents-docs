# Quickstart

Create an agent, start it, open a session, and stream the reply. About five minutes end to end.

::: tip Teach your coding assistant first
```bash
npx skills add SerendipityOneInc/zoowork-sdk-skills
```
Your assistant then knows this API before it writes a line — which calls exist, which do not,
and the places where code that looks right fails at runtime. It installs into Claude Code,
Codex, Cursor and 70-odd others, each in the directory it reads. Needs Node 22.20 or later.

Would you rather start from something that already runs? Three templates live in
[zoowork-quickstarts](https://github.com/SerendipityOneInc/zoowork-quickstarts): `chat/` talks
to an agent you already have, `skill-lab/` builds one and uploads a skill to it, and `app-kit/`
is the production reference with auth and persistence.
:::

## Prerequisites

- **Node 20 or later.** `@zooclaw-agents/sdk` is an ES module with no runtime dependencies; it uses the platform `fetch`.
- **An API key** that looks like `zct_...`. An organization administrator issues it for your organization and hands it to you. There is no self-serve signup page.

Keep the key server-side. It authenticates as your whole organization, not as one end user.

```bash
export ZOOCLAW_API_KEY='zct_...'
```

That is the only thing you configure. The SDK already knows the endpoint; you never set
a base URL unless you are targeting a different deployment.

Every step below is shown in both TypeScript and `curl`. The `curl` tab exists so you can
follow along from any language: it is the same HTTP the SDK makes. It needs the endpoint
spelled out, so for those examples also export:

```bash
export ZOOCLAW_BASE_URL='https://claw-interface.ecap.yesy.live/service/v1'
```

Pick a tab once and every code block on the page follows.

## Install

::: code-group

```bash [pnpm]
pnpm add @zooclaw-agents/sdk
```

```bash [npm]
npm install @zooclaw-agents/sdk
```

```bash [yarn]
yarn add @zooclaw-agents/sdk
```

:::

To run the TypeScript in this page directly:

```bash
pnpm add -D typescript tsx @types/node
```

The SDK ships ESM only. Set `"type": "module"` in your `package.json` so `import` works and top-level `await` is available.

## Create a client

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })
```

With `ZOOCLAW_API_KEY` exported you can drop the argument entirely — `createZooclawClient()`
reads it. The only other options are `baseUrl` (defaults to the public gateway, or
`ZOOCLAW_BASE_URL`) and an injected `fetch` for edge runtimes and tests.

A missing key throws at construction rather than surfacing as a 401 on your first call.

The cheapest check that your key works is `listModels()` - it needs no agent and no session:

::: code-group

```ts [TypeScript]
const models = await zc.listModels()
console.log(models.length, models[0]?.model)
```

```bash [curl]
curl "$ZOOCLAW_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY"
```

:::

```json
[
  { "model": "litellm/claude-sonnet-5", "display_name": "Claude Sonnet 5", "family": "anthropic", "api": "anthropic-messages" }
]
```

A bad key returns `401`. The SDK throws `ZooclawError` with `.status` and `.type` - match on `.type`, never on the message text.

## 1. Create an agent

An agent is a persistent, versioned configuration object. `name` and `model.primary` are enough.

::: code-group

```ts [TypeScript]
const created = await zc.createAgent({
  resource: {
    name: 'quickstart-agent',
    model: { primary: models[0]?.model ?? 'litellm/claude-sonnet-5' },
  },
})

const agentId = created.agent_id
```

```bash [curl]
curl -X POST "$ZOOCLAW_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": {
      "name": "quickstart-agent",
      "model": { "primary": "litellm/claude-sonnet-5" }
    }
  }'
```

:::

Ownership is handled for you: the gateway derives the tenant anchors from your API key and returns them in the receipt's `ownership`.

The response is a flat **create receipt**:

```json
{
  "agent_id": "agt_example",
  "computer_id": "cmp_example",
  "config_version": 1,
  "resolved_skills": [],
  "ownership": { "owner_uid": "usr_example", "org_id": "org_example" }
}
```

Two things to know about this shape:

- The receipt is not the same shape as a read. `getAgent()` returns a projection where the configuration lives under `declared` and the version lives at `status.config_version` - there is no top-level `config_version` or `name` on the read path. Read it as `agent.status?.config_version ?? agent.config_version`.
- `config_version` in the receipt is already stale by the time you read it back. The gateway writes platform credentials for you immediately after create, and each write bumps the version, so a `getAgent()` one second later typically reports `3`. Do not use the version as an idempotency receipt.

Pass an idempotency key as the second argument if you want a create you can safely retry:

```ts
const agent = await zc.createAgent(
  {
    resource: { name: 'quickstart-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  },
  'quickstart-run-01', // your idempotency key
)
```

The uniqueness domain is `(agent.create, key)`. The same key with a different body returns `409 idempotency_conflict`.

## 2. Start the agent

::: warning Do not skip this step
A newly created agent has `status.desired_state === 'stopped'`. Every session call requires `running`. If you go straight to `createSession()`, the SDK throws a `ZooclawError` with `status === 409` and `type === 'agent_not_running'`:

```ts
import { ZooclawError } from '@zooclaw-agents/sdk'

try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooclawError && e.type === 'agent_not_running') {
    // You forgot startAgent(). Match on e.type, not on e.message.
  }
}
```

Creation and starting are separate on purpose; code that assumes a created agent is live
fails here.
:::

::: code-group

```ts [TypeScript]
const { warnings } = await zc.startAgent(agentId)
console.log(warnings)
```

```bash [curl]
curl -X POST "$ZOOCLAW_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY"
```

:::

```json
{ "warnings": ["channel_routes_reload_failed: routes reload returned 404"] }
```

That warning is expected and harmless. `startAgent` also reloads chat-channel routes; an API-only agent has no channels to reload, so it reports a failure on every start and stop. It is not a startup failure - check `desired_state` instead.

### Wait for readiness

::: danger Poll `desired_state`, never `actual_state`
`actual_state` reports **chat-channel connectivity**, not API readiness. An API-only agent has zero channels, so it sits at `activating` forever and `active` is never reached. `running` is not even a member of the `actual_state` enum (`activating | active | degraded | error | stopped | deleting`). A loop that waits for `actual_state` never returns.

Wait on `status.desired_state === 'running'`. It flips in well under a second.
:::

The SDK ships that loop, so you do not write one:

```ts
const agent = await zc.waitUntilRunning(agentId)
```

It polls `status.desired_state` on a 30-second budget, 500 ms apart, and hands back the same
projection `getAgent()` would. Each poll is bounded by whatever is left of the budget, so a
gateway that accepts the connection and then stalls ends the wait on schedule instead of
hanging it. An agent that never gets there throws a `ZooclawError` with `status === 408` and
`type === 'timeout'`.

A `getAgent()` read right after start looks like this (other fields omitted):

```json
{
  "agent_id": "agt_example",
  "declared": { "name": "quickstart-agent", "model": { "primary": "litellm/claude-sonnet-5" } },
  "status": {
    "desired_state": "running",
    "actual_state": "activating",
    "config_version": 3,
    "channels": { "expected": 0, "connected": 0 }
  },
  "ownership": { "owner_uid": "usr_example", "org_id": "org_example" }
}
```

`actual_state: "activating"` with `channels.expected: 0` is the steady state for an API-only agent. Sessions work fine in it.

## 3. Create a session with an opening message

Sessions hang off an agent: `createSession(agentId, input)`. There is no top-level sessions resource, and the agent id is not in the body.

::: code-group

```ts [TypeScript]
const session = await zc.createSession(agentId, {
  metadata: { source: 'quickstart' },
  initial_events: [{ type: 'user.message', content: 'In one sentence, what can you do?' }],
})

const sessionId = session.session_id
```

```bash [curl]
curl -X POST "$ZOOCLAW_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": { "source": "quickstart" },
    "initial_events": [
      { "type": "user.message", "content": "In one sentence, what can you do?" }
    ]
  }'
```

:::

```json
{
  "session_id": "ses_example",
  "session_key": "api:example",
  "status": "running"
}
```

`initial_events` starts the first turn as part of the create call, so you do not need a separate send. Use `user.message` with string content. For later turns in the same session, call `postEvents(agentId, sessionId, events)`.

The `api:` prefix on `session_key` marks this as an API session. Sessions created through a chat channel carry a different prefix and are a separate conversation with separate memory.

You can pass an idempotency key here too:

```ts
const session = await zc.createSession(agentId, input, 'quickstart-session-01')
```

## 4. Stream until the turn ends

`streamEvents()` is an async generator over the session's durable event log.

::: code-group

```ts [TypeScript]
import { assistantText, isRunFinished, runOutcome, toolCall } from '@zooclaw-agents/sdk'

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined

try {
  for await (const ev of zc.streamEvents(agentId, sessionId, { signal: ctl.signal })) {
    const call = toolCall(ev)
    if (call?.phase === 'start') console.log(`\n[tool] ${call.toolName}`)

    const chunk = assistantText(ev)
    if (chunk) {
      text += chunk
      process.stdout.write(chunk)
    }

    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
} finally {
  clearTimeout(budget)
  ctl.abort()
}
```

```bash [curl]
# -N disables buffering so frames arrive as they are produced.
# Resume after a drop by appending ?after=<last seq you saw>.
curl -N "$ZOOCLAW_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  -H "Accept: text/event-stream"
```

:::

Each iteration yields a normalized `SessionEvent`:

```json
{
  "seq": 5,
  "eventType": "agent.assistant",
  "runId": "run_example",
  "turn": 1,
  "payload": {
    "message": { "role": "assistant", "content": [{ "type": "text", "text": "I can research topics and write code." }] }
  },
  "createdAt": "2026-08-06T08:00:00.000Z"
}
```

A single turn produces an arc like `run.started` -> `agent.lifecycle` -> `agent.item` -> `agent.thinking` -> `agent.assistant` -> `agent.tool` (start/end pairs) -> `agent.lifecycle` -> `run.finished`.

Four things that trip people up:

- **`run.finished` ends the turn, not the stream.** The stream is session-scoped and stays open; the server closes it after an idle period. Break out of the loop yourself when `isRunFinished(ev)` is true, or you will block until the idle timeout.
- **`runOutcome(ev)` is `succeeded | failed | aborted`.** A run can finish `succeeded` even when individual tool calls errored - `toolCall(ev).isError === true` does not fail the run. Do not infer success from the absence of tool errors.
- **`assistantText(ev)` returns `''` for every event that is not `agent.assistant`**, so concatenating it over the whole loop is safe and gives you the full reply.
- **Resume with `after`.** Every frame carries a durable `seq`. If the connection drops, restart the generator with `{ after: lastSeq }` and the server replays from there. Nothing is lost and nothing is duplicated.

```ts
for await (const ev of zc.streamEvents(agentId, sessionId, { after: lastSeq })) { /* ... */ }
```

`listEvents(agentId, sessionId)` reads the same events over REST if you prefer polling. It returns one page - server default 100, maximum 500 - so page with `after` on long sessions rather than assuming you got everything.

## 5. Clean up

::: code-group

```ts [TypeScript]
await zc.stopAgent(agentId)
await zc.deleteAgent(agentId)
```

```bash [curl]
curl -X POST "$ZOOCLAW_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY"

curl -X DELETE "$ZOOCLAW_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY"
```

:::

Stop first. `deleteAgent()` is a soft delete of the control-plane record: it does not stop the agent, cancel schedules, or release the sandbox. An agent you delete without stopping stays running.

`stopAgent()` returns the same informational `channel_routes_reload_failed` warning as start. After a stop, `createSession()` on that agent returns `409 agent_not_running` again.

## The complete program

Save as `quickstart.ts`, then run `ZOOCLAW_API_KEY='zct_...' pnpm exec tsx quickstart.ts`.

```ts
import {
  createZooclawClient,
  ZooclawError,
  assistantText,
  isRunFinished,
  runOutcome,
  toolCall,
} from '@zooclaw-agents/sdk'

const apiKey = process.env.ZOOCLAW_API_KEY
if (!apiKey) throw new Error('set ZOOCLAW_API_KEY')

const zc = createZooclawClient({ apiKey })

// 0. Confirm the key works and pick a model.
const models = await zc.listModels()
const model = models[0]?.model ?? 'litellm/claude-sonnet-5'
console.log(`${models.length} models available, using ${model}`)

// 1. Create the agent. The gateway derives ownership from your API key.
const created = await zc.createAgent({
  resource: {
    name: `quickstart-${Date.now()}`,
    model: { primary: model },
  },
})
const agentId = created.agent_id
console.log(`created agent ${agentId}`)

try {
  // 2. Start it. Without this, createSession returns 409 agent_not_running.
  const { warnings } = await zc.startAgent(agentId)
  if (warnings.length) console.log(`start warnings (expected for API-only agents): ${warnings.join(', ')}`)
  // Readiness is desired_state. waitUntilRunning polls that, never actual_state.
  await zc.waitUntilRunning(agentId)
  console.log('agent is running')

  // 3. Open a session with the first user message already in it.
  const session = await zc.createSession(agentId, {
    metadata: { source: 'quickstart' },
    initial_events: [{ type: 'user.message', content: 'In one sentence, what can you do?' }],
  })
  console.log(`session ${session.session_id}\n`)

  // 4. Stream until run.finished. The stream does not close on its own.
  const ctl = new AbortController()
  const budget = setTimeout(() => ctl.abort(), 120_000)
  let text = ''
  let outcome: 'succeeded' | 'failed' | 'aborted' | undefined

  try {
    for await (const ev of zc.streamEvents(agentId, session.session_id, { signal: ctl.signal })) {
      const call = toolCall(ev)
      if (call?.phase === 'start') console.log(`\n[tool] ${call.toolName}`)

      const chunk = assistantText(ev)
      if (chunk) {
        text += chunk
        process.stdout.write(chunk)
      }

      if (isRunFinished(ev)) {
        outcome = runOutcome(ev)
        break
      }
    }
  } finally {
    clearTimeout(budget)
    ctl.abort()
  }

  console.log(`\n\nrun ${outcome}, ${text.trim().length} characters`)
  if (outcome !== 'succeeded') process.exitCode = 1
} catch (e) {
  if (e instanceof ZooclawError) {
    console.error(`ZooClaw error ${e.status} ${e.type ?? ''}: ${e.message}`)
    process.exitCode = 1
  } else {
    throw e
  }
} finally {
  // 5. Stop before delete. DELETE is a soft delete and does not stop the agent.
  await zc.stopAgent(agentId)
  await zc.deleteAgent(agentId)
  console.log(`cleaned up agent ${agentId}`)
}
```

Expected output:

```
25 models available, using litellm/claude-sonnet-5
created agent agt_example
agent is running
session ses_example

I can research topics, run code, and work with documents.

run succeeded, 57 characters
cleaned up agent agt_example
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401` on every call | Missing or invalid key | Check `ZOOCLAW_API_KEY` starts with `zct_` and reaches the client as `apiKey`. The gateway and the core API use different `error.type` strings for this, so branch on `e.status`, not on the type |
| `409 agent_not_running` on `createSession` | The agent was never started, or was stopped | Call `startAgent()` and wait for `desired_state === 'running'` |
| Readiness loop never returns | Polling `status.actual_state` | Poll `status.desired_state` instead, or let `zc.waitUntilRunning()` do it |
| Stream never ends | Waiting for the connection to close | Break on `isRunFinished(ev)` |
| `404 not_found` on an agent id you have | The id belongs to another organization | Ids are hidden across tenants rather than rejected with 403 |
| `409 idempotency_conflict` | Same `Idempotency-Key`, different body | Use a new key, or send a byte-identical body |

## Next steps

- [Agents](../build/agents.md) - configuration sections, `updateAgent()` merge semantics, and the two response shapes.
- [Sessions](../build/sessions.md) - multi-turn conversations, `postEvents()`, `system.message`, and `user.interrupt`.
- [Events and streaming](../build/events.md) - the full event vocabulary, resume with `after`, and reading history over REST.
- [Not supported](../reference/not-supported.md) - what does not exist here, including client-executed custom tools. Read this before you design around a capability.
