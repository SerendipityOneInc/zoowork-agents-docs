# Authentication

Every request to the ZooClaw API is authenticated with one credential: an organization
service token, which this documentation calls your API key.

- It is a string starting with `zct_`.
- You send it as `Authorization: Bearer zct_...`.
- In the TypeScript SDK you pass it as `apiKey`.

The base URL, including the version prefix, is:

```
https://claw-interface.ecap.yesy.live/service/v1
```

## Get a key

Keys are created in the ZooClaw App, under **Settings → API Keys**:

1. Open the ZooClaw App, go to **Settings**, and pick the **API Keys** tab.
2. **Create API Key**, give it a name you will recognize later (`staging-backend`, not
   `test`), and copy the secret. It is shown **exactly once** and cannot be retrieved again -
   losing it means rotating it.
3. On a personal organization any member can do this. On an enterprise organization the tab
   requires the **admin** role - if you cannot see it, ask your org admin for a key instead.

The same page manages the key afterwards: **Rotate** invalidates the old secret immediately
and shows a new one once; **Revoke** kills the key outright. Neither has an API - key
management is App-only, deliberately.

## Configure the client

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })
```

`baseUrl` is optional - it defaults to the public API, and `ZOOCLAW_BASE_URL` overrides it.
appends paths such as `/models` and `/agents/{id}/sessions` directly to it.

## Server-side only

The key authenticates an organization, not an end user. Anyone holding it can create, read,
update, start, stop, and delete every agent in your organization, and can read every session
transcript under those agents. There is no scoped, per-user, or read-only variant.

Keep it on a server you control:

- Do not put it in a browser bundle, a mobile app, a desktop app, or any client-side
  environment variable that gets inlined at build time.
- Do not commit it, and do not print it in logs or error messages.
- Put your own backend between your users and the ZooClaw API. Your backend holds the key,
  authenticates your users your way, and decides which agent and which session each user may
  touch.

## What the gateway does for you

Your requests go through a gateway that authenticates the key and scopes every request to
your organization. Three of its behaviours change the code you write.

**It sets ownership for you.** `createAgent()` requires an `ownership` object in its input,
but the gateway overwrites whatever you send with the tenant anchors that belong to your key.
Passing accurate values is not possible and not necessary; passing placeholders is fine.

```ts
const created = await zc.createAgent({
  resource: { name: 'my-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  // Overwritten by the gateway with your key's own anchors.
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})
```

**It seeds the platform credentials the agent needs to talk to a model.** You do not create,
supply, or rotate model credentials. This happens right after creation and is a real write:
it bumps the agent's `config_version` twice, so the `config_version: 1` on the create receipt
is already `3` by the time your next `getAgent()` returns. Do not treat the version number
you were handed at create time as still current.

**It does not start the agent.** A new agent comes back with
`status.desired_state === 'stopped'`, and `createSession()` against a stopped agent fails with
`409 agent_not_running`. Call `startAgent()` yourself. See
[Quickstart](/en/get-started/quickstart) for the full create-then-start sequence.

Because credentials are seeded for you, the credential endpoints are deliberately not exposed
through this gateway. The SDK still carries `putCredential()` and `listCredentials()` - both
return 404 here. There is no supported way to store your own or your end users' third-party
credentials.

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
import { createZooclawClient, ZooclawError } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

try {
  const models = await zc.listModels()
  console.log(`ok: ${models.length} models, e.g. ${models[0]?.model}`)
} catch (e) {
  if (e instanceof ZooclawError && e.status === 401) {
    console.error('key rejected:', e.type) // service_token.invalid
    process.exit(1)
  }
  throw e
}
```

The same check with curl:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  https://claw-interface.ecap.yesy.live/service/v1/models
```

A missing or invalid key returns **401**. Match on `ZooclawError.status` and
`ZooclawError.type`, never on the message text.

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
| `putCredential()` / `listCredentials()` | No - 404 by design; the gateway seeds model credentials itself |
| Any agent id in another organization | No - returns 404, not 403 |
| Listing agents created by a different key in your organization | No - the list selector is exact; fetch by id still works |
| Per-user or read-only scoping of the key itself | No such variant exists |

::: warning Rotation is App-only, and we have not driven it
Rotation and revocation exist in the ZooClaw App (**Settings → API Keys**), not as API calls -
do not build a flow that rotates a key from your own code. We have not exercised either
ourselves; the buttons and their one-time secret reveal are documented from the product, not
from a live run. Treat a leaked key as an immediate **Rotate** in the App.
:::
