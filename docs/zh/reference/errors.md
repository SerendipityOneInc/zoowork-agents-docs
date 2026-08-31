---
title: 错误处理
description: 处理 ZooworkError、选择安全的重试方式，并正确使用幂等键。
source: /en/reference/errors
source_hash: 1701831120fdbdc3a11c3767008e8a3fe845d7d61ed400fbce951aea6cf6e0fb
---

# 错误与重试

只要 API 返回非 2xx 状态，每个 SDK 方法都会抛出 `ZooworkError`。这一页讲清楚三件事：catch 什么、按什么分支、什么东西可以安全地发两次。

## `ZooworkError`

```ts
class ZooworkError extends Error {
  name: 'ZooworkError'
  status: number
  message: string
  type?: string
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `number` | HTTP 状态码。一定有值。 |
| `message` | `string` | 从响应体里取出的人类可读文本；响应体里没有时是 `HTTP <status>`。**只给人和日志看。** |
| `type` | `string \| undefined` | 错误信封里的机器可读代码。**这才是你该拿来做分支的字段** ——在它存在的时候。 |

```ts
import { ZooworkError } from '@zoowork-ai/sdk'

try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooworkError) {
    console.error(e.status, e.type, e.message)
  }
}
```

`ZooworkError` 是一个真正的 class，所以 `instanceof` 能用。读 `.status` 或 `.type` 之前先用它收窄类型——网络故障、DNS 错误、被 abort 的请求，冒出来的是运行时自己的 `TypeError` 或 `AbortError`，不是 `ZooworkError`。唯一的例外是 `waitUntilRunning()`：它在本地自己合成 `ZooworkError`——预算耗尽是 `408` / `'timeout'`，被 abort 是 `0` / `'aborted'`。这两个服务端一个都不发，而且底下那次 abort 的 `DOMException` 不会漏出来。

## 匹配 `error.type`，永远不要解析报错文本

报错文本不属于契约。它是写给看日志的人的，API 和网关给的文本不一样，而且随时可能改。

```ts
// Wrong. Breaks the first time someone rewords the string.
if (e.message.includes('not running')) await zc.startAgent(agentId)

// Right.
if (e instanceof ZooworkError && e.type === 'agent_not_running') await zc.startAgent(agentId)
```

唯一要补的一句，也正是下一节的内容：`type` 不是永远都有。

## 两套错误信封

你的请求会先经过一个网关，它认证你的 key 并把你限定在你的组织范围内，然后才到达 API。**两者都可能产生错误，而且各用各的信封。**

**API 的错误被原样透传。** 最常见的那种 API 信封是：

```json
{ "error": { "type": "agent_not_running", "message": "agent is not running" } }
```

**网关对认证和租户相关的失败发自己的信封** ——这些检查在它转发你的请求之前就跑完了。被拒绝的 key 返回 `401`，type 是 `service_token.invalid`，那是一个网关的代码，不是 API 的。

API 这一侧本身就分两族，不是一族。session、定时任务、environment 返回 `{ error: { type, message } }`，代码不带点（`agent_not_running`、`session_archived`）；agent 这一族返回 `{ code, detail }`，代码带点（`service_api.not_found`）。两种最后都落到 `ZooworkError` 上，而且代码原样保留——SDK 不会替它们发明一套统一词表——所以在用 `===` 比较 type 之前，先看下面 `not_found` 那一行。

::: warning `type` 可能是 `undefined`
两种情况会让你完全拿不到 type：

1. 任何非 JSON 的错误响应体——中间层返回的 HTML 错误页、空响应体、代理超时。SDK 会保留一条干净的 `HTTP <status>` 文本，没有 type。
2. **所有 SSE 流的失败。** `streamEvents()` 只根据状态行构造错误，所以哪怕响应体里带了 type，那里的 `type` 也永远是 `undefined`。

所以除了 `type`，也要按 `status` 分支，并且永远留一条只看 `status` 的兜底分支。
:::

```ts
if (e instanceof ZooworkError) {
  if (e.type === 'agent_not_running') { /* specific */ }
  else if (e.status === 401)          { /* auth, whichever envelope produced it */ }
  else if (e.status === 404)          { /* missing or not yours */ }
  else                                { throw e }
}
```

还有一个怪点值得知道：`ZooworkError` 有可能带着 **2xx** 状态。如果一个成功的响应回来时响应体不是合法 JSON，SDK 会抛 `ZooworkError(res.status, 'non-JSON response: <path>')`。不要在 catch 块里假设 `status >= 400`。

## 你真正会遇到的 type

除非某一行另有说明，下面这些都是在公开网关上、对着一套真实部署观察到的。

| `type` | HTTP | 原因 | 怎么办 |
|---|---:|---|---|
| `agent_not_running` | 409 | 对一个 `status.desired_state` 不是 `running` 的 agent 调 `createSession()` 或 `postEvents()`。新创建的 agent 是停止的，你自己停掉的也一样。 | 调 `startAgent()`，轮询 `status.desired_state` 直到它是 `running`，再重试。永远不要轮询 `actual_state`。 |
| `not_found` / `service_api.not_found` | 404 | 未知的 agent 或 session id、已软删除的，**或者属于其他组织的** 。两种拼写都存在：agent 这一族返回 `service_api.not_found`，session、定时任务、environment 这一族返回不带点的 `not_found`。 | 两种拼写都匹配，或者干脆按 `status === 404` 分支。不要把它读成「已删除」。见[鉴权](../get-started/authentication.md)——跨租户读取被隐藏成 404，而不是被拒绝成 403。你创建的 id 自己记一份。 |
| `service_token.invalid` | 401 | key 缺失、格式不对、已吊销，或者它绑定的用户离开了组织。由网关发出，用网关的信封。 | 修凭证。不要重试——重试会一模一样地失败。用 `listModels()` 验证。 |
| `idempotency_conflict` | 409 | 同一个 `Idempotency-Key` 在 `createAgent()` 上被重放，但带的是**不同的** body。同 key 同 body 是重放，返回第一次的结果。 | 换一个新 key，或者把原来的 body 发过去。key 要从你自己系统里稳定的东西派生。 |
| `invalid_request` | 400 | 格式错误或被拒绝的请求体：读取时缺选择器、skill 版本固定到一个还没 ready 的版本。 | 改请求。原样重试会一模一样地失败。 |
| *（没抓到 type）* | 404 | `putAgentSkill()` 传一个全局目录里的 skill id。这里只有你自己租户上传的 skill 装得上，而全局目录在每个新 agent 创建时就已经挂上了，所以没有什么需要装的。 | 按 `status === 404` 分支。这个检查跑在网关里，而且我们没有在它上面抓到 type，所以按 `e.type` 匹配的 handler 永远不会触发。见 [Skills](../build/skills.md)。 |

::: warning 尚未验证
`idempotency_conflict` 是 API 文档里写的。`createAgent()` 接受这个请求头，`createSession()` 上的重放也确实生效；但我们从没在 `createAgent()` 上重放过同一个 key 去看它去重，两边也都没有刻意去制造冲突。请处理它；不要假设报错文本的具体措辞。
:::

### 更多 400

`updateAgent()` 在 body 里出现 `skills`、`credentials` 或任何未知字段时返回 **400** 。skill 走 `putAgentSkill()`；凭据则根本没有 API——见[不支持的能力](./not-supported.md)。

有两种创建期的拒绝带的是自己更窄的 type，而不是 `invalid_request`：`persona.docs` 条目取名 `MEMORY.md` 或落在保留的 `memory/` 命名空间下时是 `invalid_persona_doc_name`，body 里带 `sandbox.template` 字段时是 `sandbox_template_deprecated`。操作上它们和任何别的 400 一样：改 body，不要重试。

::: warning 尚未验证
这两个 type 字符串来自 API 自己的参考文档；我们两个都没有触发过。可以放心依赖的是状态码。
:::

四种被接受的事件类型之外的事件，`postEvents()` 一律以 **400** 拒绝——见[事件与流式](../build/events.md)。我们没有在它上面抓到 `error.type`，所以 `postEvents()` 的失败请按 `status === 400` 分支，并且把它当作编程错误而不是瞬时故障：你的事件结构写错了，重试改变不了这件事。

### API 文档里写的其他 type

::: warning 尚未验证
这些出现在 API 自己的错误参考里，但我们没有在公开网关上观察到。列在这里是为了让你遇到时能认出来，不是给你拿来写分支的分类表。

| `type` | HTTP | 含义 |
|---|---:|---|
| `forbidden` | 403 | 一个能被识别的凭证用在了错误的接口面上，或者认证之后被策略拒绝。 |
| `conflict` | 409 | 通用的状态冲突；重新读一次资源。 |
| `platform_credentials_required` | 409 | 在平台凭证存在之前就尝试启动 agent。网关会替你代种这些凭证。 |
| `payload_too_large` | 413 | 请求体或 skill 负载超限。 |
| `quota_exceeded` | 429 | 频率或数量超限。 |
| `internal_error` | 500 | 服务端故障。读操作退避后重试；写操作先对账。 |
| `not_configured` | 501 | 这个环境里没有接上后端服务。不要原样重试。 |
:::

## 什么可以安全重试

重试安全性是按操作论的，不是按错误论的。SDK 不会替你重试任何东西。

| 操作 | 能否安全重试 | 原因 |
|---|---|---|
| `listModels`、`getAgent`、`getSession`、`listEvents`、`listAgentSkills`，以及其余的 `list*` / `get*` 读操作 | **能** | 都是读。网络错误和 5xx 用指数退避重试。 |
| `startAgent`、`stopAgent` | **能** | 每次调用都对同一个 id 重跑一遍它的收敛动作。检查 `warnings`，另外记住 `channel_routes_reload_failed` 在纯 API 的 agent 上是预期内的噪声，不是失败。 |
| `deleteAgent` | **能** | 软删除。重复调用都会成功。 |
| `streamEvents` | **能** | 用最后一个事件的续传令牌重连——`{ cursor: ev.cursor }`。续传发生在服务端，两个窗口之间什么都不会丢。**不要**用 `{ after: lastSeq }` 重连：那会切到废弃的 engine-only 通道，它会丢掉你自己发的 input 事件（`user.message`、`user.interrupt`、`user.tool_confirmation`、`system.message`）。 |
| `createAgent`、`createSession`、`createSchedule`、`createEnvironment`、`createEnvironmentVersion`、`uploadSkill`、`uploadSkillVersion` | **只在带 `Idempotency-Key` 时能** | 不带的话，超时之后的一次重试会创建出第二个 agent，或者第二个 session，并把开场那一回合再跑一遍。 |
| `updateAgent`、`putAgentSkill`、`deleteAgentSkill` | **不能** | 每次成功都会 bump `config_version`。超时之后先 `getAgent()` 对账，再决定怎么办。 |
| `updateSchedule`、`deleteSchedule` | **不能** | 这两条都不提供跨超时的幂等保证。超时之后请列出这个 agent 的定时任务、读它们的运行记录来对账，不要把这次写入再发一遍。 |
| `postEvents` | **不能** | 这条路由上没有幂等 key。盲目重试可能把同一条 `user.message` 投递两次，污染对话。请在你这边做去重。 |

### create 调用上的 `Idempotency-Key`

有七个方法接受幂等 key，都以 `Idempotency-Key` 请求头发出：`createAgent`、`createSession`、`createSchedule`、`createEnvironment`、`createEnvironmentVersion`、`uploadSkill`、`uploadSkillVersion`。前五个把它作为最后一个参数传，两个上传方法把它放在 options 对象的 `idempotencyKey` 字段里。你最先会用到的是这两个：

```ts
const created = await zc.createAgent(
  { resource: { name: 'research-agent' } },
  'provision-research-agent-1',
)

const session = await zc.createSession(
  agentId,
  { initial_events: [{ type: 'user.message', content: userInput }] },
  `chat-${incomingMessageId}`,
)
```

agent 创建的唯一性域是 `(agent.create, key)`。同一个 key、同一份 body 重放，返回第一次的结果。同一个 key 换一份 body 重放，是 `409 idempotency_conflict`。

**key 要从你自己系统里稳定的东西派生** ——入站消息的 id、你正在为之开通资源的那条任务记录的 row id——不要用调用时现生成的值。每次尝试都换一个随机 key，这个 header 就白加了，因为需要收敛到第一次调用上的，正是这次重试。

### `config_version` 不是幂等回执

很容易想用这个版本号判断一次写有没有落地。它在两个方向上都不成立。

- **每一次成功的 PUT 都会 bump 它，哪怕内容一字节不差。** 没有空操作检测，所以「版本号变了」不代表你的值改变了任何东西。
- **不是你发起的写也会 bump 它。** `createAgent()` 之后网关立刻替 agent 代种模型凭证，每一次都 bump 一次版本：创建回执上写着 `1`，紧接着第一次 `getAgent()` 常常已经是 `3` 了。

```ts
const before = (await zc.getAgent(agentId)).status?.config_version   // 4
await zc.updateAgent(agentId, { labels: { probe: 'x' } })
const first  = (await zc.getAgent(agentId)).status?.config_version   // 5
await zc.updateAgent(agentId, { labels: { probe: 'x' } })            // identical body
const second = (await zc.getAgent(agentId)).status?.config_version   // 6 - bumped anyway
```

把它当成一个不透明的单调递增计数器。要判断一次超时的 `updateAgent()` 到底有没有落地，就把值从 `declared` 里读回来自己比对。

也没有乐观并发控制：`updateAgent()` 不接受任何版本前置条件，两个并发写入方永远看不到冲突。它们会静默地按小节后写覆盖先写。

## 一个完整示例

这段开通流程扛得住你真正会遇到的两种失败：agent 是停止的，以及一次不知道有没有落地的创建。

```ts
import { createZooworkClient, ZooworkError } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

async function openSession(agentId: string, text: string, jobId: string) {
  try {
    return await zc.createSession(
      agentId,
      { initial_events: [{ type: 'user.message', content: text }] },
      `job-${jobId}`, // stable key: a retry converges on the first session
    )
  } catch (e) {
    if (!(e instanceof ZooworkError)) throw e // network or abort, not an API answer

    if (e.type === 'agent_not_running') {
      await zc.startAgent(agentId)      // warnings here are informational
      // Polls desired_state, the only field that gates session calls. Throws 408/'timeout'.
      await zc.waitUntilRunning(agentId)
      return zc.createSession(
        agentId,
        { initial_events: [{ type: 'user.message', content: text }] },
        `job-${jobId}`,
      )
    }

    if (e.status === 404) {
      // Missing, soft-deleted, or another organization's. Not necessarily "deleted".
      throw new Error(`agent ${agentId} is not visible to this key`)
    }

    if (e.status === 401) {
      // Gateway envelope; e.type is service_token.invalid. Retrying will not help.
      throw new Error('API key rejected - check ZOOWORK_API_KEY')
    }

    throw e
  }
}
```

这段代码有三件事是刻意的：

- 它在碰 `.type` 之前先用 `instanceof ZooworkError` 收窄类型，这样传输层的失败会往外抛，而不会被误当成 API 的回答。
- 有 type 的地方按 `type` 分支，可能没有 type 的地方回落到 `status`。
- 重试时复用同一个 `Idempotency-Key`。这就是这个 key 的全部意义。

## 下一步

- [TypeScript SDK 参考](./typescript-sdk.md) —— 每个方法、类型和辅助函数。
- [鉴权](../get-started/authentication.md) —— 为什么跨租户的 id 是 404。
- [Agents](../build/agents.md) —— 启动、停止，以及这一页背后的 `config_version` 语义。
