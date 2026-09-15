---
title: 渠道
description: 把 agent 接入聊天平台，并管理各渠道的配置流程与生命周期。
source: /en/build/channels
source_hash: 3807ca20e877ccb3adbf663b45e22536a68b41cf630cf34012f6a3a8e072a469
---

# 渠道

渠道（channel）把一个聊天平台的账号绑到你的 agent 上：同一个 agent，既回答你的 API session，也在聊天软件里回答真人。

渠道绑在 **agent** 级别，用的就是你手上的 `agent_id`。没绑渠道的 agent 是纯 API agent——这是默认状态，本页的一切对纯 API 使用都不是必需的。

## 能绑哪些平台

| 平台 | 配置方式 | 你要提供什么 |
|---|---|---|
| `feishu` | 扫码或直接传凭证 | 无，或应用凭证 |
| `slack` | 直接传凭证 | bot token + app token |
| `wecom` | 扫码或直接传凭证 | 无，或 bot id + secret |
| `weixin` / `wechat` | 扫码 | 无 |
| `dingtalk-connector` | 直接传凭证 | client id + client secret |

飞书、企业微信和微信提供扫码流程。Slack 和钉钉使用显式凭证。

**Slack 使用显式凭证。** 在 `api.slack.com/apps` 创建 Slack 应用，然后把它的 `xoxb-` 和 `xapp-` token 放进 `config` 传给 `addChannel`。ZooWork App 中的引导式配置收集的也是这两个值。

**微信使用引导式配置。** 调用 `startChannelSetup(agentId, 'weixin')`，并展示返回的二维码。使用 `platform: 'weixin'` 或 `'wechat'` 调用 `addChannel` 会返回 `400 channel.weixin_setup_required`。

**钉钉在公共 API 中使用显式配置。** 调用 `addChannel` 时传 `platform: 'dingtalk-connector'`、`config: { clientId, clientSecret }` 和 `dm_policy: 'open'`。

## 扫码流

这是交互路径，飞书、企业微信、微信三家都有：你拿到一个 URL，展示给聊天工作区的所有者（通常渲染成二维码），然后轮询直到对方批准。你的代码全程不接触平台凭证。

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

// 1. 开一个 setup session。platform 是 'feishu' / 'wecom' / 'weixin' 之一。
const setup = await zc.startChannelSetup(agentId, 'feishu')

// 2. UI 归你管：把这个 URL 渲染出来（通常是二维码）展示给对方。
//    飞书返回 verification_uri_complete，企业微信和微信返回 qrcode_url。
//    session 会在 setup.expires_in 秒后过期。
console.log(setup.verification_uri_complete ?? setup.qrcode_url)

// 3. 让 SDK 驱动轮询，直到对方批准（或者没批准）。
const done = await zc.waitForChannelSetup(agentId, 'feishu', setup.session_id, {
  timeoutMs: setup.expires_in * 1000,
  onPoll: (p) => console.log('…', p.status),
})

if (done.status === 'success') {
  console.log('已绑定:', await zc.listChannels(agentId))
} else {
  console.log('未绑定:', done.status)   // 'expired' | 'denied' | 'error'
}
```

`waitForChannelSetup` 按服务端建议的间隔轮询，并且把**每一种**终态都当返回值交回来，而不是对「人为结果」抛异常——「对方一直没扫码」是一种结果，不是一个 exception。它也会因 HTTP/传输失败抛错；本地超时是 `408` / `type: 'timeout'`，自己取消是 `0` / `'aborted'`。

如果你自己驱动轮询，用 `pollChannelSetup(agentId, platform, sessionId)`，并把不认识的 `status` 一律当作仍在进行中：

| `status` | 含义 |
|---|---|
| `pending` | 等对方操作。按 `poll_interval` 秒继续轮询。 |
| `success` | 已绑定。`channel_configured: true`。 |
| `expired` | session 活过了 `expires_in`。重新开一个。 |
| `denied` | 对方拒绝了。只有飞书有这个状态。 |
| `error` | 其他错误；细节在 `message` 里。 |

pending 的一次轮询返回的是 `{ status: 'pending', channel_configured: false, message: null }`，飞书还会多一个 `poll_interval: 5`。

### 三个平台的差别

三条流走的是同一组路由、同一套 `status` 词汇，差别在于 setup 返回什么、请求体能写什么：

| | `feishu` | `wecom` | `weixin` |
|---|---|---|---|
| setup 返回 | `verification_uri_complete` | `qrcode_url` | `qrcode_url` |
| `poll_interval` | `5` | 没有——间隔由你自己定 | 没有 |
| `expires_in` | `600` | `300` | `300` |
| 请求体读哪些字段 | `brand`、`account`、`dm_policy`、`group_policy` | `account`、`dm_policy`、`group_policy` | 只有 `dm_policy` |

有两点要在代码里处理。**微信的 `qrcode_url` 可能是一张内嵌图片**，也就是 `data:image/…` 而不是一个 URL，所以喂给二维码库之前先判断前缀。另外**微信的 `dm_policy` 只接受 `'open'` 和 `'disabled'`**——传 `'allowlist'` 返回 `400 channel.allowlist_unsupported`——它把 account 钉死为 `'default'`、group policy 钉死为 `'disabled'`，请求体里的其他字段会被忽略而不是报错。

::: info 处理已取消或过期的 setup session
调用 `cancelChannelSetup(agentId, platform, sessionId)` 后，继续轮询会返回 `404 channel.feishu_session_not_found`（企业微信和微信对应 `channel.wecom_session_not_found` / `channel.weixin_session_not_found`），而不是终态 `status`。自定义轮询循环应把这个 404 作为终态处理。`waitForChannelSetup` 会返回一个带对应 `type` 的 `ZooworkError`。

setup Session 到达 `expires_in` 后，可能以 `status: 'expired'` 结束，也可能变成同样的 404。两种都应当作为终态处理。
:::

`brand` 只有飞书有，它决定真实的域名：`'feishu'`（默认）给的是 `open.feishu.cn` 的 URI，`'lark'` 给的是 `open.larksuite.com`。它必须和对方将要批准它的那个工作区对上。

**在把二维码显示出去之前，先把 `account` 定下来**（飞书和企业微信）。命名规则和显式绑定那条路径完全一样，见下面的「给绑定命名：`account`」。在扫码这条路径上它更要紧：对方批准扫码会在那个飞书工作区里注册出一个**新应用**，之后才轮到写绑定记录，所以名字撞了是在**有人已经扫过之后**才以 `409 channel.conflict` 的形式暴露出来，而那个刚注册出来的应用就留在对方的工作区里了。用同一个名字重试，这两件事会再发生一遍。

## 显式配置 —— Slack、钉钉、飞书和企业微信

`addChannel` 是非交互路径：它是 Slack 和钉钉在公共 API 中唯一的路径，是飞书和企业微信在扫码流之外的另一条路，微信则完全不接受它。凭证由你提供，放进 `config` 传入。

**`config` 的字段是平台相关的，而且是 camelCase。** 下面这些是渠道服务真正读取的字段；`config` 里的其他键会被存下来但不生效。

| 平台 | `config` |
|---|---|
| `slack` | `{ botToken: 'xoxb-…', appToken: 'xapp-…' }` —— 两个都必需 |
| `wecom` | `{ botId: '…', secret: '…' }` —— 两个都必需 |
| `feishu` | `{ appId: '…', appSecret: '…', domain: '…' }` —— 只在你跳过扫码流时才需要 |
| `dingtalk-connector` | `{ clientId: '…', clientSecret: '…' }` —— 两个都必需；同时使用 `dm_policy: 'open'` |

```ts
await zc.addChannel(agentId, {
  platform: 'slack',
  config: { botToken: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN },
})
```

Slack 跑在 socket mode 下，所以除了 bot token 还需要那个 app 级的 `xapp-` token。两个都在 Slack 应用自己的设置页里拿。

### 飞书文档权限

飞书绑定在直接添加、更新和扫码配置时都接受 `permission_admin_enabled: true`。这个字段表示开启文档权限管理；省略时默认关闭。

```ts
await zc.addChannel(agentId, {
  platform: 'feishu',
  config: { appId, appSecret, domain: 'feishu' },
  permission_admin_enabled: true,
})
```

渠道响应可以在 `capabilities.feishu_documents` 下返回生效状态：

- `sync` 是 `pending`、`applied`、`retry` 或 `error`。
- `provider` 是 `ready` 或 `degraded`，还可能带 `missing_scopes`。
- `approval_state: 'pending_admin'` 表示仍需管理员批准平台权限。

不要把 `permission_admin_enabled: true` 当作文档操作已经就绪的证明；应读取返回的 capability 状态。

::: warning 被忽略的字段不是访问白名单
公共网关会忽略 `allow_from`，创建时也一样。SDK 为兼容保留这个字段，传入它并不能限制访问。请使用 `dm_policy` 设置，并检查实际生效的策略。
:::

::: info 绑定后检查渠道健康状态
创建渠道时会先保存配置，再完成平台健康检查。`201` 响应可能带 `health: 'unknown'`、`status: 'configured'`；
无效绑定随后会显示为 `health: 'unhealthy'`、`status: 'error'`。

通过后续 `listChannels()` 返回的 `health` 和 `status` 读取最终状态。
:::

### 给绑定命名：`account`

`account` 给这次绑定命名（默认 `'default'`），所以一个 agent 可以在同一平台上持有多个账号。它属于这条记录的身份，不是一个设置项：`updateChannel` 和 `removeChannel` 都靠 `platform` + `account` 找到绑定，而且没有任何接口能给它改名——只能删掉重绑。

选值之前有四件事要知道：

- **这个名字在你名下是全局唯一的，跨所有 agent。** 同一个 (owner, platform, account) 只有一条有效绑定，所以在一个 agent 上占掉 `feishu` / `default`，你其他所有 agent 就都用不了这个名字了。
- **建议使用应用专属的 account 名称。** `'default'` 可能已经对应 ZooWork App 创建的绑定；重复使用会返回 `409 channel.conflict`。
- **格式是 `^[a-z0-9][a-z0-9_-]{0,63}$`**，另外还有三个保留字（`__proto__`、`prototype`、`constructor`）。别的都是 `400`，而且服务端不会替你做任何规范化——带大写、空格或非 ASCII 字符的显示名会被拒掉，不会被清洗。
- **SDK 没法替你预检这个名字。** `listChannels` 的范围是单个 agent，而这个约束覆盖你整个账号，所以被你另一个 agent 占掉的名字在这里根本看不见。自己记账。

::: warning 换凭证要先 remove 再 add
拿**完全相同**的请求体去绑同一个 `platform` + `account`，返回的还是 `201`，而且回放的是你已经有的那条绑定——它不会产生第二个渠道，也不会覆盖任何东西。同一对组合换一份**不同的 `config`** 再绑，返回的是 `409 channel.conflict`。

所以 `addChannel` 不是 upsert。要把一个绑定换到新凭证上，先 `removeChannel` 再 `addChannel`；直接重绑会失败。
:::

## 列表、更新、解绑

```ts
const channels = await zc.listChannels(agentId)
// [{ platform: 'feishu', account: 'default', enabled: true, health: …, status: …, … }]

await zc.updateChannel(agentId, 'feishu', { enabled: false })   // 暂停但不解绑
await zc.updateChannel(agentId, 'feishu', { dm_policy: 'open' })

await zc.removeChannel(agentId, 'feishu')                        // account: 'default'
await zc.removeChannel(agentId, 'feishu', { account: 'sales' })
```

`dm_policy` 和 `group_policy` 是可达性策略——谁能在私聊、谁能在群里找到这个 agent。服务端对两者的默认值都是 `'open'`，传枚举外的值返回 `400 channel.invalid_request`。有一个值在这里被直接拒绝：`dm_policy: 'pairing'` 在创建和更新时都返回 `400 channel.pairing_unsupported`——pairing 是聊天产品侧的能力，API 创建的 agent 上没有。

`updateChannel` 直接返回渠道的**新**状态，不需要再读一次。设置 `enabled: false` 会把 `status` 变成 `'disabled'`，并把 `health` 重置为 `'unknown'`。

### 三种 404，各自说明什么

渠道这一族在三种不同情况下都返回 `404`，靠 `code` 区分。请匹配 `code`，不要只看状态码：

| `code` | 发生了什么 | 该怎么办 |
|---|---|---|
| `channel.feishu_session_not_found`，以及它的 `wecom` / `weixin` 两种拼写 | QR session 没了——被取消了，也可能是过期了。 | 重新开一个 setup session。 |
| `channel.not_found` | agent 在，但它在那个平台上没有绑定。 | 没有东西可更新或解绑；先去绑。 |
| `service_api.not_found` | agent 不存在、你没权限访问、或者路径里的 action 不认识。 | 检查 agent id 和路由。 |

注意这里有个不对称，它决定了你的清理代码要不要包 `try`：**`removeChannel` 是幂等的**——删一个不存在的绑定返回 `200 { ok: true }`，不是 404；而 **`updateChannel` 不是**，它返回 `404 channel.not_found`。

`{"error":{"type":"not_found"}}` 这种响应属于通用资源错误，而不是渠道特有的 `{"code": …, "detail": …}` 错误族。

## 绑定渠道之后，什么变了

动手绑之前，有两件事要先设计好：

::: info 聊天对话与 API Session 使用独立上下文
聊天软件里的对话，和你通过 API 创建的 Session，是**两个 Session、两份上下文**，不会自动合并。这**不等于 API key 的访问隔离**：有权限的 API 调用可以按 id 访问 IM Session。你的后端必须校验应用用户对每个 Agent 和 Session 的权限。IM Session 拒绝 `actor`，应使用渠道原生身份规则。
:::

::: warning `actual_state` 只是健康投影
纯 API Agent 上也会出现 `status.actual_state`。它可能显示为 `active` 且渠道计数为零，也可能在健康信息刷新时显示 `activating`。绑定渠道后，它可以反映渠道连通性，仪表盘可以把它作为**尽力而为的渠道健康度**。它不是 API 就绪信号：判断能否创建 Session，仍然看 `desired_state === 'running'`，或使用 `waitUntilRunning`。
:::

删除 Agent 时也会请求清理渠道。如果业务流程要求绑定先完成移除，请先调用 `removeChannel()`，再调用 `deleteAgent()`。
