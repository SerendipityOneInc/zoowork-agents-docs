---
description: 将应用管理的 agent loop 迁移到 Managed Agents，同时保留业务工具与用户权限检查。
source: /en/get-started/migration
source_hash: a1e8525198e59e777cb660c4d980e04ecc234a19fd2ab41f1704e04baf2bd982
---

# 将 agent loop 迁移到 Managed Agents

如果应用反复调用模型、执行它返回的 tool calls，再把结果发回模型，就在自行管理 agent loop。
Managed Agents 可以运行这个循环。应用仍负责用户认证、业务数据访问和结果展示。

## 对应职责

| 职责 | 应用管理 loop 时 | 使用 Managed Agents 后 |
|---|---|---|
| 指令、模型和工具定义 | 放在模型请求中 | 配置可复用的 Agent |
| 模型调用和内置工具执行 | 应用运行循环和工具 executor | ZooWork 执行模型和工具 |
| 对话历史 | 应用在每次模型请求中提供 | Session 保存历史供后续 turn 使用 |
| 任务进度和工具记录 | 应用自行记录 | 读取持久化 Session events 或流式响应 |
| 业务工具和数据权限 | 后端执行操作并检查权限 | 后端继续处理应用执行的 custom tools |
| 用户身份和对话访问 | 应用检查访问权限 | 应用继续维护用户与 Agent、Session 的关系并检查权限 |

## 用任务请求替换循环

以生成销售报告为例。迁移前，应用反复调用模型、执行文件工具，再保存对话历史。
下面是伪代码，函数代表应用已有的实现：

```text
history = load_conversation(conversation_id)
history.append(user_message("Write a sales report to report.md"))
while true:
    response = call_model(history, tools=[write_file, read_file])
    history.append(response)
    if response.has_no_tool_calls:
        break
    for call in response.tool_calls:
        result = execute_tool(call)
        history.append(tool_result(call.id, result))
save_conversation(conversation_id, history)
```

迁移后，创建并启动一个 Agent，再通过 Session 发送任务。Runtime 执行配置中的文件工具。
运行下面的 TypeScript 示例前，先设置 [API key](./authentication.md)：

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const client = createZooworkClient()
const agent = await client.createAgent({
  resource: {
    name: 'report-agent',
    persona: { docs: [{
      name: 'AGENTS.md',
      content: 'Create reports using workspace file tools.',
    }] },
  },
})
await client.startAgent(agent.agent_id)
await client.waitUntilRunning(agent.agent_id)

const session = await client.createSession(agent.agent_id, {
  initial_events: [{
    type: 'user.message',
    content: 'Write report.md for January sales: 12 units at $10 each. Check the total.',
  }],
})
```

```python [Python]
from zoowork import create_zoowork_client

async with create_zoowork_client() as client:
    agent = await client.create_agent({
        "name": "report-agent",
        "persona": {"docs": [{
            "name": "AGENTS.md",
            "content": "Create reports using workspace file tools.",
        }]},
    })
    await client.start_agent(agent["agent_id"])
    await client.wait_until_running(agent["agent_id"])
    session = await client.create_session(agent["agent_id"], {
        "initial_events": [{
            "type": "user.message",
            "content": "Write report.md for January sales: 12 units at $10 each. Check the total.",
        }],
    })
```

```bash [curl]
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"resource":{"name":"report-agent","persona":{"docs":[{"name":"AGENTS.md","content":"Create reports using workspace file tools."}]}}}')
AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" &&
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{"type":"user.message","content":"Write report.md for January sales: 12 units at $10 each. Check the total."}]}'
```

:::

把 `agent.agent_id`、`session.session_id` 与应用的 conversation ID 一起保存。
[事件与流式响应](../build/events.md)说明如何展示进度并判断任务是否结束。
完整的 stream reader、结果检查和清理步骤见[快速开始](./quickstart.md)。

## 业务工具继续由后端执行

检索私有文档或更新业务数据时，声明[应用执行的 custom tool](../build/tools.md)。
ZooWork 创建 pending call；后端检查参数和用户权限、执行操作，再提交结果。
声明工具不会授予数据库访问权限。

有副作用的操作需要保持幂等。重新连接 stream 或 replay events 时可能再次读到同一个 call；
这不保证业务操作只执行一次。

## 保留对话与 workspace 的边界

新对话创建新 Session，后续消息发到同一个 Session。不同 Sessions 的对话历史分别保存，
但一个 Agent 的 Sessions 共享 workspace，sandbox scope 为 `session` 时也一样。
用户需要独立的文件 workspace 时，使用[每用户一个 Agent](../build/per-user-agents.md)。

成功处理每条事件后保存 cursor，断开连接后才能从那里继续读取。关闭 reader 不会取消执行。
不要仅根据 `run.finished` 判断任务完成，还需要检查 termination 和 lineage。

## 先迁移一个流程

选择一个任务，验证输入、工具结果、输出和清理。任务跑通后，再按需添加
[Webhooks](../build/webhooks.md) 通知或 [Schedules](../build/schedules.md) 定时执行。
公共能力及其使用条件见[可用性与限制](../reference/capabilities.md)。
