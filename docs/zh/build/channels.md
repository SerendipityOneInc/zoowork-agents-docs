---
title: 渠道
source: /en/build/channels
source_hash: cf9a86d816a92541b2ef271afc28eb0a1697e2a7f2509764aa916db3c33d88c8
---

# 渠道

渠道（channel）把一个聊天平台的账号绑到你的 agent 上：同一个 agent，既回答你的 API session，也在聊天软件里回答真人。

渠道绑在 **agent** 级别，用的就是你手上的 `agent_id`。没绑渠道的 agent 是纯 API agent——这是默认状态，本页的一切对纯 API 使用都不是必需的。

::: warning 新面，正在灰度
2026-08-25 端到端实测过。这一族随一个仍在灰度的网关版本发布，没带上它的部署会返回 **404，但错误信封不一样**——是 `{"error":{"type":"not_found"}}`，而不是本族自己的 `{"code": …, "detail": …}`。这个差别就是你区分「这个部署还没有渠道能力」和「那个东西不存在」的依据。需要 `@zooclaw-agents/sdk` ≥ 0.3.1。
:::

## 能绑哪些平台

下面每一行都在 2026-08-25 对一套真实部署实测过。这张表就是全部：表外的平台名一律返回 `400 channel.invalid_request`。

| 平台 | `addChannel` | QR 设置流 | 在 `listChannels` 里可见 |
|---|---|---|---|
| `feishu` | ✅ | ✅ —— 唯一有的 | ✅ |
| `slack` | ✅ | ❌ | ✅ |
| `wecom` | ✅ | ❌ | ✅ |
| `mattermost` | ✅ | ❌ | ❌ **永远不可见** —— 见下 |
| `weixin` / `wechat` | ❌ | ❌ | — |

所以实际上是三种情况。**飞书**两条路都有：QR 设备流和显式配置。**Slack 和企业微信**只有显式配置——凭证由你提供。**微信通过这套 API 根本绑不了**：它返回 `400 channel.weixin_setup_required`，报错文案是「Connect WeChat via the QR setup flow」，而那条流程在这里并不存在（`/channels/weixin/setup` 是 404）。不要照着这句报错去找路，把微信当成不可用。

::: danger 绑定 Mattermost 之后它是隐形的
`addChannel({ platform: 'mattermost' })` 返回 `201`，绑定是真的——你能 update 它、也能 remove 它——但**它永远不会出现在 `listChannels` 里**，服务端把 mattermost 过滤掉了。所以这个列表不是一份完整清单：绑过 mattermost 之后，列表为空并不代表「什么都没绑」。

如果你绑了它，就得自己记一笔。所有按平台定位的操作对它照常有效，`updateChannel(agentId, 'mattermost', …)` 和 `removeChannel(agentId, 'mattermost')` 的行为都正常。
:::

## 飞书 QR 设备流

这是交互路径，也只有飞书有：你拿到一个验证 URL，展示给飞书工作区的所有者（通常渲染成二维码），然后轮询直到对方批准。你的代码全程不接触平台凭证。

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

// 1. 开一个 setup session。
const setup = await zc.startFeishuSetup(agentId)

// 2. UI 归你管：把这个 URL 渲染出来（通常是二维码）展示给对方。
//    session 会在 setup.expires_in 秒后过期。
console.log(setup.verification_uri_complete)

// 3. 让 SDK 驱动轮询，直到对方批准（或者没批准）。
const done = await zc.waitForFeishuSetup(agentId, setup.session_id, {
  timeoutMs: setup.expires_in * 1000,
  onPoll: (p) => console.log('…', p.status),
})

if (done.status === 'success') {
  console.log('已绑定:', await zc.listChannels(agentId))
} else {
  console.log('未绑定:', done.status)   // 'expired' | 'denied' | 'error'
}
```

`waitForFeishuSetup` 按服务端建议的间隔轮询，并且把**每一种**终态都当返回值交回来，而不是对「人为结果」抛异常——「对方一直没扫码」是一种结果，不是一个 exception。它只在两种情况下抛错：你设的超时到了（`408` / `type: 'timeout'`），或你自己 abort 了（`0` / `'aborted'`）。

如果你自己驱动轮询，用 `pollFeishuSetup(agentId, sessionId)`，并把不认识的 `status` 一律当作仍在进行中：

| `status` | 含义 |
|---|---|
| `pending` | 等对方操作。按 `poll_interval` 秒继续轮询。 |
| `success` | 已绑定。`channel_configured: true`。 |
| `expired` | session 活过了 `expires_in`。重新开一个。 |
| `denied` | 对方拒绝了。 |
| `error` | 其他错误；细节在 `message` 里。 |

pending 的一次轮询返回的是 `{ status: 'pending', channel_configured: false, message: null, poll_interval: 5 }`。新建 session 的实测默认值：`expires_in: 600`、`poll_interval: 5`。

::: warning session 会「不存在」，那时轮询返回 404
`cancelFeishuSetup(agentId, sessionId)` 放弃一个 session——之后再轮询它，返回的是 `404 channel.feishu_session_not_found`，而**不是**某个终态 `status`。所以你自己写的轮询循环必须把这个 404 当成一种结束，而不是当成可重试的传输错误。`waitForFeishuSetup` 会把它抛成一个带这个 `type` 的 `ZooclawError`。

至于一个 session 单纯活过了 `expires_in` 之后，是返回 200 带 `status: 'expired'`，还是同样变成这个 404——**我们没有观察到**。两种都要处理。
:::

`brand` 决定真实的域名：`'feishu'`（默认）给的是 `open.feishu.cn` 的 URI，`'lark'` 给的是 `open.larksuite.com`。它必须和对方将要批准它的那个工作区对上。

## 显式配置 —— Slack 和企业微信走这条

`addChannel` 是非交互路径，也是 Slack 和企业微信唯一的路径。你已经持有平台应用的凭证，放进 `config` 传入。

```ts
await zc.addChannel(agentId, { platform: 'slack',  config: { /* Slack 应用凭证   */ } })
await zc.addChannel(agentId, { platform: 'wecom',  config: { /* 企业微信应用凭证 */ } })
await zc.addChannel(agentId, { platform: 'feishu', config: { /* 飞书应用凭证     */ } })
```

`config` 的字段是平台相关的——它装的是你要绑定的平台应用的凭证，原样透传给渠道服务。`account` 给这次绑定命名（默认 `'default'`），所以一个 agent 可以在同一平台上持有多个账号。

同一个 `platform` + `account` 绑第二次**不会**报错，也不会产生第二个渠道：第二次调用返回 `201` 并覆盖第一次。把 `addChannel` 当成 upsert，不是 create。

`allow_from` **只在创建时**接受，之后不能再编辑。

::: danger 201 的含义是「存下了」，不是「能用」
绑定时**不校验凭证**。我们用一组故意编造的凭证去绑，拿回来的是 `201`，带着 `health: 'unknown'`、`status: 'configured'`——和一个正常绑定返回的形状一模一样。几秒之后，同一个渠道在列表里的状态变成了 `health: 'unhealthy'`、`status: 'error'`。

所以 201 只告诉你绑定被存下来了，不代表它能工作。真正的判定要从后续 `listChannels` 的 `health` / `status` 里读，不要只凭创建调用的成功就向用户报告绑定成功。
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

`updateChannel` 直接把渠道的**新**状态交回来，你不需要再读一次。注意 `enabled: false` 不只是翻一个标志位：实测它会把 `status` 变成 `'disabled'`，并把 `health` 重置为 `'unknown'`。

### 三种 404，各自说明什么

渠道这一族在三种不同情况下都返回 `404`，靠 `code` 区分。请匹配 `code`，不要只看状态码：

| `code` | 发生了什么 | 该怎么办 |
|---|---|---|
| `channel.feishu_session_not_found` | QR session 没了——被取消了，也可能是过期了。 | 重新开一个 setup session。 |
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

还有一条生命周期备注：删除 agent 会 best-effort 停用它的渠道。这个清理永远不会把一次成功的删除变成报错，所以坏运气的时候，一个聊天绑定可能比它的 agent 活得久——如果某个绑定必须消失，先 `removeChannel` 再 `deleteAgent`。
