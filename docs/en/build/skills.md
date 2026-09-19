---
description: Package, upload, attach, inspect, update, and remove skills from agents.
---

# Skills

A skill is a packaged capability attached to an agent: a `SKILL.md` plus its supporting
files, stored in the registry and synced into the agent's sandbox. The model reads the skill
when it decides the skill is relevant. Skills are not tools, and they are not code you call.
Attaching one changes what the agent knows how to do; it does not add an API you drive.

Skills attach at the **agent** level. There is no session-level skill list and no per-session
override.

## Inspect attached skills

You do not need to install anything to get started. A freshly created agent comes back with
the full global catalog already attached.

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const skills = await zc.listAgentSkills(agentId)
console.log(skills.length)
for (const s of skills) {
  console.log(`${s.name} v${s.version} [${s.scope}] eligible=${s.eligible}`)
}
```

The global catalog can include document skills such as `docx`, `pptx`, `xlsx`, and `pdf`.
The catalog can evolve, so list it at runtime instead of depending on a fixed count.

Pass `{ verbose: true }` to include shadowed and ineligible entries:

```ts
const all = await zc.listAgentSkills(agentId, { verbose: true })
```

### What an entry looks like

`listAgentSkills` returns `AgentSkill[]`:

```ts
interface AgentSkill {
  skill_id?: string
  name?: string
  version?: number | string
  scope?: 'global' | 'org' | 'personal' | 'pack' | string
  eligible?: boolean
  files?: { path: string; size?: number; sha256?: string }[]
  [k: string]: unknown
}
```

Rows can carry more than the typed fields — `description`, `location`
(`/skills/<name>/SKILL.md`), `basePath` (`/opt/zooclaw/skills/<scope>/<name>/<version>`),
`contentHash` and `promptVersion`. They are reachable through the index signature and are the
cheapest way to confirm a skill is really on disk.

`scope` tells you who manages the entry:

| `scope` | Where it came from | Management model |
|---|---|---|
| `global` | The platform catalog. Attached to every agent by default. | Managed by the platform. |
| `org` | Uploaded by your own organization. | Managed with the Skills API. |
| `personal` | Uploaded under one user. | Managed with the Skills API. |
| `pack` | Injected by an assembled pack. | Managed as part of the pack. |

`eligible` reports whether the resolved skill is actually usable for this agent. An entry can
be attached and still not eligible.

## Global skills are attached automatically

Global skills are ready on every new agent by default and require no provisioning step. To
create an Agent without them, set `include_global_skills: false` or pass an explicit
`skills: []` in the Agent resource. Setting `include_global_skills: false` does not remove
Skills you install explicitly, and the opt-out persists across later updates and rerenders.

Use
`putAgentSkill()` and `deleteAgentSkill()` only for skills with `org` or `personal` scope:

```ts
const catalog = await zc.listSkills()
const customSkills = catalog.filter(
  (skill) => skill.scope === 'org' || skill.scope === 'personal',
)
```

The API returns `404` when `putAgentSkill()` receives a global skill id. Treat that response
as a scope mismatch and do not retry it. Cross-tenant skill ids use the same status, so match
on the status rather than the message.

## Installing and removing

```ts
// Attach, following the latest published version.
const { config_version, warnings } = await zc.putAgentSkill(agentId, skillId)

// Attach, pinned to version 1.
await zc.putAgentSkill(agentId, skillId, { versionPin: 1 })

// Attach but disabled.
await zc.putAgentSkill(agentId, skillId, { enabled: false })

// Remove the installation row.
await zc.deleteAgentSkill(agentId, skillId)
```

Signatures, from the SDK client:

```ts
putAgentSkill(
  agentId: string,
  skillId: string,
  opts?: { enabled?: boolean; versionPin?: number | null },
): Promise<{ config_version?: number; warnings?: string[] }>

deleteAgentSkill(agentId: string, skillId: string): Promise<void>
```

`enabled` defaults to `true` and `versionPin` defaults to `null`. A null pin means follow
latest: when a new ready version is published, the platform bumps the agent's
`config_version` and the next turn resolves the new version without another PUT.

Both calls bump `config_version` on success, every time, even when nothing changed. **Neither
is a side-effect-free replay.** After a network timeout, call `listAgentSkills` to reconcile
before retrying.

For a global entry, DELETE restores the platform default rather than detaching the skill.
`org` and `personal` skills are removed from the agent.

After installing a skill, use `listAgentSkills()` to check that it returns with
`eligible: true`. Read the list again after removal; do not infer installation state only from
the returned `config_version`.

## Finding skill ids

`listSkills()` returns the catalog your key can see: the global entries plus anything your
own organization has uploaded.

```ts
const all = await zc.listSkills()
const mine = await zc.listSkills({ scope: 'org' })
const found = await zc.listSkills({ q: 'market', page: 1 })
```

`scope`, `q` and `page` are the only options. `q` matches on name; `page` is 1-based with a
fixed page size of 100.

A row is a `SkillRecord` - `skill_id`, `scope`, `name`, `description`, `latest_version`,
`status`, `ownership`. Two shapes to expect: on an `org`-scope skill `ownership.owner_uid`
comes back `null` (it belongs to the organization, not to a person), and `latest_version` came
back as the **string** `"1"` from the multipart create while other surfaces spell it as a
number - compare loosely, or `Number()` it.

## Write the `description` as a trigger

The agent uses the frontmatter `description` to decide when to load a skill. Write when the
skill applies and include words users are likely to say. Put the detailed instructions and
reference material in the body.

```yaml
# Too broad: describes the artifact
description: Notes about our office coffee bar.

# Better: describes when to use it
description: Use whenever the user asks about the office coffee menu, coffee prices, or wants
  to order a coffee - including the words latte, espresso, or americano.
```

An uploaded skill can be attached and `eligible: true` without being selected for a turn.
When selection is too broad or too narrow, adjust the description first.

## Uploading your own skill

A skill is a zip containing a single top-level directory (or a root that directly holds
`SKILL.md`). `SKILL.md` must be non-empty UTF-8 with `name` and `description` in its
frontmatter. `name` must match `^[a-z0-9-]{1,64}$`. Total expanded size is capped at 50 MB,
paths must not contain `..`, absolute paths, or backslashes, and encrypted zips are rejected.
The server expands the archive on ingestion.

::: info Keep the directory and skill names aligned
`coffee-order/SKILL.md` declaring `name: coffee-order`. A mismatch is rejected with a 400
naming both. The two are compared case- and underscore-insensitively, so a directory
`Coffee_Order/` still matches `name: coffee-order`. This normalization applies only to the
directory: the frontmatter `name` itself still has to match `^[a-z0-9-]{1,64}$`.

Entries may be **stored** (uncompressed) as well as deflated, so a minimal zip writer is
enough; you do not need a compression library to publish a small skill.
:::

```ts
import { readFile } from 'node:fs/promises'

const zip = await readFile('coffee-order.zip')
const skill = await zc.uploadSkill(zip, { scope: 'org' })
// { skill_id: 'skl_…', scope: 'org', name: 'coffee-order', latest_version: '1', … }

await zc.putAgentSkill(agentId, skill.skill_id)
```

`scope` must be `org` or `personal`; `global` and `pack` are refused on this route. One call
creates the skill row **and** version 1.

`uploadSkill` is create-only. Put the initial description in the zip's frontmatter: the
public gateway drops the create call's `description` option. Other scopes than org/personal
are rejected by the gateway with HTTP 400.

Use `uploadSkillVersion(skillId, zip)` to upload a new version; its frontmatter name must
match the skill. It returns `SkillVersionRecord` with `skill_id`, `version` and `state`,
not `SkillRecord.latest_version/status`. This version operation can use the description
override. Unpinned installations follow updates without another `putAgentSkill`.

Retry behavior differs: root create can return `409 skill_exists` after a successful
same-name create; version upload deduplicates identical content for that skill. Neither
promises HTTP-key replay. Read back to reconcile an uncertain outcome.

Before calling `deleteSkill(skillId)`, detach the skill from agents that still use it. Deletion
takes effect immediately for those agents.

## Proving a skill actually ran

Nothing in the event stream says "this skill was selected". `listAgentSkills` tells you a skill
is **attached**, not that it **ran**:

```json
{ "skill_id": "skl_…", "name": "coffee-order", "scope": "org", "version": "1",
  "eligible": true, "location": "/skills/coffee-order/SKILL.md",
  "basePath": "/opt/zooclaw/skills/org/coffee-order/1" }
```

`eligible: true` with a real `basePath` means installed and on disk. Whether the model loaded
it is only observable in the answer.

So test it the way you would test a fact, not a function: **put something in the skill that the
model could not otherwise produce** - an exact internal price, a product codename, a required
reply format - then ask a question that should reach for it, before and after installing.

That before/after is the whole demonstration. Asked about office coffee prices with no skill
attached, an agent will confidently invent market rates; with the skill attached it answers
from your file, down to the details that exist nowhere else. The
[`skill-lab` quickstart](https://github.com/SerendipityOneInc/zoowork-quickstarts) runs exactly
this comparison, with a fresh session per question so the second answer comes from the skill
rather than from the agent remembering the first.

## Skill lifecycle

- **Agent-level configuration.** Skills belong to the agent, so every Session on that Agent
  uses the same attached set.
- **Model-directed selection.** The model selects relevant skills from their descriptions for
  each turn.
- **Manifest inspection.** `listAgentSkills` returns the file manifest (`files[]` with `path`,
  `size`, and `sha256`) for each attachment.

## Related

- [An agent per user](./per-user-agents.md) - distributing one org skill across a fleet of
  per-user agents, with canary pinning and reconciliation.
- [Agents](./agents.md) - `config_version` semantics and why every skill write bumps it.
- [Tools](./tools.md) - the built-in tool set, which is a separate mechanism.
