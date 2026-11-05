---
title: 渠道
description: 把微信、企业微信、飞书、Slack 或钉钉连接到 Agent，并查看、修改或移除连接。
source: /en/build/channels
source_hash: 32f8418fddab3ae981ef045b5efb5b0536c2cd59adc9a86a965c777c9741936c
---

# 渠道

渠道把一个聊天平台账号连接到 Agent。发给这个账号的消息会到达 Agent，Agent 的回复也通过同一个平台发回。连接由你的后端用 API key 创建；聊天账号的所有者要么扫码，要么把应用凭据交给你。

每个 Agent 在每个平台上有一个连接，一个 Agent 可以同时连接多个平台。所有渠道调用都不传 `account`，或者传 `default`。传其他 account 名会返回 `400 channel.account_invalid`。

| 平台 | `platform` | 连接方式 |
|---|---|---|
| 微信 | `weixin` | 只能[扫码](#connect-with-a-qr-code) |
| 企业微信 | `wecom` | 扫码，或使用[应用凭据](#connect-with-app-credentials) |
| 飞书 / Lark | `feishu` | 扫码，或使用应用凭据 |
| Slack | `slack` | 只能使用应用凭据 |
| 钉钉 | `dingtalk-connector` | 只能使用应用凭据 |

## 扫码连接 {#connect-with-a-qr-code}

发起一个 setup 请求，把其中的二维码展示给账号所有者，然后轮询，直到请求不再是 `pending`。连接是在观察到确认的那次 poll 中保存的，所以对方扫码期间要一直轮询。

::: code-group

```ts [TypeScript]
const setup = await client.startChannelSetup(agentId, 'weixin', { dm_policy: 'open' })
const qr = setup.verification_uri_complete ?? setup.qrcode_url
// 把 qr 以二维码形式展示给账号所有者。
const result = await client.waitForChannelSetup(agentId, 'weixin', setup.session_id, {
  timeoutMs: setup.expires_in * 1000,
})
if (result.status !== 'success') throw new Error(`Channel setup ended: ${result.status}`)
```

```python [Python]
setup = await client.start_channel_setup(agent_id, "weixin", {"dm_policy": "open"})
qr = setup.get("verification_uri_complete") or setup.get("qrcode_url")
# 把 qr 以二维码形式展示给账号所有者。
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

使用 curl 时，把 setup 响应中的 `session_id` 保存为 `SETUP_SESSION_ID`，重复调用 poll，直到 `status` 不再是 `pending`。

| 平台 | setup 响应中的二维码值 | `expires_in` | 轮询间隔 |
|---|---|---:|---|
| `feishu` | `verification_uri_complete`，需要编码成二维码的 URL | 600 | 使用响应中的 `poll_interval`。 |
| `wecom` | `qrcode_url`，需要编码成二维码的 URL | 300 | 自行选择，响应中没有。 |
| `weixin` | `qrcode_url`，可能是需要编码的 URL，也可能是内联的 `data:image/` 图片 | 300 | 自行选择，响应中没有。 |

| Setup 字段 | 含义 |
|---|---|
| `dm_policy` | 私信策略：`open`（默认）或 `disabled`。飞书和企业微信还接受 `allowlist`，配合 `allow_from` 使用。 |
| `group_policy` | 飞书和企业微信的群消息策略：`open`（默认）、`allowlist` 或 `disabled`。微信固定为 `disabled`。 |
| `brand` | 仅飞书：`feishu`（默认）或 `lark`，必须与批准扫码的工作区一致。 |
| `permission_admin_enabled` | 仅飞书：启用文档权限管理，默认 `false`。 |

poll 返回 `pending`、`success`、`expired`、`denied`（仅飞书）或 `error`。`waitForChannelSetup` / `wait_for_channel_setup` 返回第一个不是 `pending` 的状态，超过时间限制时抛出 `408` 超时错误。它们的默认时限是 600 秒，所以要像上面那样传入 setup 响应的 `expires_in`。要放弃一个请求，调用 `cancelChannelSetup` / `cancel_channel_setup`，或者 `POST /agents/{agent_id}/channels/{platform}/setup/cancel?session_id=…`。对已取消的请求调用 poll，会返回 `404 channel.{platform}_session_not_found`。

同一个 Agent 再次扫微信，会替换这个 Agent 的微信连接。一个微信号同一时间只能保持一个连接：把它扫给第二个 Agent，第一个 Agent 的连接会断开。Agent 已经连接了飞书或企业微信时，再对该平台发起 setup，会在生成二维码之前返回 `409 channel.conflict`，需要先移除原连接。批准飞书扫码会在该飞书工作区里注册一个新应用。

## 使用应用凭据连接 {#connect-with-app-credentials}

在 `config` 中传入平台的凭据。凭据字段名使用 camelCase。

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

| `platform` | `config` 字段 |
|---|---|
| `slack` | `botToken`（`xoxb-…`）和 `appToken`（`xapp-…`），都必填 |
| `wecom` | `botId` 和 `secret`，都必填 |
| `feishu` | `appId`、`appSecret` 和 `domain`（`feishu` 或 `lark`） |
| `dingtalk-connector` | `clientId` 和 `clientSecret` |

| 字段 | 含义 |
|---|---|
| `platform` | 必填，取上表中的值。`weixin` 会返回 `400 channel.weixin_setup_required`，请改用扫码流程。 |
| `config` | 必填，平台凭据。 |
| `display_name` | 可选，连接的显示名称。 |
| `dm_policy` | 私信策略：`open`（默认）、配合 `allow_from` 的 `allowlist`，或 `disabled`。钉钉接受 `open` 或 `allowlist`。 |
| `allow_from` | `dm_policy` 为 `allowlist` 时允许发私信的发送者 ID。钉钉要求列出具体 ID，不接受 `*`。 |
| `group_policy` | 群消息策略：`open`（默认）、`allowlist` 或 `disabled`。 |
| `permission_admin_enabled` | 仅飞书，默认 `false`。 |

连接保存后，接口返回 `201`。凭据在连接启动时才会校验，保存时不校验：凭据错误会在下一次[列出连接](#check-a-connection)时表现为 `health: unhealthy`。再次发送相同的请求体，会返回已有的连接。同一平台使用不同的 `config` 会返回 `409 channel.conflict`；要替换凭据，先移除连接，再重新添加。

## 查看连接 {#check-a-connection}

`listChannels` / `list_channels` 返回 Agent 的所有连接。Agent 运行时，连接才会上线；绑定本身不会启动 Agent。

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

| 字段 | 含义 |
|---|---|
| `platform` | 平台值。 |
| `account` | 始终为 `default`。 |
| `enabled` | 连接是否开启。 |
| `health` | `unknown`、`healthy`、`degraded` 或 `unhealthy`。连接健康状况看这里。 |
| `status` | 连接状态，例如 `configured`、`running`、`disabled` 或 `error`。 |

Agent 的 `status.actual_state` 和 `status.channels` 不反映渠道健康，见 [Agent 生命周期](./agents.md#agent-生命周期)。

## 修改或移除连接 {#change-or-remove-a-connection}

`updateChannel` / `update_channel` 修改 `enabled`、`dm_policy` 和 `group_policy`，并返回修改后的连接。它不能修改凭据。对没有连接的平台调用 update，会返回 `404 channel.not_found`。

`removeChannel` / `remove_channel` 移除该平台的连接。移除一个不存在的连接也会成功。删除 Agent 会移除它的所有连接。

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

## 处理错误 {#handle-errors}

| 情况 | 处理方式 |
|---|---|
| poll 返回 `expired`、`denied` 或 `error` | 重新发起 setup 请求，展示新的二维码。 |
| poll 返回 `404 channel.{platform}_session_not_found` | 请求已不存在（例如已被取消），或者属于另一个 Agent。重新发起。 |
| `409 channel.conflict` | Agent 已经连接了这个平台，或者凭据与已保存的不同。先移除连接。 |
| `409 channel.{platform}_setup_in_progress` | 扫码已确认，连接正在保存。继续轮询。 |
| `429` | setup 请求过多。等几秒再重试。 |

完整的渠道错误码见[错误](../reference/errors.md#channel-errors)。

## 接入自己的聊天应用 {#connect-your-own-chat-application}

如果你要用的平台不在上面的列表里，或者你的应用必须自己负责消息路由，可以在后端把聊天平台接到普通的 API Session 上：

1. 通过聊天平台自己的 API 接收消息，并认证发送者。
2. 在你的应用中找到该发送者对应的 Agent 和 Session。用户之间不能共享持久化文件时，使用[每个用户一个 Agent](./per-user-agents.md)。
3. 新对话时[创建 Session](./sessions.md)，已有对话则向它的 Session [发送事件](./events.md#user-message)。
4. 读取[事件流](./events.md#streaming-a-turn)，再通过聊天平台的 API 把 Agent 的回复发出去。

这种方式下，消息路由、用户访问检查和投递重试都由你的应用负责。

## 下一步

- [Session](./sessions.md)：读取渠道发起的对话。
- [Agent 生命周期](./agents.md#agent-生命周期)：启动 Agent，让它的连接上线。
- [错误](../reference/errors.md#channel-errors)：所有渠道错误码。
