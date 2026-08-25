# Channels

A channel binds a chat platform account to your agent, so the same agent that answers your
API sessions also answers people in a chat app.

Channels attach at the **agent** level, keyed by the same `agent_id` you already hold. An
agent with no channels is a pure API agent — that is the default, and nothing on this page is
required for API use.

::: warning New surface, rolling out
Verified end to end on 2026-08-25. This family arrives with a gateway release that is still
rolling out, and a deployment without it answers **404 with a different error envelope** —
`{"error":{"type":"not_found"}}` instead of this family's `{"code": …, "detail": …}`. That
difference is how you tell "this deployment has no channels yet" from "that thing does not
exist". Requires `@zooclaw-agents/sdk` ≥ 0.3.1.
:::

## Which platforms you can bind

Every row below was probed against a live deployment on 2026-08-25. The table is the whole
truth: a platform outside it answers `400 channel.invalid_request`.

| Platform | `addChannel` | QR setup flow | Appears in `listChannels` |
|---|---|---|---|
| `feishu` | ✅ | ✅ — the only one | ✅ |
| `slack` | ✅ | ❌ | ✅ |
| `wecom` | ✅ | ❌ | ✅ |
| `mattermost` | ✅ | ❌ | ❌ **never** — see below |
| `weixin` / `wechat` | ❌ | ❌ | — |

So there are really three cases. **Feishu** has both paths: the QR device flow and explicit
config. **Slack and WeCom** have explicit config only — you bring the platform app's own
credentials. **WeChat cannot be bound through this API at all**: it answers
`400 channel.weixin_setup_required` with the message "Connect WeChat via the QR setup flow",
and that flow does not exist here (`/channels/weixin/setup` is a 404). Do not build on the
error message; treat WeChat as unavailable.

::: danger A Mattermost binding is invisible
`addChannel({ platform: 'mattermost' })` answers `201` and the binding is real — you can
update it and remove it — but **it never appears in `listChannels`**, which filters Mattermost
out. So the list is not a complete inventory: after binding Mattermost, an empty list does not
mean "nothing is bound".

If you bind it, keep your own record that you did. Everything keyed by platform still works on
it, so `updateChannel(agentId, 'mattermost', …)` and `removeChannel(agentId, 'mattermost')`
both behave normally.
:::

## The Feishu QR device flow

This is the interactive path, and Feishu is the only platform that has one: you get a
verification URL, show it to the person who owns the Feishu workspace (usually as a QR code),
and poll until they approve. Your code never touches platform credentials.

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

// 1. Start a setup session.
const setup = await zc.startFeishuSetup(agentId)

// 2. YOU own the UI: render the URL — typically as a QR code — and show it.
//    The session expires after setup.expires_in seconds.
console.log(setup.verification_uri_complete)

// 3. Let the SDK drive the poll loop until the person approves (or doesn't).
const done = await zc.waitForFeishuSetup(agentId, setup.session_id, {
  timeoutMs: setup.expires_in * 1000,
  onPoll: (p) => console.log('…', p.status),
})

if (done.status === 'success') {
  console.log('bound:', await zc.listChannels(agentId))
} else {
  console.log('not bound:', done.status)   // 'expired' | 'denied' | 'error'
}
```

`waitForFeishuSetup` polls at the server's suggested interval and returns **every** terminal
outcome instead of throwing on the human ones — "the person never scanned" is an outcome,
not an exception. It throws only for a timeout you set (`408` / `type: 'timeout'`) or your
own abort (`0` / `'aborted'`).

If you drive the loop yourself, use `pollFeishuSetup(agentId, sessionId)` and treat `status`
values you do not recognize as still-in-flight:

| `status` | Meaning |
|---|---|
| `pending` | Waiting for the person. Keep polling at `poll_interval` seconds. |
| `success` | Bound. `channel_configured: true`. |
| `expired` | The session outlived `expires_in`. Start a new one. |
| `denied` | The person rejected it. |
| `error` | Something else went wrong; `message` has the detail. |

A pending poll answers `{ status: 'pending', channel_configured: false, message: null,
poll_interval: 5 }`. Observed defaults on a fresh session: `expires_in: 600`,
`poll_interval: 5`.

::: warning A session can stop existing, and then polling 404s
`cancelFeishuSetup(agentId, sessionId)` abandons a session — and afterwards polling it answers
`404 channel.feishu_session_not_found` rather than a terminal `status`. So a hand-rolled loop
must treat that 404 as an ending, not as a transport error to retry. `waitForFeishuSetup`
surfaces it as a thrown `ZooclawError` carrying that `type`.

Whether a session that simply runs past `expires_in` reports `status: 'expired'` in a 200 or
disappears into the same 404 has not been observed. Handle both.
:::

`brand` picks the real host: `'feishu'` (default) gives an `open.feishu.cn` URI, `'lark'` gives
`open.larksuite.com`. It has to match the workspace the person will approve it in.

## Explicit config — the path for Slack and WeCom

`addChannel` is the non-interactive path, and the only path for Slack and WeCom. You already
hold the platform app's credentials and pass them in `config`.

```ts
await zc.addChannel(agentId, { platform: 'slack',  config: { /* Slack app credentials  */ } })
await zc.addChannel(agentId, { platform: 'wecom',  config: { /* WeCom app credentials  */ } })
await zc.addChannel(agentId, { platform: 'feishu', config: { /* Feishu app credentials */ } })
```

The `config` keys are platform-specific — they are the credentials of the platform app you
are binding, passed through to the channel service. `account` names the binding (default
`'default'`) so one agent can hold several accounts on one platform.

Binding the same `platform` + `account` twice is **not** an error and does not create a second
channel: the second call answers `201` and overwrites the first. Treat `addChannel` as an
upsert, not a create.

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
| `channel.feishu_session_not_found` | The QR session is gone — cancelled, or possibly expired. | Start a new setup session. |
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
