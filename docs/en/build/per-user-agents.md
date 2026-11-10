---
description: Separate application users with isolated Sessions or a separate Agent per user, and authorize access through your backend.
---

# An agent per user

When one product serves many users, choose how their data is separated. A Session created
with `isolation: "session"` gets its own workspace and Memory inside a shared Agent. A separate
Agent per user also separates the Agent Database, persona documents, Schedules, and files that
should persist across that user's conversations. Either way, your backend keeps the mapping
from users to Agents and Sessions and authorizes each request.

Keep shared instructions, model selection, and tool policy in an application-owned
configuration template. Each user's Agent receives its own copy.

## Workspace isolation

A Session's `isolation` is chosen when it is created and never changes. Without Vault fields,
omitting it records `shared`. With [Vault](./vault.md) fields, an omitted `isolation` is
currently recorded as `session`; send it explicitly in that case.

With `shared`, a Session separates conversation history only. All `shared` Sessions of an Agent
use the Agent's `/workspace`, including when `sandbox.scope` is `session`, and the Agent's
`agent`-scoped Memory. API messages can select memory attribution with
`actor: { ref: 'customer-42' }`; omitting it uses the owner. An actor does not authorize access,
clear an existing transcript, or isolate files. See [Events](./events.md#user-message) and
[Memory](./memory.md).

### Session isolation

Create the Session with `isolation: "session"`:

::: code-group

```ts [TypeScript]
const session = await client.createSession(agentId, {
  isolation: 'session',
  initial_events: [{ type: 'user.message', content: 'Summarize my notes.' }],
})
```

```python [Python]
session = await client.create_session(agent_id, {
    "isolation": "session",
    "initial_events": [{"type": "user.message", "content": "Summarize my notes."}],
})
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"isolation":"session","initial_events":[{"type":"user.message","content":"Summarize my notes."}]}'
```

:::

The TypeScript `isolation` input type requires SDK 0.15.0 or later.

An isolated Session gets:

- its own sandbox and its own `/workspace` directory. Other Sessions of the Agent, and the
  Agent workspace, cannot see its files;
- its own Memory. Memory tools read and write only this Session's memory; they cannot read or
  write the Agent's `agent` scope or any actor's memory, and `actor.ref` does not change this;
- its own large-result files and Artifacts. Artifacts it publishes are not returned by the
  Agent-level `listArtifacts`; they are listed under
  `/agents/{agent_id}/sessions/{session_id}/artifacts` and are removed with the Session;
- Sessions it spawns with `sessions_spawn` share its workspace and Memory. Spawning a Session of
  another Agent is refused.

Deleting an isolated Session also deletes the Sessions it spawned: their running work is
cancelled and later reads of them return `404`. The workspace directory and Memory of the deleted
Sessions are removed after a retention period.

Session isolation does not separate:

- the Agent's configuration, persona documents, Skills, and Schedules. An isolated Session can
  read the persona documents but cannot change them, and it does not run onboarding: an Agent
  that is waiting for onboarding stays waiting until a `shared` Session completes it;
- the [Agent Database](./data-storage.md), which every Session of the Agent can use;
- files you add with `uploadFile` or `exec`. Both write to the Agent workspace, which an
  isolated Session does not mount. Put small inputs in the message text instead;
- the Agent owner's credentials; see
  [Owner credentials are not isolated](./vault.md#owner-credentials).

Each isolated Session starts with an empty workspace and empty Memory. A user's later
conversation does not see files or facts from their earlier Session.

To give an isolated Session per-user credentials for an MCP server, attach a
[Vault (beta)](./vault.md).

### When to use an Agent per user

Use a separate Agent for each user when any of these must belong to one user:

- files and Memory that persist across that user's conversations;
- Agent Database rows;
- persona documents the Agent updates, onboarding, or Schedules;
- accounts the Agent owner connects, or Skills that use them.

Isolated Sessions fit when each conversation is a self-contained task and users share one Agent
definition. In both designs, authorize every Agent and Session access in your backend.

## Provision an Agent for each user

Create a Platform API key in [ZooWork Platform](https://platform.zoowork.ai), then complete
[Quickstart](../get-started/quickstart.md) to set up your SDK client or curl environment.

The examples use your application's authenticated user ID, mapping store, and shared
`STABLE_PERSONA` instructions. `yourDb` and `your_db` stand for your own database access
layer; their methods are application code. Python calls run inside an async function.

Read the existing mapping first. Create an Agent only when that user has no mapped Agent ID:

::: code-group

```ts [TypeScript]
const existingAgentId = (await yourDb.users.findById(user.id))?.agent_id
let agentId = existingAgentId

if (!agentId) {
  const agent = await client.createAgent(
    {
      resource: {
        name: `myproduct-${user.id}`,
        labels: { end_user: user.id },
        persona: { docs: [{ name: 'AGENTS.md', content: STABLE_PERSONA }] },
      },
    },
    `user-${user.id}`,
  )
  agentId = agent.agent_id
  await yourDb.users.update(user.id, { agent_id: agentId })
}

await client.startAgent(agentId)
await client.waitUntilRunning(agentId)
```

```python [Python]
existing = await your_db.users.find_by_id(user_id)
agent_id = existing.get("agent_id") if existing else None

if not agent_id:
    agent = await client.create_agent(
        {
            "name": f"myproduct-{user_id}",
            "labels": {"end_user": user_id},
            "persona": {
                "docs": [{"name": "AGENTS.md", "content": STABLE_PERSONA}]
            },
        },
        idempotency_key=f"user-{user_id}",
    )
    agent_id = str(agent["agent_id"])
    await your_db.users.update(user_id, {"agent_id": agent_id})

await client.start_agent(agent_id)
await client.wait_until_running(agent_id)
```

```bash [curl]
# Your backend supplies USER_ID, STABLE_PERSONA, and any EXISTING_AGENT_ID.
AGENT_ID="${EXISTING_AGENT_ID:-}"
if [[ -z "$AGENT_ID" ]]; then
  agent=$(jq -n \
    --arg name "myproduct-$USER_ID" \
    --arg user_id "$USER_ID" \
    --arg persona "$STABLE_PERSONA" \
    '{resource:{
      name:$name,
      onboarding:false,
      labels:{end_user:$user_id},
      persona:{docs:[{name:"AGENTS.md",content:$persona}]}
    }}' |
    curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
      -H "Authorization: Bearer $ZOOWORK_API_KEY" \
      -H 'Content-Type: application/json' \
      -H "Idempotency-Key: user-$USER_ID" \
      --data-binary @-)
  AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
  # Save AGENT_ID in your application's user mapping before continuing.
fi

curl -sS --fail-with-body --request POST \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"

(
  readiness_deadline=$((SECONDS + 30))
  while (( SECONDS < readiness_deadline )); do
    current=$(curl -sS --fail-with-body --max-time 5 \
      "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
      -H "Authorization: Bearer $ZOOWORK_API_KEY") || exit 1
    if jq -e '.status.desired_state == "running"' <<<"$current" >/dev/null; then
      exit 0
    fi
    sleep 1
  done
  echo 'Agent did not reach running before the deadline.' >&2
  exit 1
)
```

:::

The curl tab shows the HTTP calls; your application still reads and writes the user mapping
around them. Check each request succeeds before continuing. Save a newly returned Agent ID
before opening the first Session.

Reuse the same create idempotency key and body for retries. Serialize provisioning for each
user when concurrent requests can reach this code, and serialize `createAgent()` calls across
the whole organization: parallel creates in one organization can fail with
`503 platform.runtime_credentials_unavailable` without creating an Agent. See
[Errors](../reference/errors.md#platform-and-usage-errors). Treat the mapping as the source of truth.
If the mapped Agent has been deleted or is inaccessible, reconcile the mapping before
creating a replacement.

`labels.end_user` helps recovery within your key's list scope; it does not authorize access.
A new Agent is stopped. Start it and wait for `status.desired_state: 'running'` before
[creating its first Session](./sessions.md).

## Authorize each Agent and Session request

Keep the Platform API key in your backend. The browser sends tasks to your application,
which looks up the authenticated user's Agent ID and checks Session ownership before calling
`createSession`, `postEvents`, or `streamEvents`.

Do not accept arbitrary Agent or Session IDs without checking the mapping. Labels and message
actors are metadata, not authorization boundaries. The key's organization, Project, and owner
scope still apply; see [Authentication](../get-started/authentication.md).

## Update the shared configuration template

When the template changes, read each Agent's declared configuration, compare the relevant
sections, and update only those that differ. For Agents created by the template above,
the persona update is:

::: code-group

```ts [TypeScript]
await client.updateAgent(agentId, {
  persona: { docs: [{ name: 'AGENTS.md', content: STABLE_PERSONA }] },
})
```

```python [Python]
await client.update_agent(
    agent_id,
    {"persona": {"docs": [{"name": "AGENTS.md", "content": STABLE_PERSONA}]}},
)
```

```bash [curl]
jq -n --arg persona "$STABLE_PERSONA" \
  '{persona:{docs:[{name:"AGENTS.md",content:$persona}]}}' |
  curl -sS --fail-with-body --request PUT \
    "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

:::

The `persona.docs` array is replaced. If an Agent has additional persona documents, include
the complete intended list. Omitted sections are preserved, while `tool_policy` is replaced
as a whole. Serialize updates for each Agent and retain the complete policy.

Avoid writing Agents that already match the template: even an identical update increments
`config_version`. See [Update an Agent](./agents.md#update-an-agent).

### Canary before fleet-wide

Apply a template change to a small set of Agents first. Test fresh Sessions with representative
tasks and compare the resulting behavior with the intended instructions. After the check,
update the remaining Agents and record which template revision each mapping uses.

Keep per-turn context in the Session. What a user just selected or which plan they are on
belongs in a Session message, rather than a rewrite of every Agent's persona.

## Skills

Default global Skills are available without publishing your own Skill. For packaged application
instructions and resources, upload a Skill once and bind its ID to Agents within the allowed
scope. A named Project key writes project Skills; a Default Project key writes org Skills shared
across its Organization. This requires a deployment with Project-key registry support.
Keep persona instructions in the shared configuration template. See [Skills](./skills.md) for
upload, version pinning, deployment verification, and read/write permissions.

## Related

- [Skills](./skills.md) — default global Skills and existing assignments.
- [Agents](./agents.md) — configuration versions, start/stop, and desired state.
- [Sessions](./sessions.md) — separate conversations within an Agent.
- [Files and artifacts](./files.md) — persistence and file isolation.
- [Vault (beta)](./vault.md) — per-user MCP credentials for isolated Sessions.
