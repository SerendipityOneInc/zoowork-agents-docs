---
description: Package, upload, version, and attach Skills with Project API keys; understand registry permissions and SDK compatibility.
---

# Skills

A Skill is a `SKILL.md` file and supporting files that teach an Agent how to perform a task.
The model reads the Skill when its description fits the task. Skills provide instructions;
they do not add a callable tool or grant tool permissions.

Skills attach to an Agent. All its Sessions use the same attached set; there is no
per-Session Skill override.

## API availability

Use a Platform API key from [ZooWork Platform](https://platform.zoowork.ai).
These keys can inspect attached Skills and manage visible assignments. On deployments with
Project-key Skill registry support, they can also list the registry, upload ZIP packages,
publish versions, and delete Skills within their write scope.

The registry contract below is **source-reviewed, not live-verified by this guide**. Confirm
support on the target deployment before treating the workflow as available there. Older
server deployments reject Project-key registry requests; an SDK method alone does not prove
server support. Read and write permissions differ:

| Key | Create, publish versions, delete |
|---|---|
| Named Project key | `project` Skills in the same Project and Organization. |
| Default Project key | `org` Skills in the same Organization; these are Organization-shared. |

The API derives ownership from the key. A wrong create scope, including `personal` or `global`,
returns `400 service_api.invalid_body`. A visible Skill is not necessarily writable: named
Project keys cannot edit org, global, or personal registry content. Non-writable IDs return
`404 service_api.not_found`. Assignment to an Agent is a separate permission check.

Start with the default global Skills. For shared product instructions, use
[persona documents](./agents.md#the-resource-fields) in your application-owned Agent template;
see [An Agent per user](./per-user-agents.md). See
[Authentication](../get-started/authentication.md) for key setup and scope.

Examples reuse the client and Agent from [Quickstart](../get-started/quickstart.md).
In TypeScript, set `const agentId = agent.agent_id`; Python reuses `agent_id` and runs inside
an async function. The curl examples reuse your configured
`ZOOWORK_API_KEY`, `ZOOWORK_BASE_URL`, and `AGENT_ID`.

## Upload a custom Skill

Package each local Skill separately. Include a nonempty `SKILL.md` with YAML `name` and
`description`, plus the scripts and resources it references. Either place `SKILL.md` at the
ZIP root, or put everything in one top-level directory matching the frontmatter name:

```text
slide-layout/
  SKILL.md       # frontmatter name: slide-layout
  resources/
```

Create a fresh archive; updating an old ZIP can retain removed files:

```bash
zip -r slide-layout.zip slide-layout/
```

Put the description in `SKILL.md`; the separate create-time description option is not forwarded.
Do not include credentials or unrelated local files. Skill upload registers a package; it is
not general binary task input or a `/workspace` file upload.

A Default Project key, which is what most new keys use, must send `scope=org`. A named
Project key must send `scope=project`. The examples use `org`; change it to `project` if your
key belongs to a named Project. Do not send caller-selected `org_id` or `project_id`. These
examples create a resource; execute them as an authorized upload, not as a capability probe.

::: code-group

```ts [TypeScript]
import { readFile } from 'node:fs/promises'

const skill = await client.uploadSkill(await readFile('slide-layout.zip'), {
  scope: 'org', // Use 'project' for a named Project key.
  fileName: 'slide-layout.zip',
})
const skillId = skill.skill_id
```

```python [Python]
from pathlib import Path

skill = await client.upload_skill(
    Path("slide-layout.zip").read_bytes(),
    scope="org",  # Use "project" for a named Project key.
    file_name="slide-layout.zip",
)
skill_id = skill["skill_id"]
```

```bash [curl]
curl -sS --fail-with-body "${ZOOWORK_BASE_URL%/}/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -F 'scope=org' \
  -F 'files[]=@slide-layout.zip;type=application/zip'
```

:::

`ZOOWORK_BASE_URL` includes `/service/v1`. Let the HTTP client generate the multipart boundary.
Save the returned `skill_id`, then follow [Installing and removing](#installing-and-removing).
An uploaded Skill is not automatically attached to an Agent.

**TypeScript compatibility:** `uploadSkill` accepts `scope: 'project'` from TypeScript SDK
0.10.2. With an older SDK, a Default Project can still use `scope: 'org'`; for a named Project,
upgrade the SDK or use the curl request above instead of a cast. Python's `scope` is a string.

## List registry Skills

`listSkills({ q, page })` / `list_skills(q=..., page=...)` return one array page; the HTTP
response is `{skills: [...]}`. The API derives owner, Organization, and Project selectors from
the key. Start with page 1 and continue as needed; a first-page miss does not prove absence.

```ts
const visible = await client.listSkills({ q: 'slide-layout', page: 1 })
```

Read visibility includes global Skills, same-Organization org Skills, same-Project project
Skills, and eligible personal Skills owned by the key's owner. This is broader than registry
write permission. Inspect the record's scope and ownership before updating it.

A Skill upload's `Idempotency-Key` is not a replay guarantee. If the create result is uncertain,
reconcile the existing record before retrying. A duplicate can return `409 skill_exists`.

## Publish a version

Keep the same frontmatter name and target the existing `skill_id`; do not repeat root create.
The version response has `version` and `state`, not `latest_version` and `status`.

::: code-group

```ts [TypeScript]
import { readFile } from 'node:fs/promises'

const version = await client.uploadSkillVersion(
  skillId, await readFile('slide-layout.zip'), { fileName: 'slide-layout.zip' },
)
if (version.state !== 'ready') throw new Error(`Skill version is ${version.state}`)
const assigned = await client.listAgentSkills(agentId)
```

```python [Python]
from pathlib import Path

version = await client.upload_skill_version(
    skill_id, Path("slide-layout.zip").read_bytes(), file_name="slide-layout.zip"
)
if version["state"] != "ready":
    raise RuntimeError(f"Skill version is {version['state']}")
assigned = await client.list_agent_skills(agent_id)
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/skills/$SKILL_ID/versions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -F 'files[]=@slide-layout.zip;type=application/zip'
```

:::

Version publishing keeps the Skill's ownership. Unpinned mutable bindings follow new ready
versions; pinned bindings keep their selected version. Inspect assignments and separately
[test runtime use](#test-a-skill); upload success alone does not prove that the Agent read it.

## Delete a registry Skill

`deleteSkill(skillId)` / `delete_skill(skill_id)` sends `DELETE /skills/{skill_id}` and returns
no value on HTTP 204. It deletes the registry Skill, rather than just one Agent's assignment.
Check consumers before deleting an Organization-shared Skill. To detach only one Agent, use
`deleteAgentSkill` / `delete_agent_skill`. The key's registry write scope applies to deletion;
visible read-only Skills still return `404 service_api.not_found` when you try to delete them.

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
it does not create or upload a Skill. Take IDs from the upload response, the visible registry,
or an existing attached entry. Upload once, then attach the same Skill to the Agents that need it.

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
before retrying. Registry writes additionally require the key's write scope from [API availability](#api-availability).

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
