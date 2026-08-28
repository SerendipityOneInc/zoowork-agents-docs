# Channels

A channel binds a chat platform account to your agent, so the same agent that answers your
API sessions also answers people in a chat app.

Channels attach at the **agent** level, keyed by the same `agent_id` you already hold. An
agent with no channels is a pure API agent — that is the default, and nothing on this page is
required for API use.

::: warning New surface
Verified end to end on 2026-08-28, on the deployment this SDK talks to by default. This family
arrived with a recent gateway release, and a deployment that predates it answers **404 with a
different error envelope** — `{"error":{"type":"not_found"}}` instead of this family's
`{"code": …, "detail": …}`. That difference is how you tell "this deployment has no channels
yet" from "that thing does not exist".
:::

## Which platforms you can bind

Probed against a live deployment on 2026-08-28. A platform outside this table answers
`400 channel.invalid_request`.

| Platform | `addChannel` | Server-driven QR flow | You supply |
|---|---|---|---|
| `feishu` | ✅ | ✅ | nothing, or app credentials |
| `slack` | ✅ | ❌ never | bot token + app token |
| `wecom` | ✅ | ✅ | nothing, or bot id + secret |
| `weixin` / `wechat` | ❌ | ✅ — the only path | nothing |

Three of the four have a QR flow, and the two "no"s in this table are the interesting cases.

**Slack will not get one.** A server-driven flow needs the chat platform to hand credentials
back to a server that asked for them. Slack has no such thing: a Slack app is created by a
person on `api.slack.com/apps`, and its `xoxb-` / `xapp-` tokens only ever appear in that
person's browser. So Slack is `addChannel` with the tokens in `config`, permanently. If you
have seen the guided Slack setup in the ZooWork app, that guidance is exactly this: it helps
someone create the app and then has them paste the two tokens — the same two tokens you pass
here.

**WeChat goes the other way: the QR flow is its only path.** `addChannel` with
`platform: 'weixin'` (or `'wechat'`) answers `400 channel.weixin_setup_required`, and that
error means what it says — use `startChannelSetup(agentId, 'weixin')`. There are no WeChat
credentials for you to bring.

## The QR flow

This is the interactive path, and Feishu, WeCom and WeChat all have one: you get a URL, show
it to the person who owns the chat workspace (usually as a QR code), and poll until they
approve. Your code never touches platform credentials.

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

// 1. Start a setup session. Platform is 'feishu', 'wecom' or 'weixin'.
const setup = await zc.startChannelSetup(agentId, 'feishu')

// 2. YOU own the UI: render the URL — typically as a QR code — and show it.
//    Feishu answers verification_uri_complete, WeCom and WeChat answer qrcode_url.
//    The session expires after setup.expires_in seconds.
console.log(setup.verification_uri_complete ?? setup.qrcode_url)

// 3. Let the SDK drive the poll loop until the person approves (or doesn't).
const done = await zc.waitForChannelSetup(agentId, 'feishu', setup.session_id, {
  timeoutMs: setup.expires_in * 1000,
  onPoll: (p) => console.log('…', p.status),
})

if (done.status === 'success') {
  console.log('bound:', await zc.listChannels(agentId))
} else {
  console.log('not bound:', done.status)   // 'expired' | 'denied' | 'error'
}
```

`waitForChannelSetup` polls at the server's suggested interval and returns **every** terminal
outcome instead of throwing on the human ones — "the person never scanned" is an outcome,
not an exception. It throws only for a timeout you set (`408` / `type: 'timeout'`) or your
own abort (`0` / `'aborted'`).

If you drive the loop yourself, use `pollChannelSetup(agentId, platform, sessionId)` and treat
`status` values you do not recognize as still-in-flight:

| `status` | Meaning |
|---|---|
| `pending` | Waiting for the person. Keep polling at `poll_interval` seconds. |
| `success` | Bound. `channel_configured: true`. |
| `expired` | The session outlived `expires_in`. Start a new one. |
| `denied` | The person rejected it. Feishu only. |
| `error` | Something else went wrong; `message` has the detail. |

A pending poll answers `{ status: 'pending', channel_configured: false, message: null }`, plus
`poll_interval: 5` on Feishu.

### What differs per platform

The three flows share the routes and the `status` vocabulary, and differ in what the setup
answer carries and what the body may say:

| | `feishu` | `wecom` | `weixin` |
|---|---|---|---|
| Setup answers | `verification_uri_complete` | `qrcode_url` | `qrcode_url` |
| `poll_interval` | `5` | none — you pick the cadence | none |
| `expires_in` | `600` | `300` | `300` |
| Body reads | `brand`, `account`, `dm_policy`, `group_policy` | `account`, `dm_policy`, `group_policy` | `dm_policy` only |

Two details worth coding for. **WeChat's `qrcode_url` may be an inline image**, a
`data:image/…` payload rather than a URL, so check the prefix before you hand it to a QR
encoder. And **WeChat takes only `dm_policy: 'open'` or `'disabled'`** — `'allowlist'` answers
`400 channel.allowlist_unsupported` — pins the account to `'default'`, forces the group policy
to `'disabled'`, and ignores anything else you put in the body rather than rejecting it.

::: warning A session can stop existing, and then polling 404s
`cancelChannelSetup(agentId, platform, sessionId)` abandons a session — and afterwards polling
it answers `404 channel.feishu_session_not_found` (or `channel.wecom_session_not_found` /
`channel.weixin_session_not_found`) rather than a terminal `status`. So a hand-rolled loop
must treat that 404 as an ending, not as a transport error to retry. `waitForChannelSetup`
surfaces it as a thrown `ZooworkError` carrying that `type`.

Whether a session that simply runs past `expires_in` reports `status: 'expired'` in a 200 or
disappears into the same 404 has not been observed. Handle both.
:::

`brand` is Feishu's alone and picks the real host: `'feishu'` (default) gives an
`open.feishu.cn` URI, `'lark'` gives `open.larksuite.com`. It has to match the workspace the
person will approve it in.

**Pick `account` before you show the QR** on Feishu and WeCom. The name follows the same rules
as the explicit path — see [Naming the binding](#naming-the-binding-account).
It matters more here: approving the scan registers a **new app** in that Feishu workspace, and
only then is the binding written, so a name clash surfaces as `409 channel.conflict` *after*
someone has already scanned, leaving that fresh app behind in their workspace. Retrying under
the same name does both again.

## Explicit config — the path for Slack

`addChannel` is the non-interactive path: the only path for Slack, an alternative to the QR
flow for Feishu and WeCom, and refused for WeChat. You bring the platform app's credentials
and pass them in `config`.

**`config` keys are platform-specific, and they are camelCase.** These are the keys the
channel service reads; anything else you put in `config` is stored and ignored.

| Platform | `config` |
|---|---|
| `slack` | `{ botToken: 'xoxb-…', appToken: 'xapp-…' }` — both required |
| `wecom` | `{ botId: '…', secret: '…' }` — both required |
| `feishu` | `{ appId: '…', appSecret: '…', domain: '…' }` — only when you skip the QR flow |

```ts
await zc.addChannel(agentId, {
  platform: 'slack',
  config: { botToken: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN },
})
```

Slack runs in socket mode, which is why it needs the app-level `xapp-` token as well as the
bot token. Both come from the Slack app's own settings pages.

`allow_from` is accepted **only at create** and cannot be edited later.

::: danger 201 means stored, not working
Credentials are **not validated when you bind**. We bound a channel with deliberately bogus
credentials and got a `201` back carrying `health: 'unknown'`, `status: 'configured'` — the
same shape a good binding returns. Moments later the same channel listed as
`health: 'unhealthy'`, `status: 'error'`.

So the 201 tells you the binding was stored, not that it works. Read the verdict from
`health` / `status` on a follow-up `listChannels`, and do not report success to your user on
the strength of the create call alone.
:::

### Naming the binding: `account`

`account` names the binding (default `'default'`) so one agent can hold several accounts on
one platform. It is part of the record's identity rather than a setting: `updateChannel` and
`removeChannel` find a binding by `platform` + `account`, and nothing renames one — you remove
it and bind again.

Four things to know before you pick a value:

- **The name is unique per user, across every agent.** There is one active binding per
  (owner, platform, account), so taking `feishu` / `default` on one agent takes it away from
  all your other agents.
- **`'default'` is very likely taken already** if the same login ever bound this platform in
  the app. That binding was not made through this API, so the server declines to adopt it and
  answers `409 channel.conflict`.
- **The format is `^[a-z0-9][a-z0-9_-]{0,63}$`**, plus three reserved words (`__proto__`,
  `prototype`, `constructor`). Anything else is a `400`, and nothing is normalized for you — a
  display name with capitals, spaces, or non-ASCII characters is rejected, not cleaned up.
- **The SDK cannot pre-check a name for you.** `listChannels` is scoped to one agent while the
  constraint spans your whole account, so a name another one of your agents holds is invisible
  here. Keep your own list.

::: warning Rotating credentials means remove, then add
Re-posting the **same** `platform` + `account` with an identical body answers `201` again and
replays the binding you already have — it does not create a second channel, and it does not
overwrite anything. Re-posting that same pair with a **different** `config` answers
`409 channel.conflict`.

So `addChannel` is not an upsert. To move a binding onto new credentials, call `removeChannel`
first and then `addChannel`; a plain re-add fails.
:::

## List, update, unbind

```ts
const channels = await zc.listChannels(agentId)
// [{ platform: 'feishu', account: 'default', enabled: true, health: …, status: …, … }]

await zc.updateChannel(agentId, 'feishu', { enabled: false })   // pause without unbinding
await zc.updateChannel(agentId, 'feishu', { dm_policy: 'open' })

await zc.removeChannel(agentId, 'feishu')                        // account: 'default'
await zc.removeChannel(agentId, 'feishu', { account: 'sales' })
```

`dm_policy` and `group_policy` are the reachability policies — who may reach the agent in
direct messages and in groups. `'open'` is the server default for both, and an unrecognized
value answers `400 channel.invalid_request`. One value is rejected outright here:
`dm_policy: 'pairing'` answers `400 channel.pairing_unsupported` on both create and update —
pairing exists in the chat product, not on API-created agents.

`updateChannel` hands back the channel in its **new** state, so you do not need a follow-up
read. Note that `enabled: false` is more than a flag: it was observed moving `status` to
`'disabled'` and resetting `health` to `'unknown'`.

### The three 404s, and what each one tells you

The channels family answers `404` in three different situations, and the `code` is how you
tell them apart. Match on it rather than on the status alone:

| `code` | What happened | What to do |
|---|---|---|
| `channel.feishu_session_not_found`, and the `wecom` / `weixin` spellings of it | The QR session is gone — cancelled, or possibly expired. | Start a new setup session. |
| `channel.not_found` | The agent exists, but has no binding on that platform. | Nothing to update or remove; bind first. |
| `service_api.not_found` | Unknown agent, an agent you cannot reach, or an unknown action in the path. | Check the agent id and the route. |

Note the asymmetry, because it decides whether your cleanup code needs a `try`: **`removeChannel`
is idempotent** — removing a binding that is not there answers `200 { ok: true }`, not a 404 —
while **`updateChannel` is not**, and answers `404 channel.not_found`.

A fourth case is not this family at all: if the whole response envelope is
`{"error":{"type":"not_found"}}` rather than `{"code": …, "detail": …}`, the deployment does
not carry the channels routes yet.

## What binding a channel changes

Two things to design for before you bind:

::: danger Chat conversations and API sessions are separate
A conversation in the chat app and a session you create over the API are **different
sessions with different context** — binding a channel does not let your API calls read what
the agent said in Feishu, or inject into that conversation. Expect chat traffic to show up
as its own sessions, not inside yours. If your product needs one shared memory across both,
that is an application-level design problem, not a flag.
:::

::: warning `actual_state` starts meaning something
For a pure API agent, `status.actual_state` parks at `activating` forever and the
[Agents](/en/build/agents) page tells you to ignore it. Once a channel is bound,
`actual_state` reports that channel's connectivity — so its value will now move, and
dashboards can read it for **channel health**. It is still not an API-readiness signal:
keep gating on `desired_state === 'running'` (or `waitUntilRunning`).
:::

And one lifecycle note: deleting an agent best-effort disables its channels. That cleanup
never turns a successful delete into an error, so on a bad day a chat binding can outlive
its agent — if a binding must be gone, `removeChannel` before `deleteAgent`.
