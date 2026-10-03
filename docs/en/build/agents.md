---
description: Create, configure, start, update, and delete agents, including versioned response shapes.
---

# Agents

An agent is a persistent configuration object: a name, a model, persona documents, labels,
and a tool policy. You create it once, start it, and then open [sessions](./sessions.md) against
it. The configuration lives on the server, so every session inherits it without you resending
anything.

Examples reuse the client and Agent from [Quickstart](../get-started/quickstart.md). Python calls run inside an async function. For curl, complete the environment setup in [Authentication](../get-started/authentication.md).

## Setup

Every snippet on this page assumes this client.

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

```python [Python]
from zoowork import create_zoowork_client

client = create_zoowork_client()
```

```bash [curl]
export AGENT_ID='your-agent-id'
```

:::

## Create an agent

`createAgent(input, idempotencyKey?)` takes a `resource` (the configuration) and returns an
`AgentRecord`.

::: code-group

```ts [TypeScript]
import type { AgentRecord } from '@zoowork-ai/sdk'

const models = await zc.listModels()
const primary = models.find(
  (model) => model.model === 'litellm/gpt-5.6-terra' && model.selectable !== false,
)?.model
if (!primary) throw new Error('Choose a model returned by listModels()')

const created: AgentRecord = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary },
      labels: { app: 'my-app' },
    },
  },
  'provision-research-agent-1', // Idempotency-Key
)

const agentId = created.agent_id
console.log(agentId, created.config_version)

await zc.startAgent(created.agent_id)
await zc.waitUntilRunning(created.agent_id)
```

```python [Python]
models = await client.list_models()
primary = next(
    (model["model"] for model in models
     if model["model"] == "litellm/gpt-5.6-terra" and model.get("selectable") is not False),
    None,
)
if primary is None:
    raise RuntimeError("Choose a model returned by list_models()")
created = await client.create_agent(
    {"name": "research-agent", "model": {"primary": primary}, "labels": {"app": "my-app"}},
    idempotency_key="provision-research-agent-1",
)
agent_id = created["agent_id"]
print(agent_id, created.get("config_version"))
await client.start_agent(created["agent_id"])
await client.wait_until_running(created["agent_id"])
```

```bash [curl]
models=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
MODEL=$(jq -er '(if type == "array" then . else .models end) | [.[] | select(.model == "litellm/gpt-5.6-terra" and .selectable != false)][0].model' <<<"$models")
agent=$(jq -n --arg model "$MODEL" \
  '{resource:{name:"research-agent",model:{primary:$model},labels:{app:"my-app"}}}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Idempotency-Key: provision-research-agent-1' \
    -H 'Content-Type: application/json' --data-binary @-)
AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

A newly created Agent is stopped. Call `startAgent()` and wait for
`status.desired_state === 'running'` before creating a Session. `waitUntilRunning()` performs
that readiness check. The onboarding interview is skipped, so the first message starts the task.

The `Idempotency-Key` is scoped to `agent.create + key`: the same key and body return the
first response; a different body with that key returns `409`. See [Errors](../reference/errors.md).

Next, [create a Session](./sessions.md) against `created.agent_id`.

See [Models](../reference/models.md) for catalog fields, model selection, and lifecycle behavior.

The whole `model` section is optional. If you omit it, create pins the platform defaults current
at that moment. Defaults can differ by deployment and change over time. Use `listModels()` and
persist an explicit selection when repeatable provisioning matters.

For persona documents, Skills, tools, and sandbox settings, see [Resource fields](#the-resource-fields).

## Read an agent

`getAgent()` returns the current configuration in `declared` and lifecycle state in `status`:

::: code-group

```ts [TypeScript]
const agent = await zc.getAgent(created.agent_id)
console.log(agent.declared?.name, agent.status?.desired_state)
```

```python [Python]
agent = await client.get_agent(created["agent_id"])
print(agent.get("declared", {}).get("name"), agent.get("status", {}).get("desired_state"))
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

A non-existent, soft-deleted, or other-tenant Agent id returns `404 not_found`.
The create receipt has a different shape; see [Response shapes](#read-an-agent-and-the-two-response-shapes).

## Update an agent

`updateAgent(agentId, sections)` PUTs the declared sections you name. It returns the read
projection.

**Sections you omit are preserved.** Top-level object sections are merged one level deep;
arrays and scalars inside them replace the old value.

::: code-group

```ts [TypeScript]
// Before: labels are { tier: 'free', region: 'apac' }.
// This PUT sends only `labels`.
const updated = await zc.updateAgent(agent.agent_id, {
  labels: { tier: 'paid' },
})

console.log(Object.keys(updated.declared ?? {}))
// [ 'name', 'model', 'imageModel', 'imageGenerationModel', 'pdfModel', 'persona', 'labels', 'sandbox', ... ]

console.log(updated.declared?.name)   // 'research-agent'  - survived
console.log(updated.declared?.model)  // { primary: 'litellm/gpt-5.6-terra', ... } - survived
console.log(updated.declared?.labels) // { tier: 'paid', region: 'apac' } - region survives
```

```python [Python]
updated = await client.update_agent(agent["agent_id"], {"labels": {"tier": "paid"}})
print(updated.get("declared", {}).get("labels"))
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "labels": {
    "tier": "paid"
  }
}
JSON
```

:::

`declared` is wider than what you sent. `imageModel`, `imageGenerationModel` and `pdfModel` are
server-side defaults that appear there on every read; they are not members of `AgentResource`,
and sending them is a type error.

`name`, `model` and `persona` are untouched because they were omitted. Plain-object sections
merge one level: omitted label keys survive. It is not recursive deep merge: an explicitly
supplied `persona.docs` array replaces the previous array.

### `tool_policy` and `system_prompt` are replaced wholesale

Two sections are exceptions to the merge: every PUT that names `tool_policy` or
`system_prompt` replaces the whole object. See [Tools](./tools.md).

So there is no partial write for either. To add to a policy, read the current one out of
`declared` and send the union yourself.

### Configuration writes increment the version

`config_version` increments on configuration writes, including byte-identical values. A write
that changes only `visibility` or `project_id` does not increment it. Empty PUTs still rerender
and increment the version.

```ts
const configVersion = (a: AgentRecord): number | undefined =>
  a.status?.config_version ?? a.config_version

const before = configVersion(await zc.getAgent(agentId))          // 4
await zc.updateAgent(agentId, { labels: { probe: 'x' } })
const first = configVersion(await zc.getAgent(agentId))           // 5
await zc.updateAgent(agentId, { labels: { probe: 'x' } })         // identical body
const second = configVersion(await zc.getAgent(agentId))          // 6 - bumped anyway
```

Avoid a PUT on every turn when the configuration has not changed. `config_version` is a
monotonic counter, not a receipt for your own write: the first read can already have a higher
version than the create receipt. The next turn reads the new version; turns already in flight
keep the old one. See [Errors](../reference/errors.md).

### What a PUT rejects

`skills`, `credentials`, and any unknown field in the PUT body return `400`. Skills
are managed through their own routes - see [Skills](./skills.md).

### Manage configuration changes

`config_version` increases after each update, but it is not a configuration-history API.
Store the previous configuration in your application if you need comparison or rollback.

`updateAgent()` accepts the optional `expected_config_version` field. Read the active version,
send a positive integer with the update, and handle `409 active_config_changed` by reading
fresh state before deciding whether to retry. The check is atomic with the write. The field
is not stored in `declared`. Omit it for last-write-wins behavior.

## Agent lifecycle

### Start the agent

`startAgent()` sets `desired_state` to `running`; `stopAgent()` sets it to `stopped`.
Session calls require the running desired state.

| Field | Meaning | Values |
|---|---|---|
| `desired_state` | Lifecycle intent and API readiness. | `running`, `stopped`, `deleted` |
| `actual_state` | Best-effort chat-channel health. | `activating`, `active`, `degraded`, `error`, `stopped`, `deleting` |

Use `waitUntilRunning()` to poll `desired_state`, rather than `actual_state`. Its default
budget is 30 seconds, with 500 ms between polls. For timeout and cancellation options, see the
[SDK reference](../reference/typescript-sdk.md#startagent-agentid).

Successful start/stop calls return `{ warnings: string[] }`. Inspect warnings in context;
non-2xx responses throw `ZooworkError`. A failed stop may already have changed `desired_state`,
so read back before retrying. That state alone does not prove resource cleanup.

### Stop and delete

::: code-group

```ts [TypeScript]
const { warnings } = await zc.stopAgent(agentId)
// HTTP failure throws; read back before deciding to retry.
```

```python [Python]
result = await client.stop_agent(agent_id)
print(result["warnings"])
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

After a stop, `createSession()` on that agent returns `409 agent_not_running` again.

`deleteAgent()` is a **soft delete**. It marks the agent runtime deleted and returns `204`.
It does not stop the agent, does not cancel running workflows, does not delete schedules, and
does not release the sandbox. Deleting without stopping leaves resources running that you can
no longer address.

::: code-group

```ts [TypeScript]
await zc.stopAgent(agentId)   // do this first
await zc.deleteAgent(agentId) // then this
```

```python [Python]
await client.stop_agent(agent_id)
await client.delete_agent(agent_id)
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" &&
curl -sS --fail-with-body --request DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Repeated deletes also return `204`. After deletion, `getAgent()` returns `404 not_found`.

## Skills on an agent

Three methods, covered in full on [Skills](./skills.md).

::: code-group

```ts [TypeScript]
const skills = await zc.listAgentSkills(agentId)                 // attached skills, resolved and merged
await zc.putAgentSkill(agentId, 'skl_visible', { enabled: true }) // configure a visible Skill
await zc.deleteAgentSkill(agentId, 'skl_visible')                 // detach it
```

```python [Python]
skills = await client.list_agent_skills(agent_id)
await client.put_agent_skill(agent_id, "skl_visible", enabled=True)
await client.delete_agent_skill(agent_id, "skl_visible")
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
SKILL_ID='skl_visible'
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' -d '{"enabled":true}'
curl -sS --fail-with-body --request DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Global Skills are available by default. You can configure assignments for Skills visible to your key; see [Skills](./skills.md).

## List your agents

`listAgents({ labels, page })` lists Agents within your key's scope. Use labels to find Agents
created for an application or workspace.

::: code-group

```ts [TypeScript]
for await (const agent of zc.listAgents({ labels: { workspace_id: 'wsp_example' } })) {
  console.log(agent.agent_id)
}
```

```python [Python]
async for agent in await client.list_agents(labels={"workspace_id": "wsp_example"}):
    print(agent["agent_id"])
```

```bash [curl]
page=1
while true; do
  result=$(curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/agents" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    --data-urlencode 'label.workspace_id=wsp_example' \
    --data-urlencode "page=$page") || break
  jq -r '.agents[].agent_id' <<<"$result"
  next_page=$(jq -r 'if .page * .page_size < .total then .page + 1 else empty end' <<<"$result")
  [ -n "$next_page" ] || break
  page=$next_page
done
```

:::

API keys limit reads and lists to the key owner and Project.

The API uses numeric pages starting at 1, with 100 items per page. Pagination is not a
snapshot: concurrent additions or deletions can shift results between pages. See the
[SDK pagination reference](../reference/typescript-sdk.md#listagentsopts) for page objects,
continuation, and migrating array callers.

## The `resource` fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required, non-empty. |
| `model.primary` | string | Model alias in `provider/model-id` form, e.g. `litellm/gpt-5.6-terra`. A bare name is normalized to `litellm/<model-id>`. Get the list from `listModels()`. |
| `model.input` | `string[]` | `text` and/or `image`. Declaring `image` says the primary model reads images itself. |
| `model.max_tokens` | integer | Output-token cap per model request. Omit to use the platform default; invalid values are rejected at create. |
| `userTimezone` | string | Named IANA timezone such as `Asia/Shanghai`. It sets the user's timezone in prompt context and message timestamps; Schedule timezone remains a separate setting. |
| `persona.docs[]` | `{ name, content, seed_policy? }[]` | Guidance documents. Only inline `content` is stored. Only the canonical names are read when the prompt is assembled: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`. Other names are saved but never reach the model. `MEMORY.md` and the `memory/` namespace are reserved and return `400 invalid_persona_doc_name`. |
| `skills` | array | Skills to install explicitly. Passing `[]` opts this Agent out of automatically attached global Skills. |
| `include_global_skills` | boolean | Defaults to `true`. Set `false` to disable automatic global Skills while keeping explicitly installed Skills. The setting persists across later updates and rerenders. |
| `labels` | `Record<string, string>` | Your own key-value tags. Filterable with `listAgents({ labels })`. |
| `tool_policy` | object | `{}` adds no policy restriction; runtime and configuration gates still apply. Exact names, global `*`, and one trailing `prefix*` are supported in the policy fields; `alsoAllow` remains exact-only. See [Tools](./tools.md). |
| `sandbox.scope` | `'agent' \| 'session'` | Whether the sandbox runtime is shared across sessions or created per session. Defaults to `agent`. The persisted workspace still belongs to the Agent. See [Cloud sandbox](./cloud-sandbox-reference.md). |
| `mcp` | array | Remote MCP server declarations, including exposure, runtime context, and approval policies. See [MCP servers](./mcp.md) and [Permission policies](./permissions.md). |
| `custom_tools` | array | Tools your application executes while the run waits for a result. See [Tools](./tools.md#application-executed-custom-tools). |

`skills` at create time installs Skills, but the create receipt and `getAgent().declared` do
not echo the assignments. Confirm them with `listAgentSkills(agentId)`.
`environment_id` and `environment_version` are also supported; see [Environments](./environments.md).

## Read an agent, and the two response shapes

`POST /agents` answers
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
    model: { primary: 'litellm/gpt-5.6-terra', input: ['text', 'image'] },
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

## Next

- [Sessions](./sessions.md) - open a session against a running agent and drive a turn.
- [An agent per user](./per-user-agents.md) - the multi-user shape for when users must not share sandbox files and memory.
- [Events and streaming](./events.md) - read what the agent does, with resumable SSE.
- [Skills](./skills.md) - what is attached by default and what you can change.
- [Errors](../reference/errors.md) - the `ZooworkError.type` values worth branching on.
