# Authentication

Every request to the ZooWork API is authenticated with one credential: an organization
service token - your API key.

- It is a string starting with `zct_`.
- You send it as `Authorization: Bearer zct_...`.
- In the TypeScript SDK you pass it as `apiKey`.

The base URL, including the version prefix, is:

```
https://clawapi.ecap.gsmo.ai/service/v1
```

## Get a key

Keys are created in the ZooWork App, under **Settings → API Keys**:

1. Open the ZooWork App, go to **Settings**, and pick the **API Keys** tab.
2. **Create API Key**, give it a name you will recognize later (`orders-backend`, not
   `test`), and copy the secret. It is shown **exactly once** and cannot be retrieved again -
   losing it means rotating it.

Two separate things decide whether that tab is on your Settings page at all:

- **Your role.** On a personal organization any member can create a key. On an enterprise
  organization the tab requires the **admin** role.
- **Whether your account is in the preview.** The App asks the server whether your account
  is on the agent runtime this API talks to, and hides the tab unless the answer comes back
  yes. During the Developer Preview that is a staged rollout, not a setting you can flip.

Either one can be why the tab is missing, and the fallback is the same: **ask your org admin
for a key.** What they hand you is the same credential you would have created yourself - it
authenticates the organization, not the person who created it, so one key serves every
service your organization runs against this API.

The same page manages the key afterwards: **Rotate** invalidates the old secret immediately
and shows a new one once; **Revoke** kills the key outright. Neither has an API - key
management is App-only, deliberately, so do not build a rotation flow into your own code.
Treat a leaked key as an immediate **Rotate** in the App.

## Configure the client

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

`baseUrl` is optional - it defaults to the public API, and `ZOOWORK_BASE_URL` overrides it. The
client appends paths such as `/models` and `/agents/{id}/sessions` directly to it.

## Server-side only

The key authenticates an organization, not an end user. Anyone holding it can create, read,
update, start, stop, and delete every agent in your organization, and can read every session
transcript under those agents. There is no scoped, per-user, or read-only variant.

Keep it on a server you control:

- Do not put it in a browser bundle, a mobile app, a desktop app, or any client-side
  environment variable that gets inlined at build time.
- Do not commit it, and do not print it in logs or error messages.
- Put your own backend between your users and the ZooWork API. Your backend holds the key,
  authenticates your users your way, and decides which agent and which session each user may
  touch.

This key is the only credential the API accepts. There is no vault for your own or your end
users' secrets - keep those in your own service. See
[Not supported](/en/reference/not-supported).

## Tenancy: 404, not 403

An agent id that belongs to another organization returns **404**, not 403. The API hides
existence rather than confirming it. Two consequences:

1. **Do not read 404 as "deleted".** It means "no agent with that id is visible to this key",
   which covers deleted, never existed, and belongs to someone else. If you need to know
   whether your own agent still exists, track that on your side.
2. **Agent ids are not secrets, but do not scatter them.** Within one organization, any key can
   `getAgent()` any agent id it learns, so an id pasted into a shared chat is readable
   configuration. Ids are not credentials, and knowing one gives no access across
   organizations.

Listing is narrower than fetching: agents are listed by an explicit `owner_uid` + `org_id`
selector pair, matched as an AND. An agent created by a different key in the same organization
can be fetched by id but will not appear in that key's list. `listAgents()` uses that same
selector, so it lists only what your own key owns - keep your own record of the ids for
anything created by another key in your organization.

## Check that a key works

The cheapest liveness check is `listModels()`. It touches no agent, creates nothing, and
returns the models your organization can select.

```ts
import { createZooworkClient, ZooworkError } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

try {
  const models = await zc.listModels()
  console.log(`ok: ${models.length} models, e.g. ${models[0]?.model}`)
} catch (e) {
  if (e instanceof ZooworkError && e.status === 401) {
    console.error('key rejected:', e.type) // service_token.invalid
    process.exit(1)
  }
  throw e
}
```

The same check with curl:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  https://clawapi.ecap.gsmo.ai/service/v1/models
```

A missing or invalid key returns **401**. Match on `ZooworkError.status` and
`ZooworkError.type`, never on the message text.

## What a key reaches

| Surface | Reachable with your API key |
|---|---|
| `listModels()` | Yes |
| Agent create, read, update, delete | Yes, within your organization |
| `listAgents()` | Yes - but the selector is `owner_uid` AND `org_id`, so you see only the agents your own key created |
| `startAgent()` / `stopAgent()` | Yes |
| `listAgentSkills()` | Yes |
| Sessions, events, SSE stream under your agents | Yes |
| Installing a skill your own organization uploaded | The route is open to `org` and `personal` scope; we have not exercised it (see [Skills](/en/build/skills)) |
| Installing a skill from the global catalog | No - returns 404. Global skills are already attached at agent creation |
| Uploading a skill (`uploadSkill()` / `uploadSkillVersion()`) | The multipart route takes `org` and `personal` scope only; `global` and `pack` are 403. See [Skills](/en/build/skills) for what has been driven |
| Schedules under your own agents | Agent-scoped routes, all seven on the client. See the [capability matrix](/en/reference/capabilities) for what has been driven |
| Environments in your organization | Scoped to your org. The platform default Environment - the one a fresh agent is pinned to - is not fetchable by any key, because the gateway forces an org selector and the default belongs to no org. See [Environments](/en/build/environments) |
| Any agent id in another organization | No - returns 404, not 403 |
| Listing agents created by a different key in your organization | No - the list selector is exact; fetch by id still works |
| Per-user or read-only scoping of the key itself | No such variant exists |
