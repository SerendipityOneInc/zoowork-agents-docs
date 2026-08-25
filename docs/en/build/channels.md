# Channels

A channel binds a chat platform account to your agent, so the same agent that answers your
API sessions also answers people in a chat app. Feishu (and its international brand Lark) is
the platform this page covers; it is the one with a first-class setup flow.

Channels attach at the **agent** level, keyed by the same `agent_id` you already hold. An
agent with no channels is a pure API agent — that is the default, and nothing on this page is
required for API use.

::: warning New surface
This family ships with a gateway release rolling out in late August 2026. On deployments
without it, every route below answers **404** — if that is what you see, the deployment you
are talking to does not have channels yet. Requires `@zooclaw-agents/sdk` ≥ 0.3.0.
:::

## Two ways to bind Feishu

**The QR device flow** is the interactive path: you get a verification URL, show it to the
person who owns the Feishu workspace (usually as a QR code), and poll until they approve.
Your code never touches platform credentials.

**Explicit config** (`addChannel`) is the non-interactive path: you already hold the
platform app's credentials and pass them in `config`. Use this for scripted setups.

## The QR device flow

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

Abandon a session you no longer want with `cancelFeishuSetup(agentId, sessionId)`.

To brand the flow for international workspaces, pass `{ brand: 'lark' }` to
`startFeishuSetup`.

## Explicit config

```ts
const channel = await zc.addChannel(agentId, {
  platform: 'feishu',
  config: { /* the platform app's own credential keys */ },
})
```

The `config` keys are platform-specific — they are the credentials of the platform app you
are binding, passed through to the channel service. `account` names the binding (default
`'default'`) so one agent can hold several accounts on one platform.

`allow_from` is accepted **only at create** and cannot be edited later.

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
direct messages and in groups. `'open'` is the server default for both.

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
