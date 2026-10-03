---
description: Use default global Skills, inspect attached Skills, and manage existing visible Skill assignments.
---

# Skills

A Skill is a `SKILL.md` file and supporting files that teach an Agent how to perform a task.
The model reads the Skill when its description fits the task. Skills provide instructions;
they do not add a callable tool or grant tool permissions.

Skills attach to an Agent. All its Sessions use the same attached set; there is no
per-Session Skill override.

## API availability

Use a Platform API key from [ZooWork Platform](https://platform.zoowork.ai).
These keys can inspect an Agent's attached Skills and manage assignments to existing Skills
visible within the key's scope. They cannot list the root Skill registry, upload a custom
Skill, publish a version, or delete a registry entry.

Start with the default global Skills. For shared product instructions, use
[persona documents](./agents.md#the-resource-fields) in your application-owned Agent template;
see [An Agent per user](./per-user-agents.md). See
[Authentication](../get-started/authentication.md) for key setup and scope.

Examples reuse the client and Agent from [Quickstart](../get-started/quickstart.md).
In TypeScript, set `const agentId = agent.agent_id`; Python reuses `agent_id` and runs inside
an async function. The curl examples reuse your configured
`ZOOWORK_API_KEY`, `ZOOWORK_BASE_URL`, and `AGENT_ID`.

## Global skills are attached automatically

New Agents include the platform's global Skills by default. The catalog can include document
Skills such as `docx`, `pptx`, `xlsx`, and `pdf`; list the attached set instead of relying
on a fixed count.

Set `include_global_skills: false` in the Agent resource to opt out of automatic global
Skills while keeping explicit assignments. An explicit `skills: []` also opts out, but
makes the exact Skill list part of the Agent's declared configuration; separate assignment
calls can then return `409 source_owned_skills`.

## Inspect attached skills

List the effective Skills on your Agent:

::: code-group

```ts [TypeScript]
const skills = await client.listAgentSkills(agentId)
for (const skill of skills) {
  console.log(skill.skill_id, skill.name, skill.version, skill.eligible)
}
```

```python [Python]
skills = await client.list_agent_skills(agent_id)
for skill in skills:
    print(skill["skill_id"], skill["name"], skill["version"], skill["eligible"])
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Both SDKs return an array. The HTTP response wraps it as `{skills: [...]}`.
Each entry includes its `skill_id`, name, scope, version, and eligibility.

## How the Agent reads a Skill

The initial prompt includes each effective Skill's name, description, and location. When a
task fits, the model can read `SKILL.md`, follow references, and run scripts as needed.

A Skill teaches the Agent to use capabilities it already has. `read` can read Skill files;
`write`, `edit`, and `apply_patch` cannot modify Skill directories. Put generated output
in writable sandbox roots. Scripts still require permitted tools, installed software, and
network access. An install step in metadata does not run automatically.

## Installing and removing

Use an existing `skill_id` visible to your key and Agent. This operation changes an assignment;
it does not create or upload a Skill. Take IDs from attached entries or a known existing Skill
in your application, rather than calling the unavailable root registry.

Set `skillId` in TypeScript, `skill_id` in Python, or `SKILL_ID` in curl to that ID.

To pin an assignment, use a ready version of that Skill. Replace `1` below with the version
you intend to use:

::: code-group

```ts [TypeScript]
const receipt = await client.putAgentSkill(agentId, skillId, {
  enabled: true,
  versionPin: 1,
})
console.log(receipt.config_version, receipt.warnings)
```

```python [Python]
receipt = await client.put_agent_skill(
    agent_id, skill_id, enabled=True, version_pin=1
)
print(receipt.get("config_version"), receipt.get("warnings"))
```

```bash [curl]
curl -sS --fail-with-body --request PUT \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"version_pin":1}'
```

:::

| Setting | TypeScript | Python / HTTP | Behavior |
|---|---|---|---|
| Enable the assignment | `enabled` | `enabled` | The SDKs default to `true`; HTTP requires a boolean. `false` disables it. |
| Pin a ready version | `versionPin` | `version_pin` | A version number pins that version; omitted or `null` follows latest ready. |

When a new ready version becomes available, unpinned mutable assignments follow it
asynchronously. The Agent reloads its configuration at a turn boundary; an in-flight turn
can finish with the earlier version. Read the attached list to confirm the effective version.

To remove an assignment:

::: code-group

```ts [TypeScript]
await client.deleteAgentSkill(agentId, skillId)
```

```python [Python]
await client.delete_agent_skill(agent_id, skill_id)
```

```bash [curl]
curl -sS --fail-with-body --request DELETE \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Removing an `org`, `project`, or `personal` assignment detaches that Skill from the Agent.
Removing a global assignment restores the Agent's default global-Skill policy; it does not
delete the platform catalog entry.

Each successful assignment write or removal increments `config_version`, even when the
values are unchanged. Inspect returned warnings. After a timeout, read the attached list and
reconcile the result before retrying. Read the list again after removal as well.

## Inspect Skill details

Use verbose results to include disabled, shadowed, or ineligible entries:

::: code-group

```ts [TypeScript]
const entries = await client.listAgentSkills(agentId, { verbose: true })
console.log(entries)
```

```python [Python]
entries = await client.list_agent_skills(agent_id, verbose=True)
print(entries)
```

```bash [curl]
curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'verbose=true'
```

:::

Entries can include `description`, `location`, `basePath`, `contentHash`, `promptVersion`,
and a file manifest with `path`, `size`, and `sha256`. These describe resolved configuration,
not a filesystem check of the current sandbox.

`scope` describes visibility:

| Scope | Visibility |
|---|---|
| `global` | Platform-managed catalog. |
| `org` | Shared within the organization. |
| `project` | Limited to its organization and Project. |
| `personal` | Owned by the key's owner, with no organization or the key's organization. |

Assignment access is checked against both the key and the Agent. Knowing a Skill ID does
not grant access to it.

### Diagnose the effective set

The default list contains the effective, prompt-visible set. Verbose results can include
`excluded` to explain why an entry is absent. `eligible` describes the requirements check;
it does not confirm delivery or model use.

The prompt includes at most 64 Skills in stable name order. Extra entries have
`excluded: 'truncated'`. A session-scope sandbox excludes personal-scope Skill locations;
verbose results can show `excluded: 'mount-scope'`.

A binary requirement can carry `eligibility: 'unverified'`; this does not mean the required
command is installed. Check the software in [Cloud sandbox reference](./cloud-sandbox-reference.md).
For capabilities the sandbox cannot provide, expose an
[application-executed tool](./tools.md#application-executed-custom-tools).

## Handle assignment errors

Unknown or inaccessible Skill IDs return `404`. Check key scope and the Skill's visibility
before retrying. Registry operations remain unavailable with Platform API keys.

If an assignment call returns `409 source_owned_skills`, the exact Skill list belongs to
the Agent's declared configuration. Change that configuration through the application that
manages the Agent instead of retrying the separate assignment call. Versions in that exact
list do not automatically follow registry updates.

## Test a Skill

Use fresh Sessions for tasks that should use the Skill, unrelated tasks, and tasks that
overlap other attached Skills. Check the answer or output against the expected facts and
format. Keep the Skill version, Agent configuration version, and model with the result.

An attached entry or `eligible: true` does not show that the model read the Skill. The event
stream has no dedicated Skill-selection event. Tool-read activity and the resulting answer
can help you check its use.

## Related

- [An Agent per user](./per-user-agents.md) — share an application-owned configuration template.
- [Agents](./agents.md) — configuration versions and update behavior.
- [Tools](./tools.md) — callable capabilities and permission policies.
