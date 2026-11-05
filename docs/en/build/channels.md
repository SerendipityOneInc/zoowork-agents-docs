---
description: Connect WeChat, WeCom, Feishu, Slack, or DingTalk to an Agent, then check, change, or remove the connection.
---

# Channels

A channel connects a chat platform account to an Agent. Messages sent to that account reach
the Agent, and the Agent replies on the same platform. Your backend creates the connection with
its API key; the person who owns the chat account either scans a QR code or gives you the app
credentials.

Each Agent has one connection per platform, and one Agent can be connected to several
platforms at once. Omit `account`, or pass `default`, on every channel call. Any other account
name returns `400 channel.account_invalid`.

| Platform | `platform` | How to connect |
|---|---|---|
| WeChat | `weixin` | [QR code](#connect-with-a-qr-code) only |
| WeCom | `wecom` | QR code, or [app credentials](#connect-with-app-credentials) |
| Feishu / Lark | `feishu` | QR code, or app credentials |
| Slack | `slack` | App credentials only |
| DingTalk | `dingtalk-connector` | App credentials only |

## Connect with a QR code

Start a setup request, show its QR code to the account owner, and poll until the request
leaves `pending`. The connection is saved by the poll that observes the confirmation, so keep
polling while the person scans.

::: code-group

```ts [TypeScript]
const setup = await client.startChannelSetup(agentId, 'weixin', { dm_policy: 'open' })
const qr = setup.verification_uri_complete ?? setup.qrcode_url
// Show qr to the account owner as a QR code.
const result = await client.waitForChannelSetup(agentId, 'weixin', setup.session_id, {
  timeoutMs: setup.expires_in * 1000,
})
if (result.status !== 'success') throw new Error(`Channel setup ended: ${result.status}`)
```

```python [Python]
setup = await client.start_channel_setup(agent_id, "weixin", {"dm_policy": "open"})
qr = setup.get("verification_uri_complete") or setup.get("qrcode_url")
# Show qr to the account owner as a QR code.
result = await client.wait_for_channel_setup(
    agent_id, "weixin", setup["session_id"], timeout=setup["expires_in"]
)
if result["status"] != "success":
    raise RuntimeError(f"Channel setup ended: {result['status']}")
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/channels/weixin/setup" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dm_policy":"open"}'

curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/channels/weixin/poll?session_id=$SETUP_SESSION_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

For curl, save the setup response's `session_id` as `SETUP_SESSION_ID` and repeat the poll
until `status` is no longer `pending`.

| Platform | QR value in the setup response | `expires_in` | Poll interval |
|---|---|---:|---|
| `feishu` | `verification_uri_complete`, a URL to encode | 600 | Use the response's `poll_interval`. |
| `wecom` | `qrcode_url`, a URL to encode | 300 | Choose your own; none is returned. |
| `weixin` | `qrcode_url`, a URL to encode or an inline `data:image/` image | 300 | Choose your own; none is returned. |

| Setup field | Meaning |
|---|---|
| `dm_policy` | Direct messages: `open` (default) or `disabled`. Feishu and WeCom also accept `allowlist` with `allow_from`. |
| `group_policy` | Group messages for Feishu and WeCom: `open` (default), `allowlist`, or `disabled`. WeChat always uses `disabled`. |
| `brand` | Feishu only: `feishu` (default) or `lark`. It must match the workspace that approves the scan. |
| `permission_admin_enabled` | Feishu only: enable document-permission administration. Defaults to `false`. |

A poll reports `pending`, `success`, `expired`, `denied` (Feishu only), or `error`.
`waitForChannelSetup` / `wait_for_channel_setup` return the first status other than `pending`
and raise a `408` timeout error when the time limit passes. Their default limit is 600 seconds,
so pass the setup response's `expires_in`, as above. To abandon a request, call
`cancelChannelSetup` / `cancel_channel_setup`, or `POST
/agents/{agent_id}/channels/{platform}/setup/cancel?session_id=…`. Polling a cancelled request
returns `404 channel.{platform}_session_not_found`.

Scanning WeChat again for the same Agent replaces that Agent's WeChat connection. A WeChat
account holds one connection at a time: scanning it for a second Agent disconnects the first.
Feishu and WeCom setup on an Agent that is already connected to that platform returns
`409 channel.conflict` before a QR code is issued; remove the connection first. Approving a
Feishu scan registers a new app in that Feishu workspace.

## Connect with app credentials

Pass the platform's credentials in `config`. Credential keys are camelCase.

::: code-group

```ts [TypeScript]
const channel = await client.addChannel(agentId, {
  platform: 'slack',
  config: { botToken: process.env.SLACK_BOT_TOKEN!, appToken: process.env.SLACK_APP_TOKEN! },
})
```

```python [Python]
import os

channel = await client.add_channel(agent_id, {
    "platform": "slack",
    "config": {"botToken": os.environ["SLACK_BOT_TOKEN"], "appToken": os.environ["SLACK_APP_TOKEN"]},
})
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/channels" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg bot "$SLACK_BOT_TOKEN" --arg app "$SLACK_APP_TOKEN" \
    '{platform:"slack",config:{botToken:$bot,appToken:$app}}')"
```

:::

| `platform` | `config` keys |
|---|---|
| `slack` | `botToken` (`xoxb-…`) and `appToken` (`xapp-…`), both required |
| `wecom` | `botId` and `secret`, both required |
| `feishu` | `appId`, `appSecret`, and `domain` (`feishu` or `lark`) |
| `dingtalk-connector` | `clientId` and `clientSecret` |

| Field | Meaning |
|---|---|
| `platform` | Required. One of the values above. `weixin` returns `400 channel.weixin_setup_required`; use the QR flow. |
| `config` | Required credentials for the platform. |
| `display_name` | Optional label for the connection. |
| `dm_policy` | Direct messages: `open` (default), `allowlist` with `allow_from`, or `disabled`. DingTalk accepts `open` or `allowlist`. |
| `allow_from` | Sender IDs allowed to send direct messages when `dm_policy` is `allowlist`. DingTalk requires explicit IDs; `*` is rejected. |
| `group_policy` | Group messages: `open` (default), `allowlist`, or `disabled`. |
| `permission_admin_enabled` | Feishu only. Defaults to `false`. |

The response answers `201` once the connection is stored. Credentials are checked when the
connection starts, not when it is stored: wrong credentials show up as `health: unhealthy` on
the next [list](#check-a-connection). Sending the same body again returns the existing
connection. The same platform with different `config` returns `409 channel.conflict`; to
replace credentials, remove the connection and add it again.

## Check a connection

`listChannels` / `list_channels` returns the Agent's connections. A connection comes online
when its Agent is running; binding does not start the Agent.

::: code-group

```ts [TypeScript]
const channels = await client.listChannels(agentId)
```

```python [Python]
channels = await client.list_channels(agent_id)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/channels" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

| Field | Meaning |
|---|---|
| `platform` | The platform value. |
| `account` | Always `default`. |
| `enabled` | Whether the connection is switched on. |
| `health` | `unknown`, `healthy`, `degraded`, or `unhealthy`. Read connection health here. |
| `status` | Connection state, such as `configured`, `running`, `disabled`, or `error`. |

The Agent's `status.actual_state` and `status.channels` do not report channel health; see
[Agent lifecycle](./agents.md#agent-lifecycle).

## Change or remove a connection

`updateChannel` / `update_channel` changes `enabled`, `dm_policy`, and `group_policy`, and
returns the connection in its new state. It does not change credentials. Updating a platform
with no connection returns `404 channel.not_found`.

`removeChannel` / `remove_channel` removes the platform's connection. Removing a connection
that does not exist also succeeds. Deleting an Agent removes all of its connections.

::: code-group

```ts [TypeScript]
await client.updateChannel(agentId, 'weixin', { enabled: false })
await client.removeChannel(agentId, 'weixin')
```

```python [Python]
await client.update_channel(agent_id, "weixin", {"enabled": False})
await client.remove_channel(agent_id, "weixin")
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/channels/weixin/update" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'

curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/channels/weixin/remove" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"account":"default"}'
```

:::

## Handle errors

| Case | What to do |
|---|---|
| A poll returns `expired`, `denied`, or `error` | Start a new setup request and show the new QR code. |
| `404 channel.{platform}_session_not_found` on a poll | The request no longer exists, for example after it was cancelled, or it belongs to another Agent. Start a new one. |
| `409 channel.conflict` | The Agent already has this platform, or the credentials differ from the stored ones. Remove the connection first. |
| `409 channel.{platform}_setup_in_progress` | A scan was confirmed and the connection is being saved. Keep polling. |
| `429` | Too many setup requests. Wait a few seconds before retrying. |

The full list of channel error codes is in [Errors](../reference/errors.md#channel-errors).

## Connect your own chat application

If a platform is not listed above, or your application must own message routing, connect the
chat platform to ordinary API Sessions from your backend:

1. Receive messages through the chat platform's own API and authenticate the sender.
2. Look up the sender's Agent and Session in your application. Use
   [an Agent per user](./per-user-agents.md) when users must not share persisted files.
3. [Create a Session](./sessions.md) for a new conversation, or
   [send events](./events.md#user-message) to its existing Session.
4. Read the [event stream](./events.md#streaming-a-turn) and send the Agent's response through
   the chat platform's API.

Your application then owns message routing, user access checks, and delivery retries.

## Next steps

- [Sessions](./sessions.md): read the conversations a channel starts.
- [Agent lifecycle](./agents.md#agent-lifecycle): start the Agent so its connections come online.
- [Errors](../reference/errors.md#channel-errors): every channel error code.
