---
title: 每用户一个 Agent
description: 用隔离的 Session 或每用户独立的 Agent 分隔应用用户，并通过后端授权访问。
source: /en/build/per-user-agents
source_hash: 1960a2e6d6251540d07da5d344ef74a8d944c26e894feadf6b1e2761180a5d1f
---

# 每用户一个 Agent

多个用户使用同一个产品时，先选择如何分隔他们的数据。使用 `isolation: "session"` 创建的 Session，在共享的 Agent 内拥有自己的 workspace 和 Memory。每用户一个独立 Agent，还会分隔 Agent Database、persona 文档、Schedules，以及需要在该用户多次对话之间保留的文件。无论哪种方式，后端都要保存用户到 Agent 和 Session 的映射，并校验每次请求的访问权限。

共享指令、模型选择和 tool policy 放在应用自有的配置模板中，
每个用户的 Agent 使用自己的一份副本。

## Workspace 隔离 {#workspace-isolation}

Session 的 `isolation` 在创建时选定，之后不会改变。不带 Vault 字段时，省略记录为 `shared`。带 [Vault](./vault.md) 字段时，省略的 `isolation` 目前记录为 `session`；这种情况下请显式传入。

`shared` 的 Session 只分隔对话历史。同一个 Agent 的所有 `shared` Sessions 使用该 Agent 的 `/workspace`，包括 `sandbox.scope` 为 `session` 的情况，也使用该 Agent `agent` scope 的 Memory。API 消息可以通过 `actor: { ref: 'customer-42' }` 选择记忆归属，省略时归属 owner。Actor 不会授予访问权限、清空已有 transcript 或隔离文件。见[事件](./events.md#user-message)和 [Memory](./memory.md)。

### Session 隔离 {#session-isolation}

创建 Session 时传入 `isolation: "session"`：

::: code-group

```ts [TypeScript]
const session = await client.createSession(agentId, {
  isolation: 'session',
  initial_events: [{ type: 'user.message', content: 'Summarize my notes.' }],
})
```

```python [Python]
session = await client.create_session(agent_id, {
    "isolation": "session",
    "initial_events": [{"type": "user.message", "content": "Summarize my notes."}],
})
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"isolation":"session","initial_events":[{"type":"user.message","content":"Summarize my notes."}]}'
```

:::

TypeScript 的 `isolation` 输入类型需要 SDK 0.15.0 或更高版本。

隔离的 Session 拥有：

- 自己的 sandbox 和自己的 `/workspace` 目录。该 Agent 的其他 Sessions 和 Agent workspace 都看不到它的文件；
- 自己的 Memory。Memory 工具只读写该 Session 的记忆；它们不能读写 Agent 的 `agent` scope 或任何 actor 的记忆，`actor.ref` 也不会改变这一点；
- 自己的大结果文件和 Artifact。它发布的 Artifact 不会出现在 Agent 级 `listArtifacts` 的返回中；它们列在 `/agents/{agent_id}/sessions/{session_id}/artifacts` 下，并随 Session 一起移除；
- 它通过 `sessions_spawn` 派生的 Session 共享它的 workspace 和 Memory。派生其他 Agent 的 Session 会被拒绝。

删除隔离的 Session 会同时删除它派生出的 Sessions：这些 Session 正在进行的工作会被取消，之后读取它们返回 `404`。被删除 Session 的 workspace 目录和 Memory 会在保留期后被移除。

Session 隔离不会分隔：

- Agent 的配置、persona 文档、Skills 和 Schedules。隔离的 Session 可以读取 persona 文档但不能修改，也不会运行 onboarding：正在等待 onboarding 的 Agent 会一直等待，直到某个 `shared` Session 完成它；
- [Agent Database](./data-storage.md)，该 Agent 的每个 Session 都可以使用；
- 用 `uploadFile` 或 `exec` 添加的文件。两者都写入 Agent workspace，而隔离的 Session 不挂载它。较小的输入请直接放进消息文本；
- Agent owner 的 credential；见 [Owner credential 不被隔离](./vault.md#owner-credentials)。

每个隔离的 Session 从空的 workspace 和空的 Memory 开始。用户之后的对话看不到他之前 Session 里的文件或事实。

要给隔离的 Session 提供每用户的 MCP Server credential，挂载 [Vault（beta）](./vault.md)。

### 何时使用每用户一个 Agent {#when-to-use-an-agent-per-user}

下列任一项必须归属单个用户时，为每个用户使用独立的 Agent：

- 在该用户多次对话之间保留的文件和 Memory；
- Agent Database 中的行；
- Agent 会更新的 persona 文档、onboarding 或 Schedules；
- Agent owner 连接的账号，或使用这些账号的 Skills。

每次对话都是独立任务、且用户共用同一份 Agent 定义时，适合使用隔离的 Session。两种设计中，都要在后端授权每次 Agent 和 Session 访问。

## 为每个用户创建 Agent {#provision-an-agent-for-each-user}

在 [ZooWork Platform](https://platform.zoowork.ai) 创建 Platform API key，
再按[快速开始](../get-started/quickstart.md)配置 SDK client 或 curl 环境。

示例使用应用中已认证的用户 ID、映射存储和共享的 `STABLE_PERSONA` 指令。
`yourDb` 和 `your_db` 表示你自己的数据库访问层，
它们的方法属于应用代码。Python 调用放在 async function 内。

先读取已有映射。只有该用户还没有映射到 Agent ID 时才创建：

::: code-group

```ts [TypeScript]
const existingAgentId = (await yourDb.users.findById(user.id))?.agent_id
let agentId = existingAgentId

if (!agentId) {
  const agent = await client.createAgent(
    {
      resource: {
        name: `myproduct-${user.id}`,
        labels: { end_user: user.id },
        persona: { docs: [{ name: 'AGENTS.md', content: STABLE_PERSONA }] },
      },
    },
    `user-${user.id}`,
  )
  agentId = agent.agent_id
  await yourDb.users.update(user.id, { agent_id: agentId })
}

await client.startAgent(agentId)
await client.waitUntilRunning(agentId)
```

```python [Python]
existing = await your_db.users.find_by_id(user_id)
agent_id = existing.get("agent_id") if existing else None

if not agent_id:
    agent = await client.create_agent(
        {
            "name": f"myproduct-{user_id}",
            "labels": {"end_user": user_id},
            "persona": {
                "docs": [{"name": "AGENTS.md", "content": STABLE_PERSONA}]
            },
        },
        idempotency_key=f"user-{user_id}",
    )
    agent_id = str(agent["agent_id"])
    await your_db.users.update(user_id, {"agent_id": agent_id})

await client.start_agent(agent_id)
await client.wait_until_running(agent_id)
```

```bash [curl]
# Your backend supplies USER_ID, STABLE_PERSONA, and any EXISTING_AGENT_ID.
AGENT_ID="${EXISTING_AGENT_ID:-}"
if [[ -z "$AGENT_ID" ]]; then
  agent=$(jq -n \
    --arg name "myproduct-$USER_ID" \
    --arg user_id "$USER_ID" \
    --arg persona "$STABLE_PERSONA" \
    '{resource:{
      name:$name,
      onboarding:false,
      labels:{end_user:$user_id},
      persona:{docs:[{name:"AGENTS.md",content:$persona}]}
    }}' |
    curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
      -H "Authorization: Bearer $ZOOWORK_API_KEY" \
      -H 'Content-Type: application/json' \
      -H "Idempotency-Key: user-$USER_ID" \
      --data-binary @-)
  AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
  # Save AGENT_ID in your application's user mapping before continuing.
fi

curl -sS --fail-with-body --request POST \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"

(
  readiness_deadline=$((SECONDS + 30))
  while (( SECONDS < readiness_deadline )); do
    current=$(curl -sS --fail-with-body --max-time 5 \
      "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
      -H "Authorization: Bearer $ZOOWORK_API_KEY") || exit 1
    if jq -e '.status.desired_state == "running"' <<<"$current" >/dev/null; then
      exit 0
    fi
    sleep 1
  done
  echo 'Agent did not reach running before the deadline.' >&2
  exit 1
)
```

:::

curl tab 展示 HTTP 调用，应用仍然需要在调用前后读取和写入用户映射。
每个请求成功后再继续。第一次创建 Session 前，先保存新返回的 Agent ID。

重试创建请求时复用相同的 idempotency key 和 body。
可能有并发请求执行这段代码时，按用户串行创建；同时在整个组织范围内串行调用 `createAgent()`：同一组织内并行创建可能返回 `503 platform.runtime_credentials_unavailable`，且不会创建 Agent。见[错误处理](../reference/errors.md#platform-与-usage-错误)。
以映射为事实来源。已映射的 Agent 被删除或无法访问时，先核对映射，再创建替代 Agent。

`labels.end_user` 可以在 key 的列表范围内辅助恢复，但不提供授权。
新 Agent 是停止状态。先启动并等待 `status.desired_state: 'running'`，
再[创建第一个 Session](./sessions.md)。

## 校验每次 Agent 与 Session 访问 {#authorize-each-agent-and-session-request}

Platform API key 保留在后端。浏览器将任务发送给应用，
由应用读取已认证用户的 Agent ID，并在调用 `createSession`、
`postEvents` 或 `streamEvents` 前检查 Session 归属。

不要在未检查映射的情况下接受任意 Agent 或 Session ID。
Label 和消息 actor 是 metadata，不是授权边界。
Key 的组织、Project 和 owner 范围仍然适用，见[鉴权](../get-started/authentication.md)。

## 更新共享配置模板 {#update-the-shared-configuration-template}

模板变化时，读取每个 Agent 的 declared 配置，比较相关小节，只更新存在差异的内容。
按上面的模板创建 Agent 时，persona 更新如下：

::: code-group

```ts [TypeScript]
await client.updateAgent(agentId, {
  persona: { docs: [{ name: 'AGENTS.md', content: STABLE_PERSONA }] },
})
```

```python [Python]
await client.update_agent(
    agent_id,
    {"persona": {"docs": [{"name": "AGENTS.md", "content": STABLE_PERSONA}]}},
)
```

```bash [curl]
jq -n --arg persona "$STABLE_PERSONA" \
  '{persona:{docs:[{name:"AGENTS.md",content:$persona}]}}' |
  curl -sS --fail-with-body --request PUT \
    "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

:::

`persona.docs` 数组会被替换。Agent 有其他 persona 文档时，应提供完整的预期列表。
省略的小节会保留，但 `tool_policy` 会整体替换。
按 Agent 串行更新，并保留完整 policy。

已经匹配模板的 Agent 不要重复写入：即使内容相同，更新也会增加 `config_version`。
见[修改 Agent](./agents.md#修改-agent)。

### 先灰度，再全量 {#先灰度-再全量}

先把模板修改应用到少量 Agents。
在新的 Sessions 中测试有代表性的任务，将实际行为与预期指令对照。
确认后，再更新其余 Agents，并在映射记录中保存所用模板 revision。

按 turn 的上下文保留在 Session。
用户刚选了什么、处于哪个套餐，应通过 Session 消息提供，
不需要因此重写每个 Agent 的 persona。

## Skills {#skills}

无需发布自己的 Skill，就能使用默认 global Skills。
应用需要打包指令、脚本和资源时，可以上传一次 Skill，再在允许的范围内把同一个 ID 挂载给多个 Agent。
具名 Project key 写入 project Skill；Default Project key 写入组织共享的 org Skill。
这要求服务端支持 Project key registry。Persona 指令继续放在共享配置模板中。
上传、版本固定、部署核验和读写权限见 [Skills](./skills.md)。

## 相关 {#related}

- [Skills](./skills.md)：默认 global Skills 和已有安装关系。
- [Agents](./agents.md)：配置版本、启动/停止和 desired state。
- [Sessions](./sessions.md)：在同一个 Agent 内管理独立对话。
- [文件与产物](./files.md)：持久化和文件隔离。
- [Vault（beta）](./vault.md)：为隔离的 Session 提供每用户 MCP credential。
