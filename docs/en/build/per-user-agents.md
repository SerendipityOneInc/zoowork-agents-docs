# An agent per user

A common product shape: you build one agent, you run your own user accounts, and every user
should get their own copy — its own sandbox, its own files, its own memory. Then you keep
iterating on the agent's behaviour, and every copy should pick the change up without you
touching each one.

This page is that pattern. The short version: **give every user their own agent, and put the
behaviour you iterate on into an `org`-scope skill that each agent installs unpinned.** The
fleet fans out; the skill stays in one place. Publishing a new skill version updates every
agent by itself.

## Why an agent per user, and not one agent with many sessions

For per-user *conversation* state, one agent with a session per conversation is enough, and it
is the cheaper design — see [Sessions](/en/build/sessions). Reach for an agent per user when
the users must not share what lives **outside** the transcript:

- **The sandbox.** An agent has one sandbox, and every session of that agent works in the same
  persistent `/workspace`. Files one session writes, another session reads. With one shared
  agent, that means files one *user* writes, another user's turn can read.
- **Model-side memory.** Where the deployment enables the model's memory tools, they are
  scoped to the agent, across sessions — and they are invisible over the API, so you cannot
  partition them per user after the fact. See the
  [capability matrix](/en/reference/capabilities) for their status.

There is no per-user sandbox inside a single agent, and no way to partition `/workspace` by
end user. Isolation is drawn at the agent boundary, so per-user isolation means per-user
agents.

The cost is also real: each agent is a separate sandbox to provision and start, and
agent-level configuration (persona, model, tool policy) now exists in N copies. The rest of
this page is about keeping those N copies from becoming N maintenance problems.

## Split the agent into a stable shell and a moving core

Decide, before creating the fleet, which parts of the agent you expect to change:

| Part | Lives where | Updating the fleet |
|---|---|---|
| Skill content — instructions, workflows, reference files | The registry, once, as an `org` skill | Automatic: publish a version, done |
| Persona / `agent.md`, model, tool policy | Each agent's own configuration | Manual: one `updateAgent` per agent |

The lever is obvious once it is in a table: **whatever you plan to iterate on belongs in a
skill.** Keep the per-agent configuration a thin, stable shell — a short persona that rarely
changes, plus the skill installations — and put the product's actual behaviour in skill
bodies. A fleet whose persona changes weekly costs you a rollout script; a fleet whose skills
change weekly costs you one `uploadSkillVersion` call.

## Why the update propagates

Three facts from [Skills](/en/build/skills) combine into the mechanism:

1. An `org`-scope skill is **visible** to every agent under your organization, but attaches to
   an agent only through an explicit install. Scope grants visibility, not effect — your other
   agents, on other products, are untouched.
2. An install without `versionPin` **follows latest**: when a new ready version is published,
   the platform bumps each installed agent's `config_version` on its own.
3. An agent reloads its configuration at the **next turn**. In-flight turns finish on the old
   version; the next turn answers from the new one.

So the builder-side loop is: publish a version, and stop. No per-agent PUT, no restart, no
redeploy. Propagation is asynchronous and server-driven; to confirm a given agent has moved,
read `listAgentSkills(agentId)` and compare `version` rather than assuming.

## Onboarding: one call per new user

When a user signs up, your backend creates their agent with the skills already in the
create request:

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

// At user signup:
const agent = await zc.createAgent(
  {
    resource: {
      name: `myproduct-${user.id}`,
      labels: { end_user: user.id },
      skills: [{ skill_id: PRODUCT_SKILL_ID }], // no version -> follows latest
      persona: { docs: [{ name: 'agent.md', content: STABLE_PERSONA }] },
    },
  },
  `user-${user.id}`, // idempotency key, stable per user
)
await yourDb.users.update(user.id, { agent_id: agent.agent_id })

await zc.startAgent(agent.agent_id)
await zc.waitUntilRunning(agent.agent_id)
```

Four points that keep this loop honest:

- **Your database is the index.** Store `user.id → agent_id` at create. `listAgents` filters
  by `labels`, which works as a recovery path, but it is scoped to your key's bound user and
  pages at 100 — it is not your lookup table.
- **Pass a stable idempotency key** derived from your user id, and treat your own stored
  mapping as the source of truth: on any retry or re-signup, check your database for an
  existing `agent_id` before creating.
- **A created agent is stopped.** Without `startAgent` + `waitUntilRunning`, the first
  session call answers `409 agent_not_running`. Wait on `desired_state` — see
  [Agents](/en/build/agents).
- **The API key never leaves your backend.** It is an organization credential with full
  write over every agent in the org; there is no per-user or scoped variant. The browser
  talks to your backend, and your backend talks to ZooWork.

After onboarding, conversations are ordinary sessions against the user's own agent:
`createSession(agentId, …)`, `postEvents`, `streamEvents`.

## Shipping an update

```ts
await zc.uploadSkillVersion(PRODUCT_SKILL_ID, newZipBytes)
```

That is the whole rollout. Every agent that installed the skill unpinned follows the new
version; each user's next turn runs the new behaviour. The users do nothing and notice
nothing, which also means: **treat a skill version like a deploy, not like a draft.** Every
active user is on latest.

### Canary before fleet-wide

`versionPin` turns the same mechanism into a staged rollout. Pin the fleet to the current
version, leave your canary agents unpinned, publish, verify, then unpin the fleet:

```ts
// Before publishing: pin non-canary agents to the running version.
await zc.putAgentSkill(agentId, PRODUCT_SKILL_ID, { versionPin: CURRENT_VERSION })

// Publish. Only unpinned (canary) agents move.
await zc.uploadSkillVersion(PRODUCT_SKILL_ID, newZipBytes)

// Happy? Unpin the rest; they move to latest.
await zc.putAgentSkill(agentId, PRODUCT_SKILL_ID, { versionPin: null })
```

Note that every `putAgentSkill` bumps the agent's `config_version`, changed or not, so a
pin/unpin sweep across N agents is N configuration writes. That is what it costs; budget it,
don't loop it casually.

## Adding a second skill to an existing fleet

Publishing a *new version* reaches everyone automatically; installing a *new skill* does not —
the install row is per agent. This is the one place the fleet pattern asks for a sweep, and
you can usually avoid doing it eagerly. Keep the list of skills a user's agent should have in
your own backend, and reconcile when the user shows up:

```ts
// Before opening a session for this user:
const installed = new Set(
  (await zc.listAgentSkills(agentId))
    .filter((s) => s.scope === 'org')
    .map((s) => s.skill_id),
)
for (const skillId of DESIRED_ORG_SKILLS) {
  if (!installed.has(skillId)) {
    await zc.putAgentSkill(agentId, skillId)
  }
}
```

Diff first, then write — `putAgentSkill` bumps `config_version` even when it changes nothing,
so a blind PUT-everything loop rewrites every agent's configuration on every session open.
With the diff, active users converge on their next visit and dormant agents cost nothing.

## What to keep in mind

- **`deleteSkill` has no in-use guard.** Deleting an org skill that the fleet still installs
  means every agent silently loses it. Retire a skill from your desired list and let
  reconciliation drop it (`deleteAgentSkill`) before deleting the registry entry.
- **Only your own skills install.** `global` catalog entries list but answer 404 on
  `putAgentSkill` — and they are already attached anyway. See
  [the trap in Skills](/en/build/skills#the-trap-global-skills-are-listable-but-not-installable).
- **Skill eligibility is per agent.** After installing, confirm `eligible: true` in
  `listAgentSkills` on a real agent rather than assuming the upload's success carries over.
- **Per-turn context still belongs in the session.** The agent-per-user split covers identity
  and isolation; what the user just clicked or which plan they are on is still best delivered
  as a `system.message` in the session, not by rewriting N personas.

## Related

- [Skills](/en/build/skills) — upload rules, version-follow semantics, and the global-skill trap.
- [Agents](/en/build/agents) — `config_version`, start/stop, and `desired_state`.
- [Sessions](/en/build/sessions) — the cheaper pattern when users only need separate conversations.
