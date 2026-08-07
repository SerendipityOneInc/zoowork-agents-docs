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
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

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
}
```

`scope` is the field that decides what you can do with the entry, so read it first:

| `scope` | Where it came from | Can you install or remove it with an API key? |
|---|---|---|
| `global` | The platform catalog. Attached to every agent by default. | No. See the trap below. |
| `org` | Uploaded by your own organization. | Yes, in principle. |
| `personal` | Uploaded under one user. | Yes, in principle. |
| `pack` | Injected by an assembled pack. | Not through this API. |

`eligible` reports whether the resolved skill is actually usable for this agent. An entry can
be attached and still not eligible.

## The trap: global skills are listable but not installable

::: danger Installing a global skill with an API key returns 404
```ts
try {
  await zc.putAgentSkill(agentId, 'skl_some_global_skill')
} catch (e) {
  // ZooclawError, status 404
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
import { ZooclawError } from '@zooclaw-agents/sdk'

try {
  await zc.putAgentSkill(agentId, skillId)
} catch (e) {
  if (e instanceof ZooclawError && e.status === 404) {
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

::: warning Not yet verified
Our live run only ever attempted `putAgentSkill` against a `global` skill, which is the 404
above. We have **not** observed a successful install of an `org` or `personal` skill, and
`deleteAgentSkill` has never been exercised against a live deployment.

The routes exist and the SDK calls them correctly. Verify the behaviour yourself before you
depend on it, and check the result with `listAgentSkills` rather than trusting the returned
`config_version`.
:::

## Finding skill ids

The SDK has no catalog method. The registry listing is one plain `fetch` against the same
base URL with the same bearer:

```ts
const base = process.env.ZOOCLAW_BASE_URL!
const res = await fetch(
  `${base}/skills?owner_uid=${encodeURIComponent(ownerUid)}&org_id=${encodeURIComponent(orgId)}`,
  { headers: { Authorization: `Bearer ${process.env.ZOOCLAW_API_KEY}` } },
)
const { skills } = await res.json() as {
  skills: { skill_id: string; name: string; scope: string }[]
}
```

Both selectors are required by the route. The result is the union of the visible global
catalog plus anything matching those anchors, so placeholder values still return 200 with the
global entries. To see a skill your own organization uploaded, you must pass the real
`org_id` or `owner_uid` it was created under.

## Uploading your own skill

A skill is a zip containing a single top-level directory (or a root that directly holds
`SKILL.md`). `SKILL.md` must be non-empty UTF-8 with `name` and `description` in its
frontmatter. `name` must match `^[a-z0-9-]{1,64}$`. Total expanded size is capped at 50 MiB,
paths must not contain `..`, absolute paths, or backslashes, and encrypted zips are rejected.
The server expands the archive on ingestion.

Creation is a multipart POST to `/skills` on the same base URL, with the scope and ownership
anchors alongside the file:

```bash
curl -X POST "$ZOOCLAW_BASE_URL/skills" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  -F "files[]=@market-research.zip" \
  -F "scope=personal" \
  -F "owner_uid=usr_example"
```

`scope` must be `personal` or `org`; `global` is refused on this route. On success one skill
row plus version 1 are created, and the response carries `skill_id` and `latest_version: 1`.
Later versions go to `POST /skills/{skill_id}/versions` with the same multipart form.

::: warning Not yet verified
The upload route exists and is documented by the platform, but we have not run it. We are not
publishing a step-by-step flow we have not executed, and we cannot tell you what the gateway
does with the `scope` and ownership form fields in practice.

If you try it: upload first, then confirm with the catalog listing above, then
`putAgentSkill`, then `listAgentSkills` to prove the attachment landed. Do not assume any
step succeeded because the previous one did.
:::

## What is not here

- **No session-level skills.** Skills belong to the agent. A session cannot add, remove, or
  override them, and there is no per-session skill limit to manage.
- **No skill invocation API.** You cannot ask the platform to run a skill. The model decides.
- **No skill content read-back through the agent.** `listAgentSkills` gives you the file
  manifest (`files[]` with `path`, `size`, `sha256`), not file contents.

## Related

- [Agents](/en/build/agents) - `config_version` semantics and why every skill write bumps it.
- [Tools](/en/build/tools) - the built-in tool set, which is a separate mechanism.
- [Capability matrix](/en/reference/capabilities) - current verification status of each surface.
