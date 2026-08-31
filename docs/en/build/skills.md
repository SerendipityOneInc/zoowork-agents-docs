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

## A new agent already has skills

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

In our run against a live deployment, a bare agent created seconds earlier returned 21
entries, every one of them `scope: 'global'`, including document skills such as `docx`,
`pptx`, `xlsx`, and `pdf`. The exact catalog is defined by the deployment, so read it rather
than assuming this number.

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

Live rows carry more than the typed fields — `description`, `location`
(`/skills/<name>/SKILL.md`), `basePath` (`/opt/zooclaw/skills/<scope>/<name>/<version>`),
`contentHash` and `promptVersion`. They are reachable through the index signature and are the
cheapest way to confirm a skill is really on disk.

`scope` is the field that decides what you can do with the entry, so read it first:

| `scope` | Where it came from | Can you install or remove it with an API key? |
|---|---|---|
| `global` | The platform catalog. Attached to every agent by default. | No. See the trap below. |
| `org` | Uploaded by your own organization. | Yes — verified. |
| `personal` | Uploaded under one user. | Yes, not verified. |
| `pack` | Injected by an assembled pack. | Not through this API. |

`eligible` reports whether the resolved skill is actually usable for this agent. An entry can
be attached and still not eligible.

## The trap: global skills are listable but not installable

::: danger Installing a global skill with an API key returns 404
```ts
try {
  await zc.putAgentSkill(agentId, 'skl_some_global_skill')
} catch (e) {
  // ZooworkError, status 404
}
```

This is not a wrong skill id and not a permissions bug you can configure around. The install
endpoint behind your API key only accepts skills your own organization owns: `org` and
`personal` scope. A `global` catalog entry is visible in every listing and answers 404 on
install.

The damage is smaller than it looks: **the global skills are already attached**. You are not
being denied the capability, you are being denied control over it. Do not write a
provisioning step that installs the global skills it found in the catalog, and do not retry
the 404.
:::

Match on the status, not the message:

```ts
import { ZooworkError } from '@zoowork-ai/sdk'

try {
  await zc.putAgentSkill(agentId, skillId)
} catch (e) {
  if (e instanceof ZooworkError && e.status === 404) {
    // Either the skill is global, or it belongs to another tenant.
    // Cross-tenant ids are hidden as 404 rather than 403.
  }
  throw e
}
```

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

Removing a `global` entry does not detach it. Per the platform's documented behaviour, a
DELETE against a global skill removes your override and restores the default; only `org` and
`personal` skills are genuinely uninstalled.

Installing an `org` skill is **verified** end to end: the skill came back from
`listAgentSkills` with `eligible: true`, and the next turn answered from its own content.
`deleteAgentSkill` is **available but not verified**; check the result with `listAgentSkills`
rather than trusting the returned `config_version`.

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

## Writing a skill that fires

::: danger The `description` is the trigger. The body is the payload.
The agent decides whether to load your skill by reading **only the frontmatter
`description`**. The body is read afterwards, and only if the description won. A description
that says what the skill *is* will never fire, no matter how good the body is.

```yaml
# never fires - describes the artifact
description: Notes about our office coffee bar.

# fires - describes the occasion
description: Use whenever the user asks about the office coffee menu, coffee prices, or wants
  to order a coffee - including the words latte, espresso, or americano.
```

This is the one failure in this API that reports success at every step. A skill can upload,
install, and list as eligible, and still never fire once, because the trigger words were in the
body and the description only named the artifact. Rewriting the description, changing nothing
else, made it fire on the next turn.

When a skill "does nothing", check the description before you check anything else.
:::

Write the description as *when to use this*, and put the words a user would actually say into
it. Everything the agent should know or do goes in the body.

## Uploading your own skill

A skill is a zip containing a single top-level directory (or a root that directly holds
`SKILL.md`). `SKILL.md` must be non-empty UTF-8 with `name` and `description` in its
frontmatter. `name` must match `^[a-z0-9-]{1,64}$`. Total expanded size is capped at 50 MB,
paths must not contain `..`, absolute paths, or backslashes, and encrypted zips are rejected.
The server expands the archive on ingestion.

::: warning The zip's top-level directory must match the frontmatter `name`
`coffee-order/SKILL.md` declaring `name: coffee-order`. A mismatch is rejected with a 400
naming both, so it is friction rather than a trap - but it is the first thing that fails when
you package a skill by hand. The two are compared case- and underscore-insensitively, so a
directory `Coffee_Order/` still matches `name: coffee-order`. That leniency is about the
directory only: the frontmatter `name` itself still has to match `^[a-z0-9-]{1,64}$`.

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

`uploadSkill` is create-only. To publish a new version of a skill that already exists, use
`uploadSkillVersion(skillId, zip)` - the frontmatter `name` must match the target skill. Agents
that installed it unpinned follow the new version by themselves: the registry bumps their
`config_version` and you do **not** call `putAgentSkill` again.

`deleteSkill(skillId)` has no in-use guard. Agents holding the skill simply lose it.

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

## What is not here

- **No session-level skills.** Skills belong to the agent. A session cannot add, remove, or
  override them, and there is no per-session skill limit to manage.
- **No skill invocation API.** You cannot ask the platform to run a skill. The model decides.
- **No skill content read-back through the agent.** `listAgentSkills` gives you the file
  manifest (`files[]` with `path`, `size`, `sha256`), not file contents.

## Related

- [An agent per user](./per-user-agents.md) - distributing one org skill across a fleet of
  per-user agents, with canary pinning and reconciliation.
- [Agents](./agents.md) - `config_version` semantics and why every skill write bumps it.
- [Tools](./tools.md) - the built-in tool set, which is a separate mechanism.
- [Capability matrix](../reference/capabilities.md) - current verification status of each surface.
