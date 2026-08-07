---
title: 从 Claude Managed Agents 迁移
source: /en/reference/from-claude-managed-agents
source_hash: 3c2831ce1dc744ff327705f8ebf4b6c1681be61a444e8acd8d0bca75dacfcdb1
---

# 从 Claude Managed Agents 迁移

本页写给已经熟悉 Claude Managed Agents 的开发者：那套心智模型迁到 ZooClaw 之后，哪些部分仍然成立，哪些会不声不响地把你带偏。

全文中 Claude 一侧写的是**调用的形态** ，不是字面上的 SDK 签名——准确的方法名请查 Anthropic 自己的文档。ZooClaw 一侧是真实的、能编译的 `@zooclaw-agents/sdk` 代码。

## 先说结论

核心循环可以直接迁。**agent** 仍然是一个持久化的、服务端的配置对象；**session** 仍然是针对它的一段对话；agent 干的活仍然以一条有序的**事件** 流回来；你仍然通过写一条用户消息、然后读事件直到这一回合结束，来推进一个回合。如果你在 Claude 上写过流式的回合循环，ZooClaw 这边你会立刻认出来。

有三件事迁不过来，而且每一件都是直接让代码报错，不是让它退化着跑。**工具回调不存在** ——没有客户端执行的自定义工具，模型没有任何办法调用你进程里的函数再把结果拿回来，也没有 `user.custom_tool_result` 事件。**Session 不是顶层资源** ——每一条 session 路由、每一个 SDK 方法都嵌在某个 agent 下面，所以 `createSession(agentId, input)` 把 agent id 放在第一个参数上，而不是放在 body 里。**Environment 不是一个步骤** ——开 session 之前没有任何东西要先创建，也没有 environment id 要一路传下去。作为交换，你多了一步 Claude 没有的：新建出来的 agent 是停止状态，你必须先调 `startAgent()`，任何 session 调用才会生效。

## 概念对照

| Claude 概念 | ZooClaw 对应 | 会咬人的差异 |
|---|---|---|
| **Agent** | `createAgent()` / `getAgent()` / `updateAgent()` | 新建的 agent 是**停止** 状态，你必须 `startAgent()` 它。`createAgent()` 和 `getAgent()` 返回的是**两种不同的结构** ——版本号在创建回执里是顶层字段，在读取结果里则在 `status.config_version`。`updateAgent()` 按 section 合并（`tool_policy` 是例外，整体替换），每一次 PUT 都会 bump 版本号，哪怕内容一个字节都没变，而且没有乐观并发的前置条件。没有版本历史，不能钉版本，不能回滚。见 [Agents](/zh/build/agents)。 |
| **Environment** | session 这条路径上没有对应物 | 没有 environment 要创建，`createSession` 里没有 environment id，SDK 也没有创建它的方法。沙箱行为就是 agent 上的一个字段：`sandbox.scope: 'agent' \| 'session'`。`AgentResource` 的类型定义里有 `environment_id` / `environment_version`，但不要通过公开网关使用它们。见 [Environments](/zh/build/environments)。 |
| **Session** | `createSession(agentId, input)` | 嵌在 agent 下面：`POST /agents/{agent_id}/sessions`。`initial_events` **只** 接受 `user.message`（最多 50 条，content 为字符串）——没有 outcome 定义。没有 `agent_with_overrides`，没有 `resources[]`，没有 `vault_ids`。有一个 Claude 没有的 `Idempotency-Key`（第三个参数）。前置条件：`status.desired_state === 'running'`，否则返回 `409 agent_not_running`。见 [Sessions](/zh/build/sessions)。 |
| **Event** | `SessionEvent` = `{ seq, eventType, payload, runId?, turn?, createdAt? }` | 另一套词汇：`run.*` / `chat.*` / `agent.*` 下共 19 种类型，外加 `attachment.created` 和 `message.outbound`。**两种线格式都没有顶层的 `type`** ——REST 返回 snake_case（`event_type`、`run_id`、`created_at`），SSE 返回 camelCase（`eventType`、`runId`、`createdAt`）。SDK 的 `normalizeEvent` 把两种都吃下去；直接调 HTTP API 的人得自己处理两种。见[事件与流式](/zh/build/events)。 |
| **`stop_reason` / `requires_action`** | 带 `payload.status` 的 `run.finished` | 这两个字段都不存在。没有 `session.status_*` 事件，也没有可轮询的 idle 状态。一个回合在 `run.finished` 结束，它的 status 是 `succeeded \| failed \| aborted`。永远不会有东西回过头来要你提供工具结果，因为客户端执行的工具不存在——所以整套 `status_idle` + `requires_action` + 重新提交的循环在这里没有对应物。 |
| **`event_delta`** | SSE 路由上的 `?deltas=agent.message` | **是快照替换，不是前缀追加。** 每一帧带的都是当前的完整文本，所以 Claude 那种拼接方式会把内容全部重复一遍。SDK 的 `streamEvents()` 完全跳过 `event_delta` 帧；改成在持久的 `agent.assistant` 事件上拼接 `assistantText(ev)`。 |
| **自定义工具（客户端执行）** | 无 | 没有 `{ type: "custom" }` 工具，没有 `user.custom_tool_result`。这是最大的一个缺口。见[下文](#需要重新设计的部分)。 |
| **Outcomes（`define_outcome`、rubric、grader）** | 无 | 没有 rubric，没有 grader，没有「迭代到满意为止」的循环。`initial_events` 会拒绝一切不是 `user.message` 的东西。 |
| **Vaults** | 无 | 没有按用户托管凭证，没有出站时替换，没有 OAuth 刷新。`putCredential` / `listCredentials` 在客户端接口上存在，但通过公开网关一律返回 `404`，这是设计如此——网关自己注入平台凭证。没有任何受支持的位置可以存放你终端用户的第三方 token。 |
| **Memory stores** | API 上没有 | 没有 `memory_stores` 资源，没有 CRUD，没有挂载路径，没有版本管理和脱敏。agent 有自己的内部记忆；但它在 API 上不可寻址、不可列出、不可共享，而且某个部署可以把它整个关掉。`MEMORY.md` 和 `memory/` 命名空间是保留的 persona doc 名字，会返回 `400 invalid_persona_doc_name`。 |
| **Files API + session 的 `resources[]`** | 两个都不在 SDK 里 | 没有「先上传再挂载」这套模型：`createSession` 上没有 `resources[]`，没有 `mount_path`，也没有可以读回来的输出目录。HTTP 接口上确实有一条文件路由，挂在 agent 的子资源下，但 `ZooclawClient` 没有暴露任何文件方法，所以对 SDK 使用者来说它等于不存在。 |
| **Deployments（定时运行）** | agent 范围内的定时任务，且不在 SDK 里 | 定时能力挂在 agent 下面，不是一个独立资源，而且 `ZooclawClient` 没有对应方法。没有跨 deployment 的运行历史，也没有带签名的 webhook 投递，所以「run 结束时通知我的服务器」只能靠你自己轮询，或者挂一条常开的 SSE 流。 |
| **Skills** | `listAgentSkills()` / `putAgentSkill()` / `deleteAgentSkill()` | skill 挂在 **agent** 这一级。新建出来的 agent 已经挂好了整个全局目录——在你想装任何东西之前，先调一次 `listAgentSkills()`。`putAgentSkill()` 对全局 scope 的 skill 返回 `404`；它只对你自己租户上传的 skill 有意义。见 [Skills](/zh/build/skills)。 |

## 代码形态差异

下面每一段代码都假定有这个客户端：

```ts
import {
  createZooclawClient,
  assistantText,
  isRunFinished,
  runOutcome,
} from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY }) // zct_...
```

### 1. Session 嵌在 agent 下面

在 Claude Managed Agents 里，session 是顶层资源，agent 写在请求 body 里，所以之后单凭 session id 就足以定位一个 session。

```
Claude:   POST /v1/sessions            { agent_id, ... }
          then every follow-up call is addressed by session id alone

ZooClaw:  POST /v1/agents/{agent_id}/sessions   { initial_events?, metadata? }
          every follow-up call needs the agent id too
```

SDK 刻意把这层嵌套暴露出来，而不是藏起来，所以 `agentId` 是每一个 session 方法的第一个参数：

```ts
createSession(agentId, input, idempotencyKey?)
getSession(agentId, sessionId, opts?)
postEvents(agentId, sessionId, events)
listEvents(agentId, sessionId, opts?)
streamEvents(agentId, sessionId, opts?)
```

```ts
const session = await zc.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
  metadata: { source: 'my-app' },
})

await zc.postEvents(agentId, session.session_id, [
  { type: 'user.message', content: 'And again.' },
])
```

实际后果：**你持久化的每一个 session id 旁边，都要存上对应的 agent id。** 从 Claude 迁过来、只保留 session id 的代码编译不过；从 Claude 迁过来、只存 session id 的表结构，也不足以让这段对话继续下去。

### 2. 多了一步显式的 `startAgent`

Claude 没有对应的东西。ZooClaw 的 agent 创建出来时 `status.desired_state === 'stopped'`，而对一个停止状态的 agent 发起的每一个 session 调用都会失败。

```ts
// Ported straight from Claude: create, then use.
const created = await zc.createAgent({
  resource: { name: 'my-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})

await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'hi' }],
})
// ZooclawError: HTTP 409  (type: agent_not_running)
```

```ts
// Correct: create -> start -> wait on desired_state -> session.
const created = await zc.createAgent({
  resource: { name: 'my-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})

const { warnings } = await zc.startAgent(created.agent_id)
// warnings: ["channel_routes_reload_failed: routes reload returned 404"] - expected noise
await waitUntilRunning(created.agent_id)

const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'hi' }],
})
```

```ts
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitUntilRunning(agentId: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const agent = await zc.getAgent(agentId)
    if (agent.status?.desired_state === 'running') return
    await sleep(500)
  }
  throw new Error(`agent ${agentId} did not reach desired_state=running`)
}
```

::: danger 轮询 `desired_state`，永远不要轮询 `actual_state`
`actual_state` 报的是聊天渠道的连通性，不是 API 的就绪状态。纯 API 的 agent 一个渠道都没有，所以它会永远停在 `activating`，`active` 根本到不了——而且 `running` 压根不在 `actual_state` 这个枚举里
（`activating | active | degraded | error | stopped | deleting`），所以轮询它永远不会返回。`desired_state` 会在远不到一秒内翻成 `running`。`actual_state` 还是 `activating` 的时候，session 已经完全能用了。
:::

`startAgent()` 和 `stopAgent()` 都返回 `{ warnings: string[] }`，纯 API 的 agent 每次调用都会报 `channel_routes_reload_failed`，因为它没有任何聊天渠道路由可以 reload。`warnings` 数组非空不代表失败——不要因此重试。

### 3. 没有创建 environment 这一步

Claude 的快速开始在 agent 和 session 之间插了一个 environment：你先创建一个，它定义沙箱镜像和网络策略，它的 id 再一路传进 session。

```
Claude:   create agent -> create environment -> create session -> stream
ZooClaw:  create agent -> START agent        -> create session -> stream
```

迁移时没有什么要删的——这一步在 ZooClaw 这边根本没有对应的调用，`createSession` 也不接受 environment 参数：

```ts
// The whole provisioning path. No environment anywhere.
const created = await zc.createAgent({
  resource: {
    name: 'porting-demo',
    model: { primary: 'litellm/claude-sonnet-5' },
    sandbox: { scope: 'session' },   // the only sandbox knob on this path
    onboarding: false,
  },
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})
await zc.startAgent(created.agent_id)
await waitUntilRunning(created.agent_id)
const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
```

`sandbox.scope` 决定这个 agent 的多个 session 是共用一个沙箱（`'agent'`，默认值），还是各自一个（`'session'`）。在 session 这条路径上，environment 概念的对应物就只有这么多。如果你原本靠 environment 来预装依赖包或者限制出站主机，在假定这个能力存在之前，先读 [Environments](/zh/build/environments)。

### 4. 回合的结束是 `run.finished`，不是 idle 加 `stop_reason`

Claude 的编程模型是：一直读事件，直到 session 报告自己进入 idle，然后按这一回合的 `stop_reason` 分支——`requires_action` 表示要提供工具结果并重新提交，其他值表示这一回合结束了。

这些在这里一个都没有。没有 session 状态事件，没有 `stop_reason`，也不会有任何东西向你索要工具结果。结束一个回合的只有一个事件：

```ts
let text = ''
let outcome: 'succeeded' | 'failed' | 'aborted' | undefined

for await (const ev of zc.streamEvents(agentId, sessionId)) {
  text += assistantText(ev)          // '' for every event that is not agent.assistant

  if (isRunFinished(ev)) {           // ev.eventType === 'run.finished'
    outcome = runOutcome(ev)         // 'succeeded' | 'failed' | 'aborted'
    break                            // <- you must break; the stream stays open
  }
}
```

这个循环里有两个坑，两个都实打实地让人浪费过时间：

- **`run.finished` 结束的是回合，不是流。** SSE 流的作用域是 session，一次 run 完成时它不会关闭；服务端会在空闲一段时间之后关掉它。等连接结束的循环会一直阻塞到那个超时。你要自己 break 出来。
- **`succeeded` 不代表没有工具报错。** 一个 `payload.isError === true` 的 `agent.tool` 事件之后，照样会跟一个 `succeeded` 的 `run.finished`。不要从「没有工具报错」推断回合成功，也不要从 run 的结果推断工具成功。

`agent.tool` 还多一个 Claude 的工具事件没有的阶段：`blocked`，表示这次调用正在等审批，还没有执行。把它当成进行中，不要当成结束——等它有结果之后，仍然会跟上一个配对的 `end`。

### 5. delta 是快照替换，不是前缀追加

Claude 的 `event_delta` 帧带的是新增的那一段文本，所以惯用的处理方式是追加。ZooClaw 的 delta 帧带的是**这一项当前的完整文本** 。同一套处理方式在这里会拼出 "HeHelHellHello"。

用一个假想的、遍历 delta 帧的迭代器来写，差别就在赋值运算符：

```ts
// PORTED FROM CLAUDE - WRONG HERE. Produces duplicated, growing text.
let text = ''
for await (const frame of deltaFrames) {
  text += textOf(frame)         // append: correct for Claude, wrong for ZooClaw
}
```

```ts
// Correct for a snapshot lane: replace, never concatenate.
let preview = ''
for await (const frame of deltaFrames) {
  preview = textOf(frame)       // each frame IS the whole text so far
}
```

::: warning 尚未验证
delta 预览这条通道在原始 HTTP 路由上是选择性开启的
（`GET /agents/{id}/sessions/{id}/events/stream?deltas=agent.message`），它发出的 SSE 帧的
`event:` 字段是 `event_delta`，文档写的是快照替换。它要求部署上配好 Redis，没配时返回 `501 not_configured`。我们没有在真实部署上跑过它，所以不要做依赖它的 UI。
:::

已实测的路径是持久事件那条，SDK 也把你往那边引：`streamEvents()` 完全跳过 `event_delta` 帧，只吐持久事件，所以在整个回合上拼接 `assistantText(ev)` 是安全的，能拿到完整的回复。

```ts
let text = ''
for await (const ev of zc.streamEvents(agentId, sessionId)) {
  text += assistantText(ev)
  if (isRunFinished(ev)) break
}
```

我们的线上冒烟测试每跑一次，都会把这段拼接结果和同一个 session 的 REST 回放逐字节比对，所以两条路径是一致的。

### 6. 重连在这边更好：服务端续传

这是迁移中唯一变简单的地方。Claude 没有续传：流断了，你就重新拉一遍 session 的历史，再按 event id 和你已经处理过的做去重。

```ts
// The Claude shape: re-list everything, then throw away what you have seen.
const seen = new Set<string>()
// ... on every reconnect: list the session's events, skip ids already in `seen`,
//     and hope the page you got covers the gap.
```

ZooClaw 的每一个 SSE 帧都在自己的 `id:` 行里带一个 session 内持久的 `seq`，流路由接受 `?after=<seq>`，从那个点开始**在服务端** 回放。记住一个数字，再传回去就行：

```ts
let lastSeq = 0

for (;;) {
  try {
    for await (const ev of zc.streamEvents(agentId, sessionId, { after: lastSeq })) {
      lastSeq = ev.seq            // the only state you have to keep
      text += assistantText(ev)
      if (isRunFinished(ev)) return runOutcome(ev)
    }
    // The generator returned: the server closed an idle stream. Reconnect from lastSeq.
  } catch (e) {
    // Transport failure. Same recovery - nothing was lost.
  }
}
```

不需要去重集合，不需要重读历史，不需要推断有没有缺口。同一个 `seq` 游标也用于 `listEvents(agentId, sessionId, { after })` 的翻页，所以 REST 读取方和流式读取方共用一个书签。

::: warning 尚未验证
`streamEvents()` **不会** 替你重连——上面那个循环要你自己写。我们已经通过公开网关端到端跑通了短流；长流在网关空闲超时下的表现我们没有测过。哪怕你第一次测试根本用不上，也把重连循环写出来。
:::

## 需要重新设计的部分

下面这些在 ZooClaw 没有对应物，我们也没见过任何一种真的能跑通的绕法。如果你的产品设想依赖其中某一条，改设想，而不是去找绕过它的办法。完整细节和背后的原因在[不支持的能力](/zh/reference/not-supported)。

- **客户端执行的自定义工具。** 「agent 调用我的函数，我的进程查我的数据库，我再把结果交回去」这套东西表达不出来。没有自定义工具类型，也没有结果事件。唯一沾边的能力是在 agent 上声明一个远程 HTTP MCP server；这条我们没有端到端跑通过，所以也不要围绕它做规划。
- **Outcomes 和 grader。** 没有 `define_outcome`，没有 rubric，没有「迭代到满意为止」的循环。任何形态像自动评测框架的东西，都得跑在你自己的代码里，对拿回来的文本做判断。
- **Vaults / 终端用户凭证托管。** 没有地方存放你用户的第三方 token，凭证相关的路由通过公开网关都是 `404`。按终端用户逐个走的「连接你的 Notion」这种流程，在这套 API 上做不出来。
- **Session 的 `resources[]`：文件与代码仓挂载。** 不能上传一个 CSV 给 agent 读，也不能挂一个 Git 仓库给它改。没有挂载路径，也没有代码仓资源。
- **Memory stores。** 没有跨 agent 共享的知识库，没有版本管理，agent 记住了什么也没有审计和回滚。
- **端到端的人工审批（human-in-the-loop）。** 审批相关的事件是存在的，但整个来回在 SDK 里用不了。卡在审批上的 agent，这一回合直接超时。
- **带签名的 webhook。** run 结束时不会有任何东西推给你的服务器。要么轮询，要么把 SSE 流一直挂着。
- **列出 session，以及列出 agent。** `ZooclawClient` 没有 `listSessions`、`listAgents`、`archiveSession`、`deleteSession`、`patchSession`。你创建的每一个 `agent_id` 和 `session_id` 都要自己持久化，任何以后要用来检索的东西，都要在创建时就放进 `metadata`——事后加不上去。
- **Agent 的版本历史与钉版本。** `config_version` 会往上累加，但没有任何路由能读取历史版本、钉到某个版本，或者回滚。覆盖一份配置之前，自己留一份副本。

## 我们有、Claude 没有的

- **可续传的事件流。** 每一帧都带一个持久的 `seq`，`?after=<seq>` 在服务端回放，所以断线的代价是一个整数的状态，而不是重读一遍历史外加一个去重集合。
- **带外注入 `system.message`。** `postEvents` 在两个回合之间接受 `{ type: 'system.message', text: '...' }`；下一个回合模型的上下文里就带着这条内容。我们通过埋一个事实、下一回合再问它要，实测过这一点。
