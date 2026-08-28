---
title: 渠道
source: /en/build/channels
source_hash: db6a05dcd59fc76ba579bb026147af1fedb3044bfb43281fa6f21ee8b4625cf3
---

# 渠道

渠道（channel）把一个聊天平台的账号绑到你的 agent 上：同一个 agent，既回答你的 API session，也在聊天软件里回答真人。

渠道绑在 **agent** 级别，用的就是你手上的 `agent_id`。没绑渠道的 agent 是纯 API agent——这是默认状态，本页的一切对纯 API 使用都不是必需的。

::: warning 新面
2026-08-28 在 SDK 默认指向的那套部署上端到端实测过。这一族随一个较新的网关版本发布，早于它的部署会返回 **404，但错误信封不一样**——是 `{"error":{"type":"not_found"}}`，而不是本族自己的 `{"code": …, "detail": …}`。这个差别就是你区分「这个部署还没有渠道能力」和「那个东西不存在」的依据。
:::

## 能绑哪些平台

2026-08-28 对一套真实部署实测。表外的名字大多返回 `400 channel.invalid_request`——`discord`、`telegram`、`msteams`、`dingtalk-connector` 都是，而且大小写敏感，写成 `WECOM` 同样是 `400`。只有一个名字既没写进文档也没被拒绝：`dingtalk` 在渠道服务的平台列表里，绑定会返回 `201`，但我们没有让它在这套 API 上真正工作过，所以把它当成「未验证」，不是「支持」。

| 平台 | `addChannel` | 服务端扫码流 | 你要提供什么 |
|---|---|---|---|
| `feishu` | ✅ | ✅ | 什么都不用，或应用凭证 |
| `slack` | ✅ | ❌ 永远不会有 | bot token + app token |
| `wecom` | ✅ | ✅ | 什么都不用，或 bot id + secret |
| `weixin` / `wechat` | ❌ | ✅ —— 唯一的路径 | 什么都不用 |

四个平台里三个有扫码流。表里那两个 ❌ 才是需要解释的：Slack 没有扫码流，而微信只有扫码流。

**Slack 不会有。** 服务端驱动的扫码流，前提是聊天平台愿意把凭证交回给发起请求的服务端。Slack 没有这种东西：Slack 应用只能由人在 `api.slack.com/apps` 上创建，它的 `xoxb-` / `xapp-` token 只会出现在那个人的浏览器里。所以 Slack 永远是「`addChannel` + 把两个 token 放进 `config`」。如果你在 ZooWork App 里见过 Slack 的引导式配置，那个引导做的正是这件事：帮人把应用建出来，然后让他粘贴那两个 token——和你在这里传的是同两个。

**微信正好相反：扫码流是它唯一的路径。** 用 `platform: 'weixin'`（或 `'wechat'`）调 `addChannel` 会返回 `400 channel.weixin_setup_required`，这句报错说的就是字面意思——改用 `startChannelSetup(agentId, 'weixin')`。微信这边没有需要你自己准备的凭证。

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

`waitForChannelSetup` 按服务端建议的间隔轮询，并且把**每一种**终态都当返回值交回来，而不是对「人为结果」抛异常——「对方一直没扫码」是一种结果，不是一个 exception。它只在两种情况下抛错：你设的超时到了（`408` / `type: 'timeout'`），或你自己 abort 了（`0` / `'aborted'`）。

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

::: warning session 会「不存在」，那时轮询返回 404
`cancelChannelSetup(agentId, platform, sessionId)` 放弃一个 session——之后再轮询它，返回的是 `404 channel.feishu_session_not_found`（企业微信和微信是 `channel.wecom_session_not_found` / `channel.weixin_session_not_found`），而**不是**某个终态 `status`。所以你自己写的轮询循环必须把这个 404 当成一种结束，而不是当成可重试的传输错误。`waitForChannelSetup` 会把它抛成一个带这个 `type` 的 `ZooworkError`。

至于一个 session 单纯活过了 `expires_in` 之后，是返回 200 带 `status: 'expired'`，还是同样变成这个 404——**我们没有观察到**。两种都要处理。
:::

`brand` 只有飞书有，它决定真实的域名：`'feishu'`（默认）给的是 `open.feishu.cn` 的 URI，`'lark'` 给的是 `open.larksuite.com`。它必须和对方将要批准它的那个工作区对上。

**在把二维码显示出去之前，先把 `account` 定下来**（飞书和企业微信）。命名规则和显式绑定那条路径完全一样，见下面的「给绑定命名：`account`」。在扫码这条路径上它更要紧：对方批准扫码会在那个飞书工作区里注册出一个**新应用**，之后才轮到写绑定记录，所以名字撞了是在**有人已经扫过之后**才以 `409 channel.conflict` 的形式暴露出来，而那个刚注册出来的应用就留在对方的工作区里了。用同一个名字重试，这两件事会再发生一遍。

## 显式配置 —— Slack 走这条

`addChannel` 是非交互路径：它是 Slack 唯一的路径，是飞书和企业微信在扫码流之外的另一条路，微信则完全不接受它。凭证由你提供，放进 `config` 传入。

**`config` 的字段是平台相关的，而且是 camelCase。** 下面这些是渠道服务真正读取的字段；`config` 里的其他键会被存下来但不生效。

| 平台 | `config` |
|---|---|
| `slack` | `{ botToken: 'xoxb-…', appToken: 'xapp-…' }` —— 两个都必需 |
| `wecom` | `{ botId: '…', secret: '…' }` —— 两个都必需 |
| `feishu` | `{ appId: '…', appSecret: '…', domain: 'feishu' \| 'lark' }` —— 只在你跳过扫码流时才需要 |

```ts
await zc.addChannel(agentId, {
  platform: 'slack',
  config: { botToken: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN },
})
```

Slack 跑在 socket mode 下，所以除了 bot token 还需要那个 app 级的 `xapp-` token。两个都在 Slack 应用自己的设置页里拿。

::: warning `allow_from` 会被收下，然后被忽略
创建请求体里仍然可以写 `allow_from`，但写了不起作用：真正生效的值是从 `dm_policy` 推导出来的（`'open'` 就是「所有人」），这个字段也从来不会出现在返回的渠道对象里，`updateChannel` 更没有办法设置它。要控制可达性就用 `dm_policy` / `group_policy`；把 `allow_from` 当成一个为了兼容旧客户端而保留的字段。
:::

`updateChannel` 同样改不了 `config`——见下面换凭证那条。

::: danger 201 的含义是「存下了」，不是「能用」
绑定时**不校验凭证**。我们用一组故意编造的凭证去绑，拿回来的是 `201`，带着 `health: 'unknown'`、`status: 'configured'`——和一个正常绑定返回的形状一模一样。几秒之后，同一个渠道在列表里的状态变成了 `health: 'unhealthy'`、`status: 'error'`。

所以 201 只告诉你绑定被存下来了，不代表它能工作。真正的判定要从后续 `listChannels` 的 `health` / `status` 里读，不要只凭创建调用的成功就向用户报告绑定成功。
:::

### 给绑定命名：`account`

`account` 给这次绑定命名（默认 `'default'`），所以一个 agent 可以在同一平台上持有多个账号。它属于这条记录的身份，不是一个设置项：`updateChannel` 和 `removeChannel` 都靠 `platform` + `account` 找到绑定，而且没有任何接口能给它改名——只能删掉重绑。

选值之前有四件事要知道：

- **这个名字在你名下是全局唯一的，跨所有 agent。** 同一个 (owner, platform, account) 只有一条有效绑定，所以在一个 agent 上占掉 `feishu` / `default`，你其他所有 agent 就都用不了这个名字了。
- **`'default'` 很可能已经被占了**——只要同一个登录账号曾经在 App 里绑过这个平台。那条绑定不是通过这套 API 建的，服务端不会去接管它，直接返回 `409 channel.conflict`。
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

`dm_policy` 和 `group_policy` 是可达性策略——谁能在私聊、谁能在群里找到这个 agent。服务端对两者的默认值都是 `'open'`，另外两个可用值是 `'allowlist'` 和 `'disabled'`，其余一律 `400 channel.invalid_request`。两个例外要知道：`dm_policy: 'pairing'` 在创建和更新时都返回 `400 channel.pairing_unsupported`——pairing 是聊天产品侧的能力，API 创建的 agent 上没有；微信把可用值进一步收窄到 `'open'` 和 `'disabled'`，见[三个平台的差别](#三个平台的差别)。

`updateChannel` 直接把渠道的**新**状态交回来，你不需要再读一次。注意 `enabled: false` 不只是翻一个标志位：实测它会把 `status` 变成 `'disabled'`，并把 `health` 重置为 `'unknown'`。

### 三种 404，各自说明什么

渠道这一族在三种不同情况下都返回 `404`，靠 `code` 区分。请匹配 `code`，不要只看状态码：

| `code` | 发生了什么 | 该怎么办 |
|---|---|---|
| `channel.feishu_session_not_found`，以及它的 `wecom` / `weixin` 两种拼写 | QR session 没了——被取消了，也可能是过期了。 | 重新开一个 setup session。 |
| `channel.not_found` | agent 在，但它在那个平台上没有绑定。 | 没有东西可更新或解绑；先去绑。 |
| `service_api.not_found` | agent 不存在、你没权限访问、或者路径里的 action 不认识。 | 检查 agent id 和路由。 |

注意这里有个不对称，它决定了你的清理代码要不要包 `try`：**`removeChannel` 是幂等的**——删一个不存在的绑定返回 `200 { ok: true }`，不是 404；而 **`updateChannel` 不是**，它返回 `404 channel.not_found`。

还有第四种情况根本不属于这一族：如果整个响应信封是 `{"error":{"type":"not_found"}}` 而不是 `{"code": …, "detail": …}`，说明这个部署还没有渠道路由。

## 绑定渠道之后，什么变了

动手绑之前，有两件事要先设计好：

::: danger 聊天对话和 API session 是分开的
聊天软件里的对话，和你通过 API 创建的 session，是**两个 session、两份上下文**——绑定渠道不会让你的 API 调用读到 agent 在飞书里说了什么，也不能往那段对话里插话。聊天流量会以它自己的 session 出现，不会混进你的 session。如果你的产品需要两边共享一份记忆，那是应用层的设计问题，不是一个开关。
:::

::: warning `actual_state` 开始有含义了
对纯 API agent，`status.actual_state` 永远停在 `activating`，[Agents](/zh/build/agents) 页教你无视它。绑定渠道之后，`actual_state` 报告的是渠道的连通性——它的值会真的变化，仪表盘可以拿它看**渠道健康**。但它仍然不是 API 就绪信号：判断能不能开 session，依旧看 `desired_state === 'running'`（或用 `waitUntilRunning`）。
:::

两条生命周期备注。**绑定不要求 agent 处于运行状态**——一个从来没启动过的 agent，`addChannel` 和扫码流都照收；渠道会在你启动它之后才真正上线。（App 里那条路更严格，所以同一次绑定在那边可能是 `409`、在这里是 `201`。）另外，**删除 agent 会 best-effort 解绑它的渠道**——是真的删掉，不是停用。这个清理永远不会把一次成功的删除变成报错，所以坏运气的时候，一个聊天绑定可能比它的 agent 活得久；如果某个绑定必须消失，先 `removeChannel` 再 `deleteAgent`。
