---
title: 每用户一个 Agent
description: 为每个应用用户提供独立的 Agent workspace，并通过后端授权访问。
source: /en/build/per-user-agents
source_hash: 74725ac72fc72ccebff2a99265142e9c46c744c8da2eb681d6639d5b4bcec8fa
---

# 每用户一个 Agent

应用用户之间需要隔离持久化文件时，为每个用户创建独立的 Agent。
后端保存用户到 Agent 的映射，校验每次请求的访问权限，再对该用户的 Agent 创建 Sessions。

共享指令、模型选择和 tool policy 放在应用自有的配置模板中，
每个用户的 Agent 使用自己的一份副本。

## Workspace 隔离 {#workspace-isolation}

Session 隔离对话历史，不会切分 Agent 的持久化文件：

- `/workspace` 属于 Agent。同一个 Agent 的所有 Sessions 共享这些文件，
  包括 `sandbox.scope` 为 `session` 的情况。独立的 Session sandbox
  不会为每个终端用户创建私有 workspace。
- API 消息可以通过 `actor: { ref: 'customer-42' }` 选择记忆归属，省略时归属 owner。
  Actor 不会授予访问权限、清空已有 transcript 或隔离文件。
  见[事件](./events.md#user-message)和 [Memory](./memory.md)。

一个 Agent 内没有按用户切分的 workspace。
用户不能共享持久化文件时，使用独立 Agents，并在后端检查每次 Agent 和 Session 访问权限。

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
可能有并发请求执行这段代码时，按用户串行创建。
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
Platform API key 可以查看已挂载的 Skills，并管理已有可见 Skill 的安装关系，
但不能上传 Skill 或发布 registry 版本。
产品指令使用共享配置模板。安装和可见性规则见 [Skills](./skills.md)。

## 相关 {#related}

- [Skills](./skills.md)：默认 global Skills 和已有安装关系。
- [Agents](./agents.md)：配置版本、启动/停止和 desired state。
- [Sessions](./sessions.md)：在同一个 Agent 内管理独立对话。
- [文件与产物](./files.md)：持久化和文件隔离。
