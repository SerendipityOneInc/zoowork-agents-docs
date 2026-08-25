---
title: TypeScript SDK 参考
source: /en/reference/typescript-sdk
source_hash: 405df7e6c562797340f61b5e31b41abb4870071b6b7530b88e8dc75ec9330b14
---

# TypeScript SDK 参考

`@zoowork-ai/sdk` 导出的每一个符号，附带编译器看到的签名。

这一页是参考手册。想看按任务组织的说明，从 [Agents](/zh/build/agents)、[Sessions](/zh/build/sessions)
或[快速开始](/zh/get-started/quickstart)开始。

## 安装

```bash
pnpm add @zoowork-ai/sdk
```

```bash
npm install @zoowork-ai/sdk
```

包名是 `@zoowork-ai/sdk`。它**只发 ESM** ，编译目标是 ES2022，所以要在你的 `package.json` 里设
`"type": "module"`。

### 运行时

这个 SDK **没有任何运行时依赖** 。它只用平台自带的 `fetch`、Web Streams 和 `TextDecoder`，别的什么都不用，
所以这些东西存在的地方它都能跑：

| 运行时 | 说明 |
|---|---|
| Node 20 及以上 | 主要目标。`fetch` 和 `ReadableStream` 是内置的。 |
| Cloudflare Workers、Deno、Bun 及其他边缘运行时 | 从构造上就支持。SSE 解析器是照着 Web Streams 写的，不是 Node streams。 |
| 浏览器 | 技术上能跑，但你的 API key 认证的是整个组织。不要把它发到客户端。见[鉴权](/zh/get-started/authentication)。 |

### 注入 `fetch`

`ZooworkConfig.fetch` 会替换掉客户端发出的每一个请求所用的 `globalThis.fetch`，SSE 流也包括在内。
用它来绑定某个运行时特有的 fetch、加埋点，或者在测试里返回预置响应。

```ts
const zc = createZooworkClient({
  apiKey: process.env.ZOOWORK_API_KEY,
  fetch: async (input, init) => {
    const started = Date.now()
    const res = await fetch(input, init)
    console.log(`${init?.method ?? 'GET'} ${input} -> ${res.status} in ${Date.now() - started}ms`)
    return res
  },
})
```

签名是 `(input: string, init?: RequestInit) => Promise<Response>`。第一个参数永远是一个完整解析好的
URL 字符串，绝不会是 `Request` 对象。你提供的、用于流式的 fetch 必须返回一个带可读 `body` 的 `Response`。

## `createZooworkClient(config)`

```ts
function createZooworkClient(cfg?: ZooworkConfig): ZooworkClient
```

返回一个 `ZooworkClient`。不建立任何连接，不发出任何请求，缺少 API key 会在构造时抛错；
其余一切都留到第一次使用时才校验。用一个错的 key 构造客户端会成功；第一次调用才会以
`401` 失败。

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

客户端很轻。一个进程建一个，然后共用。

### `ZooworkConfig`

```ts
interface ZooworkConfig {
  apiKey?: string
  baseUrl?: string
  auth?: ZooworkAuth
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}
```

每个字段都是可选的；只要导出了 `ZOOWORK_API_KEY`，整个对象也可以省掉——
`createZooworkClient()` 是合法调用。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `apiKey` | `string` | 否 | 你那个 `zct_...` key。取值顺序：这个选项，然后 `ZOOWORK_API_KEY`。日常就用这个字段。 |
| `baseUrl` | `string` | 否 | API 的 base，**要带版本前缀** 。取值顺序：这个选项，然后 `ZOOWORK_BASE_URL`，然后导出的 `DEFAULT_BASE_URL`（公开网关）。只有当你要指向另一套部署时才设置它。末尾的斜杠会被去掉；`/models`、`/agents/{id}/sessions` 这类路径会直接拼在后面。 |
| `auth` | `ZooworkAuth` | 否 | 进阶用法。这里传 `{ apiKey }` 等价于顶层的 `apiKey`；两个都传时以 `auth` 为准。见下。 |
| `fetch` | function | 否 | 默认是 `globalThis.fetch`。 |

### `ZooworkAuth`

```ts
type ZooworkAuth = { serviceToken: string } | { apiKey: string }
```

**用 `{ apiKey }`。** 它就是你那个 `zct_...` 组织 service token，会以 `Authorization: Bearer zct_...`
发在每一个请求上，SSE 流也不例外。

```ts
auth: { apiKey: process.env.ZOOWORK_API_KEY! }
```

`{ serviceToken }` 变体仅供内部使用，不能和 API key 一起用；持 `zct_` key 一律传 `{ apiKey }`。

## 方法

`ZooworkClient` 暴露 50 个方法，下面按客户端自己的分组排列。凡是在线格式上嵌在 agent 下面的
东西——session、事件、审批、定时任务、`wake`、`exec`——第一个参数都是 `agentId`。skill registry
和 Environment 是顶层资源，一个都不带。

**模型**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `listModels()` | `Promise<ModelInfo[]>` | 列出你的组织能选的模型别名。检查一个 key 是否可用的最便宜的方式。 |

**Agent**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `createAgent(input, idempotencyKey?)` | `Promise<AgentRecord>` | 创建一个 agent。返回的是**扁平的创建回执** ，不是读取投影。返回的 agent 处于停止状态。 |
| `listAgents(opts?)` | `Promise<AgentRecord[]>` | 列出你的 key 所绑定的那个用户拥有的 agent。`opts.labels` 按 declared 里的 label 过滤，`opts.page` 从 1 开始，页大小固定为 100。作用域是 `owner_uid` **且** `org_id`，所以同事在你组织里建的 agent，按 id 读得到，却不会出现在这个列表里。 |
| `getAgent(agentId)` | `Promise<AgentRecord>` | 读取一个 agent。返回的是**投影** ：配置在 `declared` 下，版本号在 `status.config_version`。 |
| `updateAgent(agentId, sections)` | `Promise<AgentRecord>` | PUT 你点名的 declared section，按 section 合并。每次调用都会 bump `config_version`。 |
| `deleteAgent(agentId)` | `Promise<void>` | 软删除该 agent。不会停止它。 |
| `startAgent(agentId)` | `Promise<{ warnings: string[] }>` | 把 `desired_state` 翻成 `running`。任何 session 调用之前都必须先做这一步。 |
| `stopAgent(agentId)` | `Promise<{ warnings: string[] }>` | 把 `desired_state` 翻成 `stopped`。 |
| `waitUntilRunning(agentId, opts?)` | `Promise<AgentRecord>` | 轮询 `status.desired_state`，直到它读到 `running`，然后把那份投影交给你。默认：30 秒预算，两次轮询间隔 500 毫秒。超时抛 `408`/`timeout`。 |
| `listAgentSkills(agentId, opts?)` | `Promise<AgentSkill[]>` | 列出已解析到这个 agent 上的 skill。 |
| `putAgentSkill(agentId, skillId, opts?)` | `Promise<{ config_version?: number; warnings?: string[] }>` | 安装一个你自己租户拥有的 skill。全局目录的 id 返回 404。 |
| `deleteAgentSkill(agentId, skillId)` | `Promise<void>` | 卸载一个 skill。 |

**Skill registry**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `uploadSkill(zip, opts)` | `Promise<SkillRecord>` | 以 zip 上传一个 skill 包；一次调用同时创建 skill 记录**和** 版本 1。`opts.scope` 只能是 `org` 或 `personal`——`global` 和 `pack` 返回 403。zip 里那个唯一的顶层目录名，必须和 `SKILL.md` frontmatter 里的 `name` 一致。 |
| `uploadSkillVersion(skillId, zip, opts?)` | `Promise<SkillRecord>` | 从一个 zip 发布已有 skill 的新版本。安装时没固定版本的 agent 会自己跟到新版本。 |
| `listSkills(opts?)` | `Promise<SkillRecord[]>` | 你的 key 能看到的 registry 目录：global skill，加上你自己的 org 和 personal。`q` 按名字匹配，`page` 从 1 开始，页大小固定为 100。 |
| `deleteSkill(skillId)` | `Promise<void>` | 删除 registry 里的一个 skill（204）。org 和 personal scope 没有占用检查：装了它的 agent 直接失去它。 |

**Session 与事件**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `createSession(agentId, input, idempotencyKey?)` | `Promise<SessionRecord>` | 开一个 session。要求 agent 处于运行状态，否则 `409 agent_not_running`。 |
| `getSession(agentId, sessionId, opts?)` | `Promise<SessionRecord>` | 读取一个 session，可选带上落盘的会话记录。 |
| `listSessions(agentId, opts?)` | `Promise<SessionRecord[]>` | 一个 agent 的 session，按 `updated_at` 从新到旧，每页 50 条，`page` 从 1 开始。没有游标；`run_status` 就是在这个面上才拿得到。 |
| `archiveSession(agentId, sessionId)` | `Promise<{ session_id?: string; archived: boolean }>` | 盖上 `archived_at`。之后写入返回 `409 session_archived`，读取照常。先中断正在跑的回合。 |
| `deleteSession(agentId, sessionId)` | `Promise<void>` | 软删除这个 session（204），会先取消正在跑的回合。会话记录和事件为审计保留。 |
| `postEvents(agentId, sessionId, events)` | `Promise<{ events: { id?: string \| null; type?: string; accepted?: boolean; [k: string]: unknown }[] }>` | 往 session 里写入 user 或 system 事件；被接受的事件以完整事件对象回显。 |
| `listEvents(agentId, sessionId, opts?)` | `Promise<SessionEvent[]>` | 读取统一事件日志，你自己的输入也在里面。**一次调用只返回一页。** |
| `listEventsPage(agentId, sessionId, opts?)` | `Promise<SessionEventPage>` | 同一页，但带 `hasMore`/`nextCursor`——手动翻页的原语。 |
| `listAllEvents(agentId, sessionId, opts?)` | `Promise<SessionEvent[]>` | 跟着服务端的游标拿到全部持久事件。要全量就用它，别自己给 `listEvents` 翻页。 |
| `streamEvents(agentId, sessionId, opts?)` | `AsyncGenerator<SessionEvent>` | 通过 SSE 流式读取持久事件，可用 `cursor` 续传。 |

**审批**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `listApprovals(agentId, opts?)` | `Promise<ApprovalRecord[]>` | 停在人工决策上的工具调用。`opts.status` 只能不传、或者传 `'pending'`，所以已处理的那些列不出来。这是平台上另一套独立的审批资源，不是 `user.tool_confirmation` 那条事件通路；后端没接线的地方，这条路由返回 `501 not_configured`。 |
| `resolveApproval(agentId, approvalId, input)` | `Promise<Record<string, unknown>>` | 用 `decision` 处理一条审批，取值是 `allow-once`、`allow-always` 或 `deny`；其他取值一律 400。可选的 `resolvedBy` 记录是谁做的决定。同一族路由，同样是 `501`。 |

**System prompt**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `getSystemPrompt(agentId)` | `Promise<SystemPromptInfo>` | 声明的 system-prompt pin 和实际生效的渲染模板。新建的 agent 生来就 pin 在当前 active 的平台版本上；`declaration: null` 表示一个模板机制落地之前的老 agent，仍走 virtual legacy 行为。 |
| `previewSystemPrompt(agentId, input)` | `Promise<SystemPromptPreview>` | 按你给的运行时事实装配出完整 prompt，不碰任何 session——确定性输出，`transcript` 恒为 `[]`，`slot_hashes` 里每个模板 slot 一个哈希。输入有六个必填字段，少任何一个都会返回一个点名该字段的 400：`config_version`（必须是 agent 当前版本，否则 `409 config_version_changed`）、`now_ms`、`session_id`、`model_display`、`workspace_dir` 和 `tool_names`。`channel`、`chat_type`、`session_key`、`subagent` 是可选的。 |
| `upgradeSystemPrompt(agentId, input)` | `Promise<SystemPromptUpgrade>` | 唯一能挪 pin 的写入。`expected_config_version` 是必填的 CAS（过期是 `409 config_version_changed`——先读新值再升级）；省略 `template_version` 就升到当前 active 的平台版本。200 回执带新的 `config_version`。需要 2026-08-14 或更新的网关——更老的部署在这条 `{id}:verb` 语法的路由上回网关 404。 |

**Artifacts**

Artifact 由 agent 自己循环内的 `artifact_publish` 工具发布；这些方法管理它发布出来的东西。
对一个 agent 的第一次 artifact 调用会多花一次 `getAgent()`，之后按 agent 缓存。如果这个 agent
的投影里没有 ownership，这一步会抛出 `status: 500`、`type: 'ownership_unavailable'` 的
`ZooworkError`——它是本地合成的，没有任何服务端响应能解释它。

| 方法 | 返回 | 做什么 |
|---|---|---|
| `listArtifacts(agentId, opts?)` | `Promise<ArtifactPage>` | 一次一页（`{artifacts, page, has_more}`）——而且和 `listEvents` 不同，`has_more` 会告诉你截断了。`limit` 默认 50、上限 100；用 `sessionId`、`sourcePath`、`createdBefore` 过滤。 |
| `getArtifact(agentId, artifactId)` | `Promise<ArtifactRecord>` | 一行 artifact。它的 `status` 是 `pending`、`ready`、`failed` 或 `deleted`，只有 `ready` 的行才带得出一个可解析的 `url`。外部 id 和未知 id 都是 404。 |
| `downloadArtifact(agentId, artifactId)` | `Promise<{ artifact_id?: string; url?: string }>` | 为 `ready` 的 artifact 换发一个新访问 URL。URL 是可撤销的 bearer capability——当密钥对待。从未 finalize 的行返回 `409 artifact_not_ready`。 |
| `deleteArtifact(agentId, artifactId)` | `Promise<ArtifactRecord>` | 删除一个 artifact，返回引擎留下的那行。 |

**自动化：定时任务与 wake**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `listSchedules(agentId)` | `Promise<ScheduleRecord[]>` | 这个 agent 的定时任务。列表返回的是调度器自己的 describe 形状，上面再合并一层 camelCase 投影——防御性地读。 |
| `createSchedule(agentId, input, idempotencyKey?)` | `Promise<ScheduleRecord>` | 创建一个定时任务。`201`，回执里只有 `schedule_name`，没有定义本身。定时任务比 `stopAgent()` 和 `deleteAgent()` 活得久；得你自己删。 |
| `getSchedule(agentId, scheduleId)` | `Promise<ScheduleRecord>` | 读取一个定时任务，用的是 camelCase 的读取词表。你发进去的东西，没有一样按原来的名字回来。 |
| `updateSchedule(agentId, scheduleId, update)` | `Promise<ScheduleRecord>` | 替换定义。要改触发节奏就发 `schedule`，绝不要把读到的 `scheduleSpec` 发回去——那个会返回 `200` 然后被静默忽略。SDK 会把六个被拒的字段全部剥掉，所以「读出来、改一改、再写回去」这套在 JavaScript 里也能成立。 |
| `deleteSchedule(agentId, scheduleId)` | `Promise<void>` | 删除一个定时任务。和 `updateSchedule` 一样，它不提供跨超时的幂等保证——超时之后靠列出来对账，不要盲目重试。 |
| `triggerSchedule(agentId, scheduleId)` | `Promise<{ schedule_name?: string; triggered: boolean }>` | 带外地立刻触发一次。不影响原来的节奏。 |
| `listScheduleRuns(agentId, scheduleId, opts?)` | `Promise<ScheduleRun[]>` | 过去的触发记录，从新到旧。`limit` 默认 20，上限 100。行有两种形状——按 `source` 分支。 |
| `wake(agentId, input)` | `Promise<WakeResult>` | 往 agent 的 heartbeat 队列里塞一条提醒。`next-heartbeat`（默认）只写入待处理记录；`now` 还会去踢 heartbeat 定时任务，没有启用 heartbeat 时返回 `409`。还有第三个选项 `deliverToUser: false`，让这条提醒只留在 agent 自己的推理里。`WakeResult` 是 `{ mode, queued, triggered }`；`triggered` 只在 `now` 模式下有意义，表示 heartbeat 到底有没有被踢起来。 |

`ScheduleInput` 有三个必填字段。`schedule_id` 由你自己取，要匹配
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`——用同一个 id 但**不同的**定义再创建一次是 `409`。
`schedule` 是触发节奏。`payload.kind` 必须是 `'agentTurn'`，这是管理面唯一接受的 kind。

```ts
await zc.createSchedule(agentId, {
  schedule_id: 'daily-digest',
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  payload: { kind: 'agentTurn', message: 'Summarise yesterday.' },
  sessionTarget: 'isolated',
})
```

可选字段是 `sessionTarget`、`delivery`、`enabled`、`deleteAfterRun` 和 `jobKind`。
`sessionTarget` 决定这个回合在哪里跑：不填或传 `'isolated'`，每次触发都开一个新 session；
传 `session:<id>` 则打到这个 agent 已有的某个 session 上。它在创建之后**不可变**。

然后你把它读回来，上面这些名字一个都没活下来。你的 `schedule_id` 变成 `name` 回来——
这才是你传给 `getSchedule`、`updateSchedule` 和 `deleteSchedule` 的那个。`scheduleId` 字段是
全限定名 `cron/{computer_id}/{agent_id}/{schedule_id}`，不是你取的那个 id。触发节奏在
`scheduleSpec.cronExpressions[0]`，这是读取结果里唯一带节奏的地方；`sessionTarget` 读回来是
`execution.kind`。

`updateSchedule` 拒收六个字段，既是编译错误，运行时也会再剥一遍。其中两个就是刚说的读取形状：
`scheduleSpec` 和 `sessionTarget`。另外四个——`execution`、`originMetadata`、`contextSnapshot`
和 `creatorPrincipalRef`——由服务端派生，会返回
`400 execution, originMetadata, creatorPrincipalRef, and contextSnapshot are server-derived`。
这六个全都是 `getSchedule()` 会交给你的东西，所以手写的读改写往返需要这份清单，走 SDK 则不需要。

**Exec**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `exec(agentId, args)` | `Promise<ExecResult>` | 在 agent 的沙箱里跑一条 argv——不是 shell 字符串——cwd 固定为 `/workspace`。**非零退出码依然是 HTTP 200** ：这个 promise 会 resolve，所以要自己看 `exit_code`。它要求 agent 级的沙箱和一份已渲染的配置：session 级的 agent 是 `409 exec_requires_agent_scope`，没渲染过的是 `409 exec_config_not_ready`。 |

命令的默认超时是 300 秒，`stdout` 和 `stderr` 各自在 200,000 字符处截断。这两条限制都不会以错误的
形式告诉你，所以一条跑得久、或者话很多的命令，回来的样子和一条短命令没有区别。

**Environment**

| 方法 | 返回 | 做什么 |
|---|---|---|
| `listEnvironments(opts?)` | `Promise<EnvironmentRecord[]>` | 你的组织能看到的 Environment，`page` 从 1 开始。没动过的 agent 固定在上面的那个平台默认 Environment 不在里面。 |
| `getEnvironment(environmentId)` | `Promise<EnvironmentRecord>` | 读取一个 Environment。你组织之外的一律 `404`，平台默认的那个也一样——这是选择器不匹配，不是权限问题。 |
| `createEnvironment(input, idempotencyKey?)` | `Promise<EnvironmentRecord>` | 创建一个 Environment 及其第一个版本。`resource.config` 只收 `packages`、`files`、`build`、`networking` 这四个键；出现别的键就是 `400 invalid_environment_config`。 |
| `archiveEnvironment(environmentId)` | `Promise<EnvironmentRecord>` | 归档它。SDK 会替你把 `{id}:archive` 里的冒号做百分号编码——裸的 `:` 会让引擎匹配不到这条路由、返回 404。 |
| `createEnvironmentVersion(environmentId, config, idempotencyKey?)` | `Promise<EnvironmentVersionRecord>` | 给已有的 Environment 加一个不可变版本。SDK 会把你的 `config` 包成 `{ resource: { config } }`，和创建时一致。 |
| `getEnvironmentVersion(environmentId, version)` | `Promise<EnvironmentVersionRecord>` | 读取一个版本。要判断某个版本能不能用，轮询**这个** ，看 `status`；这里没有 `state` 字段，照着 `state` 写的循环永远不会结束。 |

只有下面有小节的方法才带着签名之外的行为；其余的都是一次调用的事。一个方法在客户端上，不等于它这条
路由已经被跑过——这件事记在[能力矩阵](/zh/reference/capabilities)里，一族一族地记。

下面所有代码片段都假设：

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

---

### `listModels()`

```ts
listModels(): Promise<ModelInfo[]>
```

没有参数。以扁平数组返回运行时的模型目录；SDK 同时接受裸数组和 `{ models: [...] }` 两种线格式，
交给你的永远是一个数组。

```ts
const models = await zc.listModels()
console.log(models.length, models[0]?.model)
```

```json
[
  {
    "model": "litellm/claude-sonnet-5",
    "display_name": "Claude Sonnet 5",
    "family": "anthropic",
    "api": "anthropic-messages"
  }
]
```

把 `model` 的值原样传进 `resource.model.primary`。不要把别名背后那个真实的 provider 模型名写死在代码里。

---

### `createAgent(input, idempotencyKey?)`

```ts
createAgent(
  input: { resource: AgentResource; ownership?: Ownership },
  idempotencyKey?: string,
): Promise<AgentRecord>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `input.resource` | `AgentResource` | 配置。`name` 必填。 |
| `input.ownership` | `Ownership` | 这里不要传。它在 `createEnvironment` 上是**必填**的，那边从一份 agent 记录的 `ownership` 里取。 |
| `idempotencyKey` | `string` | 作为 `Idempotency-Key` 头发送。你不传它时，这个头完全不会出现。 |

返回**创建回执** ：一个扁平对象，带 `agent_id`、顶层的 `config_version`、`ownership` 和
`resolved_skills`。它不带 `declared`，也不带 `status`。

```ts
const created = await zc.createAgent(
  {
    resource: {
      name: 'research-agent',
      model: { primary: 'litellm/claude-sonnet-5' },
    },
  },
  'provision-research-agent-1',
)

console.log(created.agent_id, created.config_version) // "agt_...", 1
```

新建的 agent 是**停止** 的：没先调 `startAgent()` 就 `createSession()`，就是
`409 agent_not_running`。见[快速开始](/zh/get-started/quickstart)。

这份回执上的 `config_version` 立刻就会过期——回执写着 `1`，紧接着一次 `getAgent()` 常常已经是
`3` 了。见[错误处理](/zh/reference/errors)。

---

### `getAgent(agentId)`

```ts
getAgent(agentId: string): Promise<AgentRecord>
```

返回**读取投影** ，它和创建回执是两种不同的形状：配置在 `declared` 下，版本号在 `status.config_version`，
没有顶层的 `config_version`，也没有顶层的 `name`。

```ts
const agent = await zc.getAgent(agentId)

console.log(agent.declared?.name)            // 'research-agent'
console.log(agent.status?.desired_state)     // 'running'
console.log(agent.status?.config_version)    // 3
```

写一个同时覆盖两种形状的访问器，然后到处用它：

```ts
import type { AgentRecord } from '@zoowork-ai/sdk'

const configVersion = (a: AgentRecord): number | undefined =>
  a.status?.config_version ?? a.config_version
```

未知的、已软删除的、或属于其他组织的 agent id，都返回 `404 not_found`。

---

### `updateAgent(agentId, sections)`

```ts
updateAgent(agentId: string, sections: Record<string, unknown>): Promise<AgentRecord>
```

PUT 你点名的那些 declared section，返回读取投影。

**你没写的 section 会被保留。** 合并是按 section 做的，只深一层：你确实发了的那个 section，
会整体替换掉它原来的值。

```ts
const updated = await zc.updateAgent(agentId, { labels: { tier: 'paid' } })

console.log(updated.declared?.name)   // unchanged - `name` was not in the body
console.log(updated.declared?.labels) // { tier: 'paid' } - replaced, not merged key-by-key
```

连这条规则都有例外，就是 `tool_policy` 和 `system_prompt`：任何点到它们的 PUT 都会整体替换。
见[工具](/zh/build/tools)。

**每一次成功的 PUT 都会 bump `config_version`，包括请求体和已存内容逐字节相同的那一次。**
见[错误处理](/zh/reference/errors)。

PUT 请求体里出现 `skills`、`credentials` 以及未知字段，都返回 `400`。

---

### `deleteAgent(agentId)`

```ts
deleteAgent(agentId: string): Promise<void>
```

软删除该 agent，resolve 时不带任何值。重复调用会成功。删除之后，`getAgent()` 返回 `404 not_found`。

它**不会** 停止 agent、不会取消正在跑的 workflow、不会删除定时任务、也不会释放 sandbox——
先停再删。见 [Agents](/zh/build/agents)。

---

### `startAgent(agentId)`

```ts
startAgent(agentId: string): Promise<{ warnings: string[] }>
```

把 `desired_state` 翻成 `running`。这是 `createSession()` 和 `postEvents()` 的前置条件。
它很快——实测在一秒以内。

```ts
const { warnings } = await zc.startAgent(agentId)
console.log(warnings)
// [ 'channel_routes_reload_failed: routes reload returned 404' ]
```

**`warnings` 是提示信息，不是失败。** 纯 API 的 agent 每次启动、每次停止都会报
`channel_routes_reload_failed`；不要因为它去重试。见 [Agents](/zh/build/agents)。

然后等 `status.desired_state === 'running'`，永远不要等 `status.actual_state`。这个等待本身
就是一个方法——不要自己写这个循环：

```ts
const agent = await zc.waitUntilRunning(agentId)
console.log(agent.status?.desired_state) // 'running'
```

```ts
waitUntilRunning(
  agentId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<AgentRecord>
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `opts.timeoutMs` | `number` | `30_000` | 总预算。启动实测在一秒以内，所以这个预算是留给倒霉的那一天的。 |
| `opts.intervalMs` | `number` | `500` | 两次轮询之间的间隔。 |
| `opts.signal` | `AbortSignal` | 无 | 取消这次等待，正在飞的那个请求也一起取消。 |

它轮询 `getAgent()`，拿第一份读到 `running` 的投影 resolve。超时时抛出一个 `status: 408`、
`type: 'timeout'` 的 `ZooworkError`；被 abort 时是 `status: 0`、`type: 'aborted'`。
**这两个都是本地合成的** ——服务端从来不会发它们，而且这次 abort 不会漏出一个 `DOMException`。

---

### `stopAgent(agentId)`

```ts
stopAgent(agentId: string): Promise<{ warnings: string[] }>
```

把 `desired_state` 翻成 `stopped`，warnings 的行为和 `startAgent()` 一样。停止之后，对这个 agent 调
`createSession()` 返回 `409 agent_not_running`。

```ts
const { warnings } = await zc.stopAgent(agentId)
```

start 和 stop 每次调用都会重跑各自的收敛动作，所以对同一个 id 再调一次是安全的。

---

### `listAgentSkills(agentId, opts?)`

```ts
listAgentSkills(agentId: string, opts?: { verbose?: boolean }): Promise<AgentSkill[]>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.verbose` | `boolean` | 发送 `?verbose=true`，会把不可用的和被排除的条目也一起返回。 |

返回已解析并合并到这个 agent 上的 skill，已从线上的 `{ skills: [...] }` 信封里拆出来。

```ts
const skills = await zc.listAgentSkills(agentId)
console.log(skills.length, skills.map((s) => s.name).slice(0, 5))
```

刚创建的 agent 已经挂上了整个全局目录，所以在你动手装任何东西之前，先调一下这个。

---

### `putAgentSkill(agentId, skillId, opts?)`

```ts
putAgentSkill(
  agentId: string,
  skillId: string,
  opts?: { enabled?: boolean; versionPin?: number | null },
): Promise<{ config_version?: number; warnings?: string[] }>
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `opts.enabled` | `boolean` | `true` | 在请求体里作为 `enabled` 发送。 |
| `opts.versionPin` | `number \| null` | `null` | 在请求体里作为 `version_pin` 发送。 |

```ts
const { config_version } = await zc.putAgentSkill(agentId, 'skl_yourown', { enabled: true })
```

只有**你自己租户上传的** skill（`org` 或 `personal` scope）能通过公开网关安装。`global` 目录里的 id
列得出来，但在这里回 `404`。那些全局 skill 在创建时就已经挂上了，所以既没有东西可装，也没有东西可卸。

::: warning 尚未验证
我们实测过 `global` scope id 上的这个 404。我们没有端到端装过 `org` 或 `personal` scope 的 skill，
因为测试租户下不存在这样的 skill。路由对这两种 scope 是开放的；在你依赖它之前请自己确认一遍。
:::

---

### `deleteAgentSkill(agentId, skillId)`

```ts
deleteAgentSkill(agentId: string, skillId: string): Promise<void>
```

卸载一个 skill，resolve 时不带任何值。scope 规则和 `putAgentSkill()` 相同。

```ts
await zc.deleteAgentSkill(agentId, 'skl_yourown')
```

---

### `createSession(agentId, input, idempotencyKey?)`

```ts
createSession(
  agentId: string,
  input: { initial_events?: OutboundEvent[]; metadata?: Record<string, unknown> },
  idempotencyKey?: string,
): Promise<SessionRecord>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `input.initial_events` | `OutboundEvent[]` | 只接受 `user.message`，最多 50 条。传了就会立刻启动第一个回合。 |
| `input.metadata` | object | 随 session 存下来的任意 JSON，`getSession()` 会原样回显。没有任何东西会解释它。之后你没法再往里加。 |
| `idempotencyKey` | `string` | 作为 `Idempotency-Key` 头发送。 |

```ts
const session = await zc.createSession(
  agentId,
  {
    initial_events: [{ type: 'user.message', content: 'Summarize this brief.' }],
    metadata: { source: 'my-app' },
  },
  `chat-${incomingMessageId}`,
)

console.log(session.session_id)  // "ses_example"
console.log(session.session_key) // "api:ses_example"
```

agent 必须处于运行状态。对一个已停止的 agent 调用，会抛出 `ZooworkError`，`status: 409`，
`type: 'agent_not_running'`。

幂等 key 要从你自己系统里稳定的东西派生，绝不要用调用时现生成的值。见[错误处理](/zh/reference/errors)。

---

### `getSession(agentId, sessionId, opts?)`

```ts
getSession(
  agentId: string,
  sessionId: string,
  opts?: { history?: boolean; limit?: number },
): Promise<SessionRecord>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.history` | `boolean` | 只有 `true` 会被发送，形如 `?history=true`。会带上落盘的会话记录。 |
| `opts.limit` | `number` | 取最近多少行会话记录。服务端默认 100，最大 500。只在 `history: true` 时有意义。 |

```ts
import { messageText } from '@zoowork-ai/sdk'

const s = await zc.getSession(agentId, sessionId, { history: true, limit: 20 })

console.log(s.run_status)  // 'succeeded'  <- the live field
console.log(s.status)      // null         <- always

for (const row of s.history ?? []) {
  if (row.entry_type !== 'message') continue
  console.log(row.seq, messageText(row.entry.message))
}
```

---

### `postEvents(agentId, sessionId, events)`

```ts
postEvents(
  agentId: string,
  sessionId: string,
  events: OutboundEvent[],
): Promise<{ events: { id?: string | null; type?: string; accepted?: boolean; [k: string]: unknown }[] }>
```

往一个已存在的 session 里写事件。返回 `202`，每个事件对应一条记录，已从线上的信封里拆出来；
列表缺失时返回 `[]`。被接受的事件返回的就是历史里将出现的完整事件对象（带 `seq`）；未被接受的
仍是 `{ id, type, accepted: false }` 回执。

写入路径接受四种类型：`user.message`、`user.interrupt`、`system.message` 和
`user.tool_confirmation`。

```ts
await zc.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'What is my display name?' },
])
```

`accepted` 的意思是这个事件进了队列，不是说一个回合结束了。回合的结束点是 `run.finished`。

**对一个正在跑的 run 发 `user.interrupt` 会中止它** ：响应带 `accepted: true`，这个 run 以
`run.finished` 结束，其 `payload.status` 是 `aborted`。

```ts
const r = await zc.postEvents(agentId, sessionId, [{ type: 'user.interrupt' }])
console.log(r.events[0]?.accepted)
```

没有 run 在跑的时候，`user.interrupt` 返回 `accepted: false`。**这是一次 no-op，不是错误** ——
不抛任何异常，也没有什么要你处理。

**`system.message` 会在下一个回合到达模型** ，走的是带外通道，而且它的正文放在 `text` 里，
不是 `content`。见[事件](/zh/build/events)。

给每个事件带一个 `idempotency_key`（任何稳定字符串），超时后重试的 `postEvents` 就不会把同一条消息投递两次。

---

### `listEvents(agentId, sessionId, opts?)`

```ts
listEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; types?: string[]; limit?: number },
): Promise<SessionEvent[]>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.cursor` | `string` | 页游标——上一页的 `next_cursor` 或某个流式事件的 `cursor`。 |
| `opts.after` | `number` | 废弃的 engine-only 通道的 seq 游标（没有用户输入）。只留给旧存量游标。 |
| `opts.types` | `string[]` | 服务端过滤，用逗号拼到 `?types=` 上。 |
| `opts.limit` | `number` | 服务端默认 100，最大 500。 |

每一条都会过一遍 `normalizeEvent()`，所以 REST 和 SSE 交给你的是完全相同的 `SessionEvent` 形状。

```ts
const events = await zc.listEvents(agentId, sessionId, { types: ['user.message', 'agent.assistant'] })
```

::: warning 一次调用只返回一页
服务端默认返回 100 个事件、最多 500 个，而 `listEvents` 只返回一页——分页字段被丢掉了。
`listEventsPage` 是保留分页字段的同一个调用：

```ts
listEventsPage(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; types?: string[]; limit?: number },
): Promise<{ events: SessionEvent[]; hasMore?: boolean; nextCursor?: string | null }>
```

把 `nextCursor` 作为 `cursor` 传回去就是手动翻页；不是手动翻页就用 `listAllEvents`。
:::

`listAllEvents` 跟着服务端的 `next_cursor` 一直走到 `has_more` 为 false，对没有游标分页的服务端回落到走 `after`：

```ts
const all = await zc.listAllEvents(agentId, sessionId)
```

```ts
listAllEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; types?: string[]; pageSize?: number },
): Promise<SessionEvent[]>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.after` | `number` | 强制走废弃的 engine-only 通道，并从这个 seq 开始翻。 |
| `opts.types` | `string[]` | 和 `listEvents` 一样的服务端过滤，对每一页都生效。 |
| `opts.pageSize` | `number` | 每次请求用的 `limit`。默认 500，也被夹到 500。 |

事件按 `seq` 升序返回。有几道手写循环通常没有的保险：两条通道在游标推不动时都会停下（且不会把重复页
再拼进结果），所以一个行为异常的服务端只多花你一次请求，而不是把你卡在死循环里；回落通道上，小于等于
游标的事件会被丢掉，所以页边界上被重放的那条事件不会两次到你手里。

---

### `streamEvents(agentId, sessionId, opts?)`

```ts
streamEvents(
  agentId: string,
  sessionId: string,
  opts?: { after?: number; cursor?: string; signal?: AbortSignal },
): AsyncGenerator<SessionEvent>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.cursor` | `string` | 续传令牌——某个之前事件的 `cursor`。服务端从它之后开始重放。 |
| `opts.after` | `number` | 废弃的 engine-only 通道的续传游标。只留给旧存量游标。 |
| `opts.signal` | `AbortSignal` | 中止底层请求。当 signal 已经处于 aborted 状态时，生成器会安静返回，而不是抛错。 |

一个产出 `SessionEvent` 的异步生成器。用 `for await` 消费它。

```ts
import { assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

const ctl = new AbortController()
const budget = setTimeout(() => ctl.abort(), 120_000)

let text = ''
let lastSeq = 0
let outcome: string | undefined

for await (const ev of zc.streamEvents(agentId, sessionId, { signal: ctl.signal })) {
  lastSeq = ev.seq
  text += assistantText(ev)
  if (isRunFinished(ev)) {
    outcome = runOutcome(ev)
    break
  }
}

clearTimeout(budget)
ctl.abort()
console.log(outcome, text)
```

四条值得知道的行为：

- **这个流的作用域是 session，回合结束时它不会关闭。** 你要自己用 `isRunFinished` 跳出来，
  并且在离开循环时永远记得 abort 掉 controller。
- **服务端会在空闲时关闭这个流。** 用
  `streamEvents(agentId, sessionId, { cursor: lastCursor })` 重连，`lastCursor` 从每个事件的
  `cursor` 里记下来。续传是服务端做的，所以两个窗口之间的内容不会丢。SDK 不会替你重连。
- **`chat.delta` 预览帧会被跳过。** 它们以 SSE `event_delta` 帧的形式，走另一条非持久的通道，
  语义是快照替换，SDK 会把它们丢掉。你看到的永远只有持久事件。
- **边界事件会去重。** 每一帧的持久 `seq` 取自 JSON body，取不到时才回退到 SSE 的 `id:` 行；
  生成器会丢弃那些 `seq` 非负、且不大于它上一次产出值的事件，所以重连时被重放的边界事件不会
  两次到达你手里。归一化后 `seq` 为 `-1` 的帧不带可用游标，会被放行而不是丢弃。

非 2xx 响应会抛出 `ZooworkError`。这个特定的错误只由状态行构造，所以**流失败时 `type` 永远是
`undefined`**——请基于 `status` 分支。

## 类型

大多数响应类型的末尾都有 `[k: string]: unknown`。这套 API 处于 Developer Preview 阶段，
可能在同一个版本内新增字段：对你不认识的东西选择忽略，而不是报错。

没有这个索引签名的那几个是**故意封闭的** ——`SessionEvent`、`SessionHistoryEntry`、`ToolCall`、
`ExecResult`、`WakeResult`、`Ownership`、`EnvironmentConfig`、`AgentResource`、`OutcomeConfig`、
`OutcomeEvaluator`、`SystemPromptDeclaration`、`SSEMessage`、`ZooworkConfig` 和 `ZooworkAuth`
不收多余的键，多写一个键是编译错误，而不是一个能活到线上的字段。

这里的小节只覆盖你在本页走过的那些路径上会碰到的类型。skill registry、审批、定时任务、wake、
exec 和 Environment 相关的类型都在[完整导出清单](#完整导出清单)里，而且每一个都把自己字段级的坑
写进了 JSDoc，编辑器悬停就能看到——尤其是 `ScheduleRecord` 和 `ScheduleUpdate`，因为一个定时任务
的写入形状和读取形状是两份不同的文档。

### `SessionEvent`

```ts
interface SessionEvent {
  seq: number
  eventType: SessionEventType | string
  payload: Record<string, unknown>
  runId?: string
  turn?: number
  createdAt?: string
}
```

| 字段 | 说明 |
|---|---|
| `seq` | session 内持久的序号。`listEvents` 和 `streamEvents` 的 `after` 游标用的都是它。当线上既没有 `seq` 字段、SSE 的 `id:` 也不是数字时，取 `-1`。 |
| `eventType` | `SESSION_EVENT_TYPES` 里的一个，或者是一个被原样放过的未知字符串。线上完全没带类型时是 `''`。 |
| `payload` | 事件体。形状随类型而变；用下面的辅助函数，不要闭着眼睛往里伸手。 |
| `runId` | 这个事件属于哪个 run。 |
| `turn` | session 内的回合序号。 |
| `createdAt` | ISO 时间戳。 |

`SessionEvent` 是 camelCase，紧挨着它的 `SessionRecord` 和 `AgentRecord` 是 snake_case——
这是线上的样子，不是笔误，所以不要把 `eventType` 「改正」成 `event_type`。同一个事件，
REST 用 snake_case 拼写，SSE 用 camelCase 拼写；`normalizeEvent()` 把两种都吸收掉，
这就是 SDK 的每一次读取都只给你一种形状的原因。见[事件](/zh/build/events)。

### `AgentRecord`

```ts
interface AgentRecord {
  agent_id: string
  computer_id?: string
  config_version?: number
  declared?: Record<string, unknown>
  resolved_skills?: { skill_id: string; name?: string; version?: number | string; eligible?: boolean }[]
  resolved_environment?: {
    environment_id?: string
    version?: number
    provider?: string
    template_ref?: string
    build_id?: string
    networking?: { type?: 'unrestricted' | 'limited' | string; allowed_hosts?: string[] }
    [k: string]: unknown
  }
  environment_locked?: boolean
  environment_locked_at?: string | null
  status?: AgentStatus
  ownership?: Ownership
  [k: string]: unknown
}
```

这份记录上值得先读一眼的是 `environment_locked`。第一次创建沙箱时它翻成 `true`，从那之后，
每一次改这个 agent 的 Environment 都是 `409 environment_locked`——停掉 agent 也清不掉它。
`environment_locked_at` 是它翻转的时刻。`resolved_environment` 是这个 agent 实际 pin 上的那个
Environment 版本；当 Environment 没声明网络时，它的 `networking` 默认是 `{ type: 'unrestricted' }`。

一个接口，两种响应形状：

| | 创建回执（`createAgent`） | 读取投影（`getAgent`、`updateAgent`） |
|---|---|---|
| 版本号 | `config_version`（顶层） | `status.config_version` |
| 名称 | 没有 | `declared.name` |
| 生命周期状态 | 没有 | `status.desired_state` |
| `declared` | 无 | 有 |
| `status` | 无 | 有 |

`config_version` 被标成可选，正是因为这个。读它的时候写成
`agent.status?.config_version ?? agent.config_version`。

### `AgentStatus`

```ts
interface AgentStatus {
  desired_state?: 'running' | 'stopped' | 'deleted' | string
  actual_state?: 'activating' | 'active' | 'degraded' | 'error' | 'stopped' | 'deleting' | string
  config_version?: number
  render_state?: string
  status_message?: string | null
  channels?: { expected?: number; connected?: number; degraded_since?: string | null }
  [k: string]: unknown
}
```

::: danger 永远不要用 `actual_state` 做闸门
`desired_state` 才是决定 API 能不能用的那个：`running` 是 `createSession()` 和 `postEvents()`
的前置条件，不是 `running` 就是 `409 agent_not_running`。

`actual_state` 是聊天频道的健康度，不是 API 就绪状态。`running` 甚至不在它的枚举里，
所以轮询它的循环永远不会返回。轮询 `status.desired_state`。见 [Agents](/zh/build/agents)。
:::

这里的 `config_version` 是读取路径上的权威版本号。

### `AgentResource`

```ts
interface AgentResource {
  name: string
  model?: { primary: string; input?: string[]; max_tokens?: number }
  persona?: { docs: { name: string; content: string; seed_policy?: string }[] }
  skills?: { skill_id: string; version?: number | 'latest' }[]
  labels?: Record<string, string>
  tool_policy?: Record<string, unknown>
  mcp?: McpServerDeclaration[]
  system_prompt?: SystemPromptDeclaration
  outcome?: OutcomeConfig | null
  sandbox?: { scope: 'agent' | 'session' }
  environment_id?: string
  environment_version?: number
}
```

你发给 `createAgent()` 的配置。`name` 是唯一必填的字段。`mcp` 声明远程 MCP server。
`system_prompt` pin 一个模板版本（创建时省略等于「当前 active 的平台版本」，
从此定住；PUT 时和 `tool_policy` 一样整体替换），`outcome` 是无人值守 cron 触发的 agent 级
默认门。

**`AgentResource` 是封闭的。** 它没有索引签名，所以多写一个键是 TypeScript 错误，
而不是一个能发到服务端的字段。更新的服务端所接受的新字段，只能走
`updateAgent(agentId, sections)`——那个参数的类型是 `Record<string, unknown>`，什么都不检查。

有一个字段类型上允许、但你不该通过公开网关发送：创建时的 `skills`（改用 `putAgentSkill()`）。
逐字段的说明见 [Agents](/zh/build/agents)。

### `AgentSkill`

```ts
interface AgentSkill {
  skill_id?: string
  name?: string
  version?: number | string
  scope?: 'global' | 'org' | 'personal' | 'pack' | string
  eligible?: boolean
  files?: { path: string; size?: number; sha256?: string }[]
  [k: string]: unknown
}
```

`scope` 是决定你能不能管理这个 skill 的字段：通过公开网关，只有 `org` 和 `personal` 能安装。

### `SessionRecord`

```ts
interface SessionRecord {
  session_id: string
  session_key?: string
  channel?: string
  run_status?: string
  status?: string | null
  metadata?: Record<string, unknown>
  archived?: boolean
  updated_at?: string
  history?: SessionHistoryEntry[]
  [k: string]: unknown
}
```

只有读取时带了 `history: true`，`history` 才会出现；它装的是最近的 `limit` 行，按 `seq` 升序排列。

`status` 实际上永远是 `null`——真正在用的字段是 `run_status`，而 `listSessions` 是它拿得到的那个面。
**基于 `session.status` 分支的代码，永远只会走同一个分支。**
`session_key` 带频道前缀：你通过 API 创建的 session 是 `api:<session_id>`。`channel` 在你自己创建的
session 上是 `api`，在定时任务触发出来的 session 上是 `cron`。

### `SessionHistoryEntry`

```ts
interface SessionHistoryEntry {
  seq: number
  entry_type: string
  entry: Record<string, unknown>
  created_at?: string
}
```

一行会话记录。这是**落盘的会话记录，不是事件日志** ：当 `entry_type: 'message'` 时，
对话文本以 `{ role, content }` 的形式放在 `entry.message` 下。`entry_type` 还有别的取值
（session 锚点、压缩标记、模型变更）；过滤出 `message`，其余跳过。

用它来找回那些你漏掉了事件的回答；想要事件流的时候用 `listEvents`。

### `OutboundEvent`

```ts
interface OutboundEvent {
  type: string
  content?: unknown
  [k: string]: unknown
}
```

一个写入侧的事件。`type` 是 `user.message`、`user.interrupt`、`user.tool_confirmation`、
`system.message` 之一。索引签名承载按类型不同的字段：`user.message` 用 `content`，
`system.message` 用 `text`。

`type` 的类型是 `string`，所以打错字也能编译过。服务端会拒绝它。

### `ModelInfo`

```ts
interface ModelInfo {
  model: string
  display_name?: string
  family?: string
  api?: string
  [k: string]: unknown
}
```

`model` 是稳定的别名，作为 `resource.model.primary` 提交。`family` 是展示用的元数据；`api`
是协议面（`anthropic-messages` 或 `openai-completions`）。

### `Ownership`

```ts
interface Ownership {
  owner_uid: string
  org_id: string
}
```

一个持久化锚点，不是鉴权声明。`createAgent()` 里不要传，真实值从 `created.ownership` 读回来。
真正**必填**它的是 `createEnvironment()`：把你从一份 agent 记录上读到的这两个值传过去。

### `ToolCall`

```ts
interface ToolCall {
  phase: 'start' | 'end' | 'blocked'
  toolName: string
  toolCallId: string
  args?: Record<string, unknown>
  isError?: boolean
  resultPreview?: string
}
```

`agent.tool` 事件解码后的形态，由 `toolCall()` 返回。

一次工具调用会产生**一串共享同一个 `toolCallId` 的事件，每个 phase 一个** ：`start` 带 `args`，
`end` 带 `isError` 和 `resultPreview`，`blocked` 表示这次调用停在审批上、**还没有** 执行。
按 `toolCallId` 配对——并发调用时，它们在流里**不相邻** 。一个工具失败不会让 run 失败：
带 `isError: true` 的事件后面，照样跟着 `succeeded` 的 `run.finished`。见[事件](/zh/build/events)。

### 配置类型

`ZooworkConfig`、`ZooworkAuth` 和 `ZooworkClient` 在
[`createZooworkClient`](#createzooworkclient-config) 一节里讲过。`ZooworkClient` 以类型的形式导出，
这样你可以把客户端传进自己的辅助函数：

```ts
import type { ZooworkClient } from '@zoowork-ai/sdk'

async function reply(zc: ZooworkClient, agentId: string, text: string) { /* ... */ }
```

### `ZooworkError`

```ts
class ZooworkError extends Error {
  status: number
  type?: string
}
```

所有方法在遇到非 2xx 响应时都会抛出它。匹配 `error.type`，永远不要匹配报错文本。
完整说明见[错误处理](/zh/reference/errors)。

## 事件辅助函数

作用在 `SessionEvent` 上的纯函数。它们都不碰网络。

| 辅助函数 | 签名 | 返回 |
|---|---|---|
| `isRunFinished` | `(e: SessionEvent) => boolean` | 对 `run.finished` 返回 `true`。 |
| `runOutcome` | `(e: SessionEvent) => 'succeeded' \| 'failed' \| 'aborted' \| undefined` | 这个 run 的结果；其他事件返回 `undefined`。 |
| `assistantText` | `(e: SessionEvent) => string` | `agent.assistant` 的助手文本；其他类型一律 `''`。 |
| `thinkingText` | `(e: SessionEvent) => string` | `agent.thinking` 的推理文本；其他类型一律 `''`。 |
| `toolCall` | `(e: SessionEvent) => ToolCall \| undefined` | `agent.tool` 解码后的工具活动；其他情况是 `undefined`。 |
| `messageText` | `(message: unknown) => string` | 一条 `{ role, content }` 消息的文本。 |
| `normalizeEvent` | `(raw: unknown, sseId?: string) => SessionEvent` | 把两种线格式中的任意一种吸收成 `SessionEvent`。 |

因为文本类辅助函数对不匹配的类型返回 `''`，你可以无条件地累加。见[事件](/zh/build/events)。

### `messageText(message)`

助手文本在 `payload.message.content[]` 里，而 `content` 通常是一个 block 数组，其中**只有
`{ type: 'text', text }` 这种 block 带文本**——thinking 和工具调用的 block 不带，
而且一条消息可能装着好几个文本 block。它也接受一个普通字符串，写入侧的 `user.message`
content 回来时就是这种形态。

`messageText` 两种都能处理，所以它既适合处理事件，也适合处理会话记录的行：

```ts
import { messageText } from '@zoowork-ai/sdk'

const s = await zc.getSession(agentId, sessionId, { history: true })
for (const row of s.history ?? []) {
  if (row.entry_type === 'message') console.log(messageText(row.entry.message))
}
```

`assistantText(e)` 就是加了事件类型判断的 `messageText(e.payload.message)`。

### `normalizeEvent(raw, sseId?)`

```ts
function normalizeEvent(raw: unknown, sseId?: string): SessionEvent
```

两种线格式都接受，且永远不抛错。`sseId` 是 SSE 的 `id:` 行，当 JSON 体里没带 `seq` 时用它兜底。
`listEvents` 和 `streamEvents` 里 SDK 已经替你调过了；只有当你自己解析线上数据时，才需要直接调它。

未知的事件类型会原样放过，而不是抛错，因为 API 可能在同一个版本内新增类型。

### `SESSION_EVENT_TYPES`

```ts
const SESSION_EVENT_TYPES: readonly [
  'run.started', 'run.finished',
  'chat.delta', 'chat.final', 'chat.aborted', 'chat.error',
  'agent.lifecycle', 'agent.assistant', 'agent.thinking', 'agent.tool', 'agent.item',
  'agent.plan', 'agent.approval', 'agent.command_output', 'agent.patch',
  'agent.compaction', 'agent.error',
  'attachment.created', 'message.outbound',
]

type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]
```

读取侧的完整词表：19 种类型。`SessionEvent.eventType` 的类型是 `SessionEventType | string`，
所以来自更新版本服务端的未知类型仍然能通过类型检查，也仍然会到达你手里。

用这个数组做校验，或者用来构造过滤条件：

```ts
import { SESSION_EVENT_TYPES, type SessionEventType } from '@zoowork-ai/sdk'

const known = new Set<string>(SESSION_EVENT_TYPES)
if (!known.has(ev.eventType)) console.warn('unknown event type', ev.eventType)
```

`run.finished` 是一个回合的结束，`payload.status` 取 `succeeded`、`failed` 或 `aborted`。
`chat.delta` 永远不会从 `streamEvents` 到达你——那些帧被跳过了。

## `parseSSE`

```ts
function parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage>

interface SSEMessage {
  event: string
  id?: string
  data: unknown
}
```

原始的 SSE 行解析器，为进阶用途而导出。`streamEvents()` 内部已经在用它，常规工作里你不需要它。

它每一帧产出一个 `SSEMessage`：`event` 是 SSE 事件名（默认是 `message`），`id` 是 `id:` 行——
对持久事件帧来说它就是 `seq`——`data` 是 JSON 解析后的体，负载不是 JSON 时退回原始字符串。

当你自己调用流式端点时才用它，比如想看到 `streamEvents()` 刻意跳过的 `event_delta` 预览帧：

```ts
import { parseSSE, normalizeEvent } from '@zoowork-ai/sdk'

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
})

for await (const msg of parseSSE(res.body!)) {
  if (msg.event === 'event_delta') continue
  console.log(normalizeEvent(msg.data, msg.id))
}
```

丢掉 `id:` 行会让你的续传游标卡死，这就是解析器把它暴露出来的原因。

## 完整导出清单

```ts
import {
  // client
  createZooworkClient,
  DEFAULT_BASE_URL,
  ZooworkError,
  type ZooworkClient,
  type ZooworkConfig,
  type ZooworkAuth,

  // resource types
  type Ownership,
  type ModelInfo,
  type AgentResource,
  type AgentRecord,
  type AgentStatus,
  type AgentSkill,
  type McpServerDeclaration,
  type SkillRecord,
  type SessionRecord,
  type SessionHistoryEntry,
  type SessionEvent,
  type OutboundEvent,

  // approvals
  type ApprovalDecision,
  type ApprovalRecord,

  // system prompt
  type SystemPromptDeclaration,
  type SystemPromptInfo,
  type SystemPromptPreview,
  type SystemPromptPreviewInput,
  type SystemPromptUpgrade,

  // artifacts
  type ArtifactStatus,
  type ArtifactRecord,
  type ArtifactPage,

  // outcome
  type OutcomeConfig,
  type OutcomeEvaluator,

  // schedules, wake, exec
  type ScheduleSpec,
  type SchedulePayload,
  type ScheduleInput,
  type ScheduleUpdate,
  type ScheduleRecord,
  type ScheduleRun,
  type WakeResult,
  type ExecResult,

  // environments
  type EnvironmentConfig,
  type EnvironmentResource,
  type EnvironmentRecord,
  type EnvironmentVersionRecord,

  // events
  SESSION_EVENT_TYPES,
  type SessionEventType,
  normalizeEvent,
  isRunFinished,
  runOutcome,
  messageText,
  assistantText,
  thinkingText,
  toolCall,
  type ToolCall,

  // sse
  parseSSE,
  type SSEMessage,
} from '@zoowork-ai/sdk'
```

12 个值和 42 个类型，由一个把入口导出当成集合来断言的测试钉住——少一个符号、或者多出一个不该有的
符号，它都会失败。`DEFAULT_BASE_URL` 就是那个会被 `ZOOWORK_BASE_URL` 和 `baseUrl` 选项覆盖掉的
公开网关 base；把它导出来，是为了让你能拿它做比较，或者自己拼 URL。

这就是全部的公开接口面。不在这个清单上的东西就是不存在——特别地，没有 `patchSession`：
`PATCH /agents/{id}/sessions/{sid}` 返回 `405`，所以一个 session 的 `metadata` 是在
`createSession()` 时一次写定的。见[不支持的能力](/zh/reference/not-supported)。

## 下一步

- [错误处理](/zh/reference/errors) —— 值得拿来分支的 `ZooworkError.type` 取值。
- [Agents](/zh/build/agents) —— 创建、启动、修改，以及两种响应形状。
- [Sessions](/zh/build/sessions) —— 驱动一个回合、给事件日志翻页、读取会话记录。
