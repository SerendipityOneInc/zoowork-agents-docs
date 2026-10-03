---
title: Agents
description: 创建、配置、启动、更新和删除 agent，并处理带版本的不同响应结构。
source: /en/build/agents
source_hash: 9a5436647494144756a8699667ea972fafca3ed70f2a59552c3083dcb23aca6a
---

# Agents

agent 是一个持久化的配置对象：一个名字、一个模型、若干 persona 文档、labels，以及一份工具策略。你创建它一次，启动它，然后在它下面开 [session](./sessions.md)。配置存在服务端，所以每个 session 都继承它，你不需要重复发送任何东西。

示例复用[快速开始](../get-started/quickstart.md)中的 client 和 Agent。Python 调用在 async 函数中运行。curl 先完成[鉴权](../get-started/authentication.md)中的环境变量设置。

## 准备

本页每段代码都假设有这个客户端。

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

```python [Python]
from zoowork import create_zoowork_client

client = create_zoowork_client()
```

```bash [curl]
export AGENT_ID='your-agent-id'
```

:::

## 创建 agent

`createAgent(input, idempotencyKey?)` 接收一个 `resource`（配置本身），返回一个 `AgentRecord`。

::: code-group

```ts [TypeScript]
import type { AgentRecord } from '@zoowork-ai/sdk'

const models = await zc.listModels()
const primary = models.find(
  (model) => model.model === 'litellm/gpt-5.6-terra' && model.selectable !== false,
)?.model
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

const agentId = created.agent_id
console.log(agentId, created.config_version)

await zc.startAgent(created.agent_id)
await zc.waitUntilRunning(created.agent_id)
```

```python [Python]
models = await client.list_models()
primary = next(
    (model["model"] for model in models
     if model["model"] == "litellm/gpt-5.6-terra" and model.get("selectable") is not False),
    None,
)
if primary is None:
    raise RuntimeError("Choose a model returned by list_models()")
created = await client.create_agent(
    {"name": "research-agent", "model": {"primary": primary}, "labels": {"app": "my-app"}},
    idempotency_key="provision-research-agent-1",
)
agent_id = created["agent_id"]
print(agent_id, created.get("config_version"))
await client.start_agent(created["agent_id"])
await client.wait_until_running(created["agent_id"])
```

```bash [curl]
models=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
MODEL=$(jq -er '(if type == "array" then . else .models end) | [.[] | select(.model == "litellm/gpt-5.6-terra" and .selectable != false)][0].model' <<<"$models")
agent=$(jq -n --arg model "$MODEL" \
  '{resource:{name:"research-agent",model:{primary:$model},labels:{app:"my-app"}}}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Idempotency-Key: provision-research-agent-1' \
    -H 'Content-Type: application/json' --data-binary @-)
AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

新创建的 Agent 是停止状态。创建 Session 前，调用 `startAgent()`，再等待
`status.desired_state === 'running'`。`waitUntilRunning()` 会执行这个就绪检查。
Onboarding interview 会被跳过，第一条消息直接开始任务。

`Idempotency-Key` 的作用域是 `agent.create + key`：相同 key 和 body 返回第一次响应；
同一个 key 配不同 body 返回 `409`。见[错误处理](../reference/errors.md)。

接下来，对 `created.agent_id` [创建 Session](./sessions.md)。

模型目录字段、选择方法和生命周期见 [Models](../reference/models.md)。

整个 `model` 段都可以省略。省略时，创建操作会把当时的平台默认值写入 Agent。默认值可能随部署环境和时间变化。需要可重复部署时，请先调用 `listModels()`，再持久化一个明确选择。

Persona 文档、Skills、工具和沙箱配置见 [resource 字段](#resource-的字段)。

## 读取 agent

`getAgent()` 在 `declared` 中返回当前配置，在 `status` 中返回生命周期状态：

::: code-group

```ts [TypeScript]
const agent = await zc.getAgent(created.agent_id)
console.log(agent.declared?.name, agent.status?.desired_state)
```

```python [Python]
agent = await client.get_agent(created["agent_id"])
print(agent.get("declared", {}).get("name"), agent.get("status", {}).get("desired_state"))
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

不存在、已软删除或属于其他租户的 Agent id 返回 `404 not_found`。
创建回执的结构不同；见[响应结构](#读取-agent-以及两种响应结构)。

## 修改 agent

`updateAgent(agentId, sections)` 对你点名的 declared 小节发 PUT。它返回读取投影。

**你没写进 body 的小节会被保留。** 顶层的对象小节只合并一层；小节内部的数组和标量整个替换掉旧值。

::: code-group

```ts [TypeScript]
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

```python [Python]
updated = await client.update_agent(agent["agent_id"], {"labels": {"tier": "paid"}})
print(updated.get("declared", {}).get("labels"))
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "labels": {
    "tier": "paid"
  }
}
JSON
```

:::

`declared` 比你发出去的宽。`imageModel`、`imageGenerationModel` 和 `pdfModel` 是服务端默认值，每次读都会出现在里面；它们不是 `AgentResource` 的成员，发送它们是类型错误。

`name`、`model` 和 `persona` 因为没有传入而保持不变。普通对象小节做一层浅合并，所以未指定的 label 键保留。这不是递归深合并：显式传入的 `persona.docs` 数组会替换旧数组。

### `tool_policy` 和 `system_prompt` 是整体替换

有两个小节是合并规则的例外：每一次点名 `tool_policy` 或 `system_prompt` 的 PUT 都会替换掉整个对象。见[工具](./tools.md)。

所以这两个都没有局部写入。要往策略里加东西，先从 `declared` 里把当前这份读出来，自己算好并集再发。

### 配置写入会增加版本号

配置写入会增加 `config_version`，即使内容与当前值相同。仅修改 `visibility` 或 `project_id` 时不增加配置版本。空 PUT 仍会重新渲染并增加版本。

```ts
const configVersion = (a: AgentRecord): number | undefined =>
  a.status?.config_version ?? a.config_version

const before = configVersion(await zc.getAgent(agentId))          // 4
await zc.updateAgent(agentId, { labels: { probe: 'x' } })
const first = configVersion(await zc.getAgent(agentId))           // 5
await zc.updateAgent(agentId, { labels: { probe: 'x' } })         // identical body
const second = configVersion(await zc.getAgent(agentId))          // 6 - bumped anyway
```

配置没有变化时，避免每个 turn 都执行 PUT。`config_version` 是单调计数器，
不是你自己那次写入的回执：第一次读取就可能已经高于创建回执中的版本。
下一个 turn 读取新版本；进行中的 turn 保持旧版本。见[错误处理](../reference/errors.md)。

### PUT 会拒绝什么

PUT body 里的 `skills`、`credentials`，以及任何未知字段，都返回 `400`。skill 走它自己的路由管理 —— 见 [Skills](./skills.md)。

### 管理配置变更

`config_version` 会在配置更新后递增；仅修改 ownership 时不递增，但它不是配置历史 API。需要比较或回滚时，
请在自己的应用中保存上一份配置。

production 的 Agent 更新当前拒绝 `expected_config_version`，返回 `400 invalid_declared_key`。普通更新应省略该字段，仍采用后写覆盖先写的行为。应用应串行处理竞争写入；先 GET 再 PUT 不构成原子检查。响应不确定时，先读回 `declared` 再决定是否重试。

这一限制不影响 `upgradeSystemPrompt()`：它独立的版本前置条件已受支持。

## Agent 生命周期

### 启动 agent

`startAgent()` 把 `desired_state` 设为 `running`；`stopAgent()` 把它设为 `stopped`。
Session 调用要求 desired state 为 running。

| 字段 | 含义 | 取值 |
|---|---|---|
| `desired_state` | 生命周期意图与 API 就绪状态。 | `running`、`stopped`、`deleted` |
| `actual_state` | 尽力而为的聊天渠道健康状态。 | `activating`、`active`、`degraded`、`error`、`stopped`、`deleting` |

用 `waitUntilRunning()` 轮询 `desired_state`，不要等待 `actual_state`。
默认预算为 30 秒，每次轮询间隔 500 ms。超时和取消选项见
[SDK reference](../reference/typescript-sdk.md#startagent-agentid)。

成功的 start/stop 调用返回 `{ warnings: string[] }`。结合上下文检查 warnings；
非 2xx 响应抛出 `ZooworkError`。失败的 stop 可能已经改变 `desired_state`，
重试前应重新读取。仅凭这个状态不能证明资源已经清理。

### 停止与删除

::: code-group

```ts [TypeScript]
const { warnings } = await zc.stopAgent(agentId)
// HTTP 失败会抛错；先读回结果，再决定是否重试。
```

```python [Python]
result = await client.stop_agent(agent_id)
print(result["warnings"])
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

停止之后，对这个 agent 调 `createSession()` 会重新返回 `409 agent_not_running`。

`deleteAgent()` 是**软删除** 。它把 agent 运行时标记为已删除，返回 `204`。它不停止 agent，不取消正在跑的 workflow，不删除定时任务，也不释放沙箱。不先停就删，会留下一批仍在运行、而你再也寻址不到的资源。

::: code-group

```ts [TypeScript]
await zc.stopAgent(agentId)   // do this first
await zc.deleteAgent(agentId) // then this
```

```python [Python]
await client.stop_agent(agent_id)
await client.delete_agent(agent_id)
```

```bash [curl]
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/stop" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" &&
curl -sS --fail-with-body --request DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

首次成功删除返回 `204`。通过公共 API 重复删除返回 `404 service_api.not_found`；删除后 `getAgent()` 也返回 404。资源不在当前 key 的范围内同样可能返回 404。恢复自己发起的删除时，保留原 Agent ID 和 key scope，不能将任意 404 当成删除证明。见[重试说明](../reference/errors.md#what-is-safe-to-retry)。

## agent 上的 skill

三个方法，完整说明见 [Skills](./skills.md)。

::: code-group

```ts [TypeScript]
const skills = await zc.listAgentSkills(agentId)                 // attached skills, resolved and merged
await zc.putAgentSkill(agentId, 'skl_visible', { enabled: true }) // configure a visible Skill
await zc.deleteAgentSkill(agentId, 'skl_visible')                 // detach it
```

```python [Python]
skills = await client.list_agent_skills(agent_id)
await client.put_agent_skill(agent_id, "skl_visible", enabled=True)
await client.delete_agent_skill(agent_id, "skl_visible")
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
SKILL_ID='skl_visible'
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' -d '{"enabled":true}'
curl -sS --fail-with-body --request DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Global Skills 默认可用。你可以配置当前 key 可见的 Skill assignment，见 [Skills](./skills.md)。

## 列出你的 agent

`listAgents({ labels, page })` 列出 key 范围内的 Agents。用 labels 查找为某个应用或 workspace
创建的 Agents。

::: code-group

```ts [TypeScript]
for await (const agent of zc.listAgents({ labels: { workspace_id: 'wsp_example' } })) {
  console.log(agent.agent_id)
}
```

```python [Python]
async for agent in await client.list_agents(labels={"workspace_id": "wsp_example"}):
    print(agent["agent_id"])
```

```bash [curl]
page=1
while true; do
  result=$(curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/agents" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    --data-urlencode 'label.workspace_id=wsp_example' \
    --data-urlencode "page=$page") || break
  jq -r '.agents[].agent_id' <<<"$result"
  next_page=$(jq -r 'if .page * .page_size < .total then .page + 1 else empty end' <<<"$result")
  [ -n "$next_page" ] || break
  page=$next_page
done
```

:::

API key 将读取和列表范围限定为 key owner 与 Project。
知道 id 不会扩大 key 范围。应自己保存 Agent ids，key 范围见[鉴权](../get-started/authentication.md)。

API 页码从 1 开始，每页 100 条。分页不提供快照保证：并发新增或删除可能让记录在页面之间移动。
分页对象、续读和旧数组调用的迁移见
[SDK 分页参考](../reference/typescript-sdk.md#listagentsopts)。

## `resource` 的字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 必填，不能为空。 |
| `model.primary` | string | `provider/model-id` 形式的模型别名，例如 `litellm/gpt-5.6-terra`。只写模型名会被归一成 `litellm/<model-id>`。列表从 `listModels()` 拿。 |
| `model.input` | `string[]` | `text` 和/或 `image`。声明 `image` 表示主模型自己读图。 |
| `model.max_tokens` | integer | 单次模型请求的输出 token 上限。不设走平台默认；非法值创建时报 400。 |
| `userTimezone` | string | IANA timezone 名称，例如 `Asia/Shanghai`。它设置 prompt context 和消息时间戳使用的用户时区；Schedule 的 timezone 是另一项独立配置。 |
| `persona.docs[]` | `{ name, content, seed_policy? }[]` | 指导性文档。只存内联的 `content`。组装提示词时只读这几个规范名：`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`。其他名字会存下来，但永远到不了模型那里。`MEMORY.md` 和 `memory/` 命名空间是保留的，返回 `400 invalid_persona_doc_name`。 |
| `skills` | array | 显式安装的 Skills。传入 `[]` 会让这个 Agent 不再自动挂载 global Skills。 |
| `include_global_skills` | boolean | 默认 `true`。设为 `false` 会关闭自动挂载的 global Skills，但保留显式安装的 Skills。这个设置在后续 update 和 rerender 后仍然保留。 |
| `labels` | `Record<string, string>` | 你自己的键值标签。可以用 `listAgents({ labels })` 过滤。 |
| `tool_policy` | object | `{}` 表示 policy 不额外限制工具；runtime 和配置条件仍然适用。policy 字段支持精确名称、全局 `*` 和一个末尾 `prefix*`；`alsoAllow` 仍然只支持精确名称。见[工具](./tools.md)。 |
| `sandbox.scope` | `'agent' \| 'session'` | 沙箱 runtime 是在 Agent 的 Sessions 之间共享，还是每个 Session 建一个。默认 `agent`。持久化 workspace 仍属于 Agent。见[云沙箱参考](./cloud-sandbox-reference.md)。 |
| `mcp` | array | 远程 MCP Server 声明，包括加载方式、运行时 context 和审批策略。见 [MCP Server](./mcp.md)和[权限策略](./permissions.md)。 |
| `custom_tools` | array | 由你的应用执行的工具；run 等待应用返回结果。见[工具](./tools.md#应用执行的自定义工具)。 |

创建时的 `skills` 会安装 Skills，但创建回执和 `getAgent().declared` 不回显安装关系。
用 `listAgentSkills(agentId)` 确认。`environment_id` 和 `environment_version` 也可用于创建；
解析规则见 [Environments](./environments.md)。

## 读取 agent，以及两种响应结构

`POST /agents` 返回一份扁平的创建回执。`GET` 和 `PUT` 返回一份读取投影。它们不是同一个对象。

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

## 下一步

- [Sessions](./sessions.md) —— 在一个运行中的 agent 上开 session，驱动一个回合。
- [每用户一个 agent](./per-user-agents.md) —— 用户之间不能共享沙箱文件和记忆时的多用户形态。
- [事件与流式](./events.md) —— 用可续传的 SSE 读 agent 在做什么。
- [Skills](./skills.md) —— 默认挂了什么，你能改什么。
- [错误处理](../reference/errors.md) —— 值得拿来做分支判断的 `ZooworkError.type` 取值。
