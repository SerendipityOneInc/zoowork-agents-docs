---
description: Connect agents to chat platforms and manage each channel's setup and lifecycle.
---

# Channels

A channel binds a chat platform account to your agent, so the same agent that answers your
API sessions also answers people in a chat app.

Channels attach at the **agent** level, keyed by the same `agent_id` you already hold. An
agent with no channels is a pure API agent — that is the default, and nothing on this page is
required for API use.

## Which platforms you can bind

| Platform | Configuration path | You supply |
|---|---|---|
| `feishu` | QR setup or direct credentials | Nothing, or app credentials |
| `slack` | Direct credentials | Bot token + app token |
| `wecom` | QR setup or direct credentials | Nothing, or bot id + secret |
| `weixin` / `wechat` | QR setup | Nothing |
| `dingtalk-connector` | Direct credentials | Client id + client secret |

Feishu, WeCom, and WeChat have a QR flow. Slack and DingTalk use explicit credentials.

**Slack uses explicit credentials.** Create the Slack app on `api.slack.com/apps`, then pass
its `xoxb-` and `xapp-` tokens to `addChannel` in `config`. The ZooWork app's guided setup
helps collect these same two values.

**WeChat uses guided setup.** Call `startChannelSetup(agentId, 'weixin')` and show the returned
QR code. Calling `addChannel` with `platform: 'weixin'` or `'wechat'` returns
`400 channel.weixin_setup_required`.

**DingTalk uses direct configuration in the public API.** Call `addChannel` with
`platform: 'dingtalk-connector'`, `config: { clientId, clientSecret }`, and
`dm_policy: 'open'`. The public guided-setup routes do not accept DingTalk.

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
not an exception. It can also throw for HTTP/transport failures, a timeout you set
(`408` / `type: 'timeout'`) or your own abort (`0` / `'aborted'`).

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

::: info Handle cancelled and expired setup sessions
After `cancelChannelSetup(agentId, platform, sessionId)`, polling returns
`404 channel.feishu_session_not_found` (or the corresponding `wecom` / `weixin` code) instead
of a terminal `status`. A custom poll loop should treat this response as a terminal outcome.
`waitForChannelSetup` surfaces it as a `ZooworkError` carrying that `type`.

A setup session that reaches `expires_in` can finish with `status: 'expired'` or become the
same 404. Handle both as terminal outcomes.
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

## Explicit config — Slack, DingTalk, Feishu and WeCom

`addChannel` is the non-interactive path: the only public API path for Slack and DingTalk, an
alternative to the QR flow for Feishu and WeCom, and refused for WeChat. You bring the
platform app's credentials and pass them in `config`.

**`config` keys are platform-specific, and they are camelCase.** These are the keys the
channel service reads; anything else you put in `config` is stored and ignored.

| Platform | `config` |
|---|---|
| `slack` | `{ botToken: 'xoxb-…', appToken: 'xapp-…' }` — both required |
| `wecom` | `{ botId: '…', secret: '…' }` — both required |
| `feishu` | `{ appId: '…', appSecret: '…', domain: '…' }` — only when you skip the QR flow |
| `dingtalk-connector` | `{ clientId: '…', clientSecret: '…' }` — both required; use `dm_policy: 'open'` |

```ts
await zc.addChannel(agentId, {
  platform: 'slack',
  config: { botToken: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN },
})
```

Slack runs in socket mode, which is why it needs the app-level `xapp-` token as well as the
bot token. Both come from the Slack app's own settings pages.

### Feishu document permissions

Feishu bindings accept `permission_admin_enabled: true` on direct add, update and guided setup.
This opts the binding into document-permission administration. The field defaults to disabled
when omitted.

```ts
await zc.addChannel(agentId, {
  platform: 'feishu',
  config: { appId, appSecret, domain: 'feishu' },
  permission_admin_enabled: true,
})
```

Channel responses may report the result under `capabilities.feishu_documents`:

- `sync` is `pending`, `applied`, `retry`, or `error`.
- `provider` is `ready` or `degraded` and may include `missing_scopes`.
- `approval_state: 'pending_admin'` means an administrator still has to approve the required
  platform permissions.

Do not treat `permission_admin_enabled: true` as proof that document operations are ready;
read the returned capability state.

::: warning An ignored field is not an access-control list
The public gateway ignores `allow_from`, including on create. The SDK retains it for
compatibility; sending it does not restrict access. Use supported
`dm_policy` settings and verify the effective policy separately.
:::

::: info Verify channel health after binding
Channel creation stores the configuration before the provider health check completes. A
`201` response can carry
`health: 'unknown'` and `status: 'configured'`; an invalid binding later appears as
`health: 'unhealthy'` and `status: 'error'`.

Read the effective state from `health` and `status` on a follow-up `listChannels()` call.
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
- **Prefer an application-specific account name.** `'default'` may already identify a binding
  created in the ZooWork app; reusing it returns `409 channel.conflict`.
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
read. Setting `enabled: false` moves `status` to `'disabled'` and resets `health` to
`'unknown'`.

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

A response shaped as `{"error":{"type":"not_found"}}` belongs to the common resource error
family rather than the channel-specific `{"code": …, "detail": …}` family.

## What binding a channel changes

Two things to design for before you bind:

::: info Chat conversations and API Sessions keep separate context
A conversation in the chat app and a session you create over the API are **different
sessions with different context**. Chat traffic has its own sessions, not automatic context
merging with an API-created session. This is **not API-key access isolation**: authorized API
calls can address an IM session by id. Your backend must enforce
application-user access to each Agent/session. IM sessions reject `actor`; use their
channel-native identity rules.
:::

::: warning `actual_state` is only a health projection
`status.actual_state` is already present on a pure API agent. It can report `active` with zero
channel counts, or `activating` while health information is refreshing. Once a channel is
bound it may report that channel's connectivity, so dashboards
can treat it as **best-effort channel health**. It is still not an API-readiness signal: keep
gating on `desired_state === 'running'` (or `waitUntilRunning`).
:::

Deleting an Agent also requests channel cleanup. If your workflow requires the binding to be
removed before deletion completes, call `removeChannel()` before `deleteAgent()`.
