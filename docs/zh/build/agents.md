---
title: Agents
description: 创建、配置、启动、更新和删除 agent，并处理带版本的不同响应结构。
source: /en/build/agents
source_hash: dd77063917e836a34d79ee5ad1800240cf543443d04ce4a0ffd347c7185b0155
---

# Agents

agent 是一个持久化的配置对象：一个名字、一个模型、若干 persona 文档、labels，以及一份工具策略。你创建它一次，启动它，然后在它下面开 [session](./sessions.md)。配置存在服务端，所以每个 session 都继承它，你不需要重复发送任何东西。

从别的 managed-agent API 过来的人，会在 ZooWork 的 agent 上被三件事绊住。写代码之前先读这三条。

1. 新创建的 agent 是**停止状态** 。你必须调 `startAgent()`，否则 `createSession()` 会失败并返回 `409 agent_not_running`。
2. 等 `status.desired_state === 'running'`。**永远不要** 等 `status.actual_state`——它是尽力而为的聊天渠道健康投影，不是 API 就绪状态，而且它没有 `running` 这个值。
3. 同一个 agent 会以**两种不同的结构** 返回。`createAgent()` 返回一份扁平的创建回执；`getAgent()` 和 `updateAgent()` 返回一份读取投影。版本号在这两种结构里的位置不一样。

## 准备

本页每段代码都假设有这个客户端。

```ts
import { createZooworkClient, ZooworkError } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY }) // zct_...
```

## 创建 agent

`createAgent(input, idempotencyKey?)` 接收一个 `resource`（配置本身），返回一个 `AgentRecord`。

```ts
import type { AgentRecord } from '@zoowork-ai/sdk'

const models = await zc.listModels()
const primary = models.find((model) => model.model === 'litellm/gpt-5.6-terra')?.model
if (!primary) throw new Error('请从 listModels() 返回的模型中选择一个')

const created: AgentRecord = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary },
      labels: { app: 'my-app' },
    },
  },
  'provision-research-agent-1', // Idempotency-Key
)

console.log(created.agent_id, created.config_version)
```

`Idempotency-Key` 的作用域是 `agent.create + key`：同一个 key 配同一份 body 会收敛到第一次的响应，同一个 key 配不同的 body 返回 `409`。见[错误处理](../reference/errors.md)。

onboarding 面试总是被跳过——agent 会直接回答你的第一条消息。

### `resource` 的字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 必填，不能为空。 |
| `model.primary` | string | `provider/model-id` 形式的模型别名，例如 `litellm/gpt-5.6-terra`。只写模型名会被归一成 `litellm/<model-id>`。列表从 `listModels()` 拿。 |
| `model.input` | `string[]` | `text` 和/或 `image`。声明 `image` 表示主模型自己读图。 |
| `model.max_tokens` | integer | 单次模型请求的输出 token 上限。不设走平台默认；非法值创建时报 400。 |
| `persona.docs[]` | `{ name, content, seed_policy? }[]` | 指导性文档。只存内联的 `content`。组装提示词时只读这几个规范名：`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`。其他名字会存下来，但永远到不了模型那里。`MEMORY.md` 和 `memory/` 命名空间是保留的，返回 `400 invalid_persona_doc_name`。 |
| `labels` | `Record<string, string>` | 你自己的键值标签。可以用 `listAgents({ labels })` 过滤。 |
| `tool_policy` | object | `{}` 表示完整的工具清单。policy 字段支持精确名称、全局 `*` 和一个末尾 `prefix*`；`alsoAllow` 仍然只支持精确名称。见[工具](./tools.md)。 |
| `sandbox.scope` | `'agent' \| 'session'` | 沙箱是在这个 agent 的所有 session 之间共享，还是每个 session 建一个。默认 `agent`。 |
| `mcp` | array | 远程 MCP Server 声明，包括加载方式、运行时 context 和审批策略。见 [MCP Server](./mcp.md)和[权限策略](./permissions.md)。 |

整个 `model` 段都可以省略。省略时，创建操作会把当时的平台默认值写入 Agent。默认值可能随部署环境和时间变化。需要可重复部署时，请先调用 `listModels()`，再持久化一个明确选择。

```ts
const agent = await zc.createAgent({
  resource: {
    name: 'support-triage',
    model: { primary, input: ['text', 'image'] },
    persona: {
      docs: [
        { name: 'AGENTS.md', content: 'You triage inbound support tickets. Be terse.' },
        { name: 'SOUL.md', content: 'Dry, precise, never apologetic.' },
      ],
    },
    tool_policy: { allow: ['read', 'web_search'] },
    sandbox: { scope: 'session' },
    labels: { tier: 'free' },
  },
})
```

创建时传入 `skills` 会安装 skill，但创建回执和 `getAgent` 的 `declared` 都**不回显**这个字段——确认安装读 `listAgentSkills(agentId)`，不要看回执。见 [Skills](./skills.md)。`environment_id` 和 `environment_version` 的解析规则见 [Environments](./environments.md)。

## 读取 agent，以及两种响应结构

这是 ZooWork 代码里 `undefined` 最常见的单一来源。`POST /agents` 返回一份扁平的创建回执。`GET` 和 `PUT` 返回一份读取投影。它们不是同一个对象。

```ts
// createAgent() - flat receipt
{
  agent_id: 'agt_...',
  computer_id: 'cmp_...',
  config_version: 1,            // <- top level
  resolved_skills: [ /* ... */ ],
  ownership: { owner_uid: '...', org_id: '...' }
  // no `declared`, no `status`
}
```

```ts
// getAgent() / updateAgent() - projection
{
  agent_id: 'agt_...',
  computer_id: 'cmp_...',
  declared: {                   // <- the configuration lives here
    name: 'research-agent',
    model: { primary: 'litellm/gpt-5.6-terra', input: ['text', 'image'] },
    labels: { app: 'my-app' },
    sandbox: { scope: 'agent' }
  },
  labels: { app: 'my-app' },
  resolved_skills: [ /* ... */ ],
  status: {
    desired_state: 'stopped',
    actual_state: 'stopped',
    config_version: 3,          // <- the version lives here
    render_state: 'ready',
    status_message: null,
    channels: { expected: 0, connected: 0, degraded_since: null }
  }
  // no top-level `config_version`, no top-level `name`
}
```

| | 创建回执 | 读取投影 |
|---|---|---|
| 版本号 | `agent.config_version` | `agent.status.config_version` |
| 名字 | 不存在 | `agent.declared.name` |
| 生命周期状态 | 不存在 | `agent.status.desired_state` |

写一个访问器，然后到处都用它：

```ts
const configVersion = (a: AgentRecord): number | undefined =>
  a.status?.config_version ?? a.config_version
```

这个数字在两次读取之间还会跳：你还什么都没写，第一次读回来的版本号就可能已经高于创建回执上的那个。把 `config_version` 当成一个不透明的单调计数器，永远不要把它当成你自己那次写入的回执。完整规则见[错误处理](../reference/errors.md)。

```ts
const agent = await zc.getAgent(created.agent_id)
console.log(agent.declared?.name, agent.status?.desired_state, configVersion(agent))
```

不存在的、已软删除的、或属于其他租户的 agent id 都返回 `404 not_found` —— 跨租户读取被隐藏成 404，而不是被拒绝成 403。

## 启动 agent

`startAgent()` 把 `desired_state` 翻成 `running`。这是每一次 Session 调用的前置条件。

```ts
const { warnings } = await zc.startAgent(agent.agent_id)
console.log(warnings)
// 成功响应可能包含 warnings；结合具体情况检查。
```

### 警告与 HTTP 失败

成功的 start/stop 响应返回 `{ warnings: string[] }`，但不保证每次都有警告。非 2xx 响应会抛出 `ZooworkError`，不能把失败调用当作仅含警告的成功。

stop 请求可能在把 `desired_state` 改为 `stopped` 以后失败。重试前先重新读取 Agent；仅凭这个字段不能证明运行资源已经清理完成。

### `desired_state` 与 `actual_state`

`AgentStatus` 带两个听起来可以互换、实际上不能互换的状态字段。

| 字段 | 含义 | 取值 |
|---|---|---|
| `desired_state` | 生命周期意图。**API 由它把关。** | `running`、`stopped`、`deleted` |
| `actual_state` | 聊天渠道路由的健康度。 | `activating`、`active`、`degraded`、`error`、`stopped`、`deleting` |

`actual_state` 是尽力而为的渠道健康投影。GET 可能返回 `active` 和零渠道计数，也可能在健康信息刷新时显示 `activating`。`listAgents()` 与 GET 的结果可能短时不同。Session 通过 `desired_state` 判断就绪状态；绑定[渠道](./channels.md)后，`actual_state` 可以反映渠道连通性。

轮询 `desired_state`，并带上超时。`waitUntilRunning()` 就是这个循环，已经写好了：

```ts
const agent = await zc.waitUntilRunning(agentId)
console.log(agent.status?.desired_state)  // 'running'
```

它轮询的是 `status.desired_state` —— 永远不是 `actual_state` —— 并把读到的那份投影交还给你。默认是 30 秒预算、每次轮询间隔 500 毫秒；两个值都可以调，也可以用 `AbortSignal` 取消这次等待。

```ts
const ac = new AbortController()
await zc.waitUntilRunning(agentId, { timeoutMs: 60_000, intervalMs: 1_000, signal: ac.signal })
```

等待耗尽预算时抛出的 `ZooworkError` 是 `status: 408`、`type: 'timeout'`；被取消时是 `status: 0`、`type: 'aborted'`。这两个都是本地合成出来的 —— 服务端从来不会发它们，而且取消不会把 `DOMException` 漏给你。

这两个上限管的是**在途** 的那次请求，而不只是两次轮询之间的间隔：每一个请求都带自己的 signal，由你的 `signal` 或预算的剩余部分触发。所以网关接了连接却再也不回话时，这次等待仍然按时结束，而不是被挂住。这正是手写循环漏掉的部分 —— SDK 跑的每一种运行时里，`fetch` 都没有自己的超时，所以一个只在两次请求之间执行的 `Date.now() >= deadline` 判断根本轮不到执行。

完整的开通路径：

```ts
const created = await zc.createAgent({
  resource: { name: 'research-agent', model: { primary } },
})

await zc.startAgent(created.agent_id)      // warnings are informational
await zc.waitUntilRunning(created.agent_id)

const session = await zc.createSession(created.agent_id, {
  initial_events: [{ type: 'user.message', content: 'Hello.' }],
})
```

跳过启动，下一次调用就会告诉你：

```ts
try {
  await zc.createSession(agentId, { initial_events: [{ type: 'user.message', content: 'hi' }] })
} catch (e) {
  if (e instanceof ZooworkError && e.type === 'agent_not_running') {
    await zc.startAgent(agentId)
    await zc.waitUntilRunning(agentId)
  } else {
    throw e
  }
}
```

匹配 `e.type`，永远不要匹配 `e.message`。见[错误处理](../reference/errors.md)。

## 修改 agent

`updateAgent(agentId, sections)` 对你点名的 declared 小节发 PUT。它返回读取投影。

**你没写进 body 的小节会被保留。** 顶层的对象小节只合并一层；小节内部的数组和标量整个替换掉旧值。

```ts
// 修改前 labels 是 { tier: 'free', region: 'apac' }。
// This PUT sends only `labels`.
const updated = await zc.updateAgent(agent.agent_id, {
  labels: { tier: 'paid' },
})

console.log(Object.keys(updated.declared ?? {}))
// [ 'name', 'model', 'imageModel', 'imageGenerationModel', 'pdfModel', 'persona', 'labels', 'sandbox', ... ]

console.log(updated.declared?.name)   // 'research-agent'  - survived
console.log(updated.declared?.model)  // { primary: 'litellm/gpt-5.6-terra', ... } - survived
console.log(updated.declared?.labels) // { tier: 'paid', region: 'apac' } - region 保留
```

`declared` 比你发出去的宽。`imageModel`、`imageGenerationModel` 和 `pdfModel` 是服务端默认值，每次读都会出现在里面；它们不是 `AgentResource` 的成员，发送它们是类型错误。

`name`、`model` 和 `persona` 因为没有传入而保持不变。普通对象小节做一层浅合并，所以未指定的 label 键保留。这不是递归深合并：显式传入的 `persona.docs` 数组会替换旧数组。

### `tool_policy` 和 `system_prompt` 是整体替换

有两个小节是合并规则的例外：每一次点名 `tool_policy` 或 `system_prompt` 的 PUT 都会替换掉整个对象。见[工具](./tools.md)。

所以这两个都没有局部写入。要往策略里加东西，先从 `declared` 里把当前这份读出来，自己算好并集再发。

### 每一次 PUT 都会 bump 版本号

`config_version` 在每一次成功的 PUT 上都自增，包括那种取值与已存储内容逐字节相同的 PUT。没有任何空操作检测。

```ts
const before = configVersion(await zc.getAgent(agentId))          // 4
await zc.updateAgent(agentId, { labels: { probe: 'x' } })
const first = configVersion(await zc.getAgent(agentId))           // 5
await zc.updateAgent(agentId, { labels: { probe: 'x' } })         // identical body
const second = configVersion(await zc.getAgent(agentId))          // 6 - bumped anyway
```

所以「每回合发一次 PUT」这种写法会让版本号无休止地往上翻，而且你没法用「版本号没变」来判断自己那次写入是空操作。下一个回合读到的是新版本；已经在途的回合保持旧版本。

### PUT 会拒绝什么

PUT body 里的 `skills`、`credentials`，以及任何未知字段，都返回 `400`。skill 走它自己的路由管理 —— 见 [Skills](./skills.md)。

## 停止与删除

```ts
const { warnings } = await zc.stopAgent(agentId)
// HTTP 失败会抛错；先读回结果，再决定是否重试。
```

停止之后，对这个 agent 调 `createSession()` 会稳定地重新返回 `409 agent_not_running`。

`deleteAgent()` 是**软删除** 。它把 agent 运行时标记为已删除，返回 `204`。它不停止 agent，不取消正在跑的 workflow，不删除定时任务，也不释放沙箱。不先停就删，会留下一批仍在运行、而你再也寻址不到的资源。

```ts
await zc.stopAgent(agentId)   // do this first
await zc.deleteAgent(agentId) // then this
```

重复删除同样返回 `204`。删除之后，`getAgent()` 返回 `404 not_found`。

## agent 上的 skill

三个方法，完整说明见 [Skills](./skills.md)。

```ts
const skills = await zc.listAgentSkills(agentId)                 // attached skills, resolved and merged
await zc.putAgentSkill(agentId, 'skl_yourown', { enabled: true }) // attach one your tenant owns
await zc.deleteAgentSkill(agentId, 'skl_yourown')                 // detach it
```

刚创建出来的 agent 已经挂上了整个全局 skill 目录，所以对 global scope 的 skill 调 `putAgentSkill()` 会返回 `404` —— 不要重试。见 [Skills](./skills.md)。

## 列出你的 agent

`listAgents({ labels, page })` 枚举你的 key 所绑定的那个用户拥有的 agent。

::: warning SDK 版本
以下分页示例对应 [SDK PR #26](https://github.com/SerendipityOneInc/zoowork-sdk-typescript/pull/26) 中的改动。
SDK 0.5.2 返回单页数组；使用 `.data` 或异步迭代前，需要安装包含该改动的发布版本。
:::

使用 `for await` 读取所有匹配的 agent。SDK 随着遍历按需请求下一页；`break` 后不再请求后续页面：

```ts
for await (const agent of zc.listAgents({ labels: { workspace_id: 'wsp_example' } })) {
  console.log(agent.agent_id)
}
```

只读一页时，`await` 请求后读取 `page.data`。到达末页时，`next_page` 为 `null`：

```ts
const page = await zc.listAgents()
console.log(page.data, page.total, page.next_page)

if (page.hasNextPage()) {
  const next = await page.getNextPage()
  console.log(next.data)
}
```

分页对象保留 `page`、`page_size` 和 `total`。`getNextPage()` 保留原来的 label 筛选条件；没有下一页时会抛错。后续页面请求失败会使迭代抛错；分页信息缺失或无效也会报错，不会悄悄返回不完整的列表。已经获取的分页对象同样支持 `for await`；也可用 `page.iterPages()` 逐页处理。

API 仍使用从 1 开始的数字页码，每页固定 100 条，没有 `limit` 选项。SDK 根据响应中的分页信息计算 `next_page`，它是下一个数字页码。手动续读时，将它作为 `page` 并保留相同的 `labels`。遍历期间新增或删除记录可能使页面内容移动；分页读取不提供快照保证。

**迁移旧数组调用：**将 `const agents = await zc.listAgents(opts)` 改为 `const { data: agents } = await zc.listAgents(opts)`，即可继续读取单页；读取所有匹配项则改用 `for await`。详见 [SDK 分页参考](../reference/typescript-sdk.md#listagentsopts)。

列表的作用域是你这把 key，不是你所在的组织。同一组织内由同事创建的 agent，只要你知道它的 id 就能用 `getAgent()` 读到，但它永远不会出现在你的列表里 —— 所以凡是跨 key 的场景，还是要自己记录 id。

`labels` 按你在创建时声明的 label 过滤，每一项对应一个 `label.<key>` 选择器。`{ labels: { workspace_id: '...' } }` 是最值得记住的一种：它能把 ZooWork 聊天 URL 里的 workspace id —— 也就是路径的第一段 —— 换回它背后的那个 agent。

## 管理配置变更

`config_version` 会在每次更新后递增，但它不是配置历史 API。需要比较或回滚时，
请在自己的应用中保存上一份配置。

`updateAgent()` 没有 version 前置条件。并发修改同一个 section 时，最后一次写入生效。
如果多个进程可能更新同一个 Agent，请在应用侧串行执行这些写入。

## 下一步

- [Sessions](./sessions.md) —— 在一个运行中的 agent 上开 session，驱动一个回合。
- [每用户一个 agent](./per-user-agents.md) —— 用户之间不能共享沙箱文件和记忆时的多用户形态。
- [事件与流式](./events.md) —— 用可续传的 SSE 读 agent 在做什么。
- [Skills](./skills.md) —— 默认挂了什么，你能改什么。
- [错误处理](../reference/errors.md) —— 值得拿来做分支判断的 `ZooworkError.type` 取值。
