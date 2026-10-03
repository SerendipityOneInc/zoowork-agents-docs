---
title: Agent Memory
description: 让已启用 Memory 的 Agent 跨 session 保存和查找长期事实，并理解 Agent 与 actor 的作用域。
source: /en/build/memory
source_hash: e8fdf0487f9068024451be53ea2b9081d850f6582195df4a31f9bd9c61024ea0
---

# Agent Memory

Memory 工具让已启用这项能力的 Agent 保存长期事实，并在后续 session 中查找。它适合偏好、项目约定和需要在当前对话之外保留的经验。Agent 通过工具搜索 Memory；新建 session 不会自动把所有已保存事实载入 prompt。

Memory 需要服务支持，并在工具策略中允许相应工具。

## 保存偏好并在之后查找 {#save-a-preference-and-retrieve-it-later}

示例复用[快速开始](../get-started/quickstart.md)中的 SDK client 和运行中 Agent。curl 使用[鉴权](../get-started/authentication.md)中设置的环境变量。

使用[快速开始](../get-started/quickstart.md)中的运行中 Agent，并确认其 Memory 工具可用。在后端使用 Bash、curl 7.76+ 和 jq 1.6+ 运行示例：

```bash
export AGENT_ID='your-existing-agent-id'
```

key 必须有权访问 Agent，包括适用时的 project scope，见[鉴权](../get-started/authentication.md)。这些例子省略 `actor`，使用 Agent owner 私有的 `user_agent` Memory。

### 1. 让 Agent 保存事实 {#1-ask-the-agent-to-save-a-fact}

::: code-group

```ts [TypeScript]
let session = await client.createSession(agentId, {
  "initial_events": [
    {
      "type": "user.message",
      "content": "I prefer CSV reports with ISO 8601 dates. Save this preference in user_agent memory with memory_create."
    }
  ]
})
let sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id,
    {
        "initial_events": [
            {
                "type": "user.message",
                "content": "I prefer CSV reports with ISO 8601 dates. Save this preference in user_agent memory with memory_create."
            }
        ]
    },
)
session_id = session["session_id"]
```

```bash [curl]
session=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{
    "type":"user.message",
    "content":"I prefer CSV reports with ISO 8601 dates. Save this preference in user_agent memory with memory_create."
  }]}')
SESSION_ID=$(jq -er '.session_id' <<<"$session")
```

:::

读取 event stream，检查 Memory tool result：

::: code-group

```ts [TypeScript]
import { isRunFinished } from '@zoowork-ai/sdk'

for await (const event of client.streamEvents(agentId, sessionId)) {
  console.log(event)
  if (isRunFinished(event)) break
}
```

```python [Python]
from zoowork import is_run_finished

async for event in client.stream_events(agent_id, session_id):
    print(event)
    if is_run_finished(event):
        break
```

```bash [curl]
curl -N -sS --fail-with-body \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream'
```

:::

等待 `run.finished`，检查 `payload.status`，然后按 Ctrl+C。只有成功的消息或 assistant reply，不能证明事实已经保存。应确认 `memory_create` result；工具不可用时，这个请求无法建立持久 Memory。

### 2. 从新 Session 中询问 {#2-ask-from-a-new-session}

在同一个 Agent 下创建新 Session，再次省略 `actor`，使用 owner 的 Memory：

::: code-group

```ts [TypeScript]
session = await client.createSession(agentId, {
  "initial_events": [
    {
      "type": "user.message",
      "content": "Use memory_search on my user_agent memory to find my report format preferences, then describe the format you would use."
    }
  ]
})
sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id,
    {
        "initial_events": [
            {
                "type": "user.message",
                "content": "Use memory_search on my user_agent memory to find my report format preferences, then describe the format you would use."
            }
        ]
    },
)
session_id = session["session_id"]
```

```bash [curl]
session=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{
    "type":"user.message",
    "content":"Use memory_search on my user_agent memory to find my report format preferences, then describe the format you would use."
  }]}')
SESSION_ID=$(jq -er '.session_id' <<<"$session")
```

:::

用上面的命令读取这个 session 的 event stream。找到 `memory_search` 和结果后，才能把回复视作 recalled Memory。prompt 请求模型搜索，不是确定性的管理调用。两次 Session 的消息都没有提供 `actor`，所以使用 owner 的 Memory。

## 选择 Memory scope {#choose-a-memory-scope}

| Scope | 保存内容 | 谁能写入 |
|---|---|---|
| `agent` | 可以供这个 Agent 的所有用户共享的事实。 | owner 的 direct turns 和获授权的 system activity。其他 actor 不能编辑这个共享 scope。 |
| `user_agent` | 当前 actor 与这个 Agent 交互时的个人事实。 | 受支持 direct conversation 中的当前 actor。 |

direct turn 可以搜索 agent scope 和自身 actor 的 scope。group turns 可以搜索共享 Agent Memory，但不能写入它，也不能使用其他用户的 Memory。没有可用 actor identity 时，user-scoped Memory 操作会被拒绝。

同一个 Agent 服务多个应用用户时，API session 应发送稳定的 `actor: { ref }`。后端必须把已认证的用户映射到这个 ref。省略 `actor` 时使用 Agent owner。`metadata.user_id` 不会选择 actor。ref 格式见 [Events](./events.md#user-message)。


例如，后端可以为已认证的应用用户发送这个 event：

```json
{"type":"user.message","content":"Use memory_search to find my report preferences.","actor":{"ref":"customer-42"}}
```

该用户后续的消息和 Session 使用同一个 ref。不同 ref 选择不同的 `user_agent` scope，不能通过它读取 `customer-42` 的私有 Memory。不要信任未认证客户端直接提交的 ref。

::: warning Attribution 不是授权
`actor.ref` 选择 Memory attribution，不授权 Agent/session 访问，不清除已有 transcript，也不隔离 `/workspace`。应用必须授权每个请求。用户不能共享文件时，使用[不同的 Agent](./per-user-agents.md)。
:::

## Memory tool contract {#memory-tool-contract}

这些工具在 Agent loop 内执行。下面的参数是 tool inputs，不是 HTTP request body 或 SDK 方法调用。

| 工具 | 参数 |
|---|---|
| `memory_create` | `content: string`，`scope: 'agent' \| 'user_agent'`。 |
| `memory_search` | `query: string`，可选 `scope: 'all' \| 'agent' \| 'user_agent'`，可选正整数 `maxResults`。 |
| `memory_update` | `memoryId: string`，正整数 `expectedVersion`，`content: string`。 |
| `memory_delete` | `memoryId: string`，正整数 `expectedVersion`。 |

create input 的例子：

```json
{"content":"Prefer CSV reports with ISO 8601 dates.","scope":"user_agent"}
```

Memory content 上限为 4,096 字符和 16 KiB UTF-8 数据。search 默认返回 8 条，最多 20 条。search 可按 turn identity 和 conversation type 缩小请求的 scope；`all` 不会授予其他 actor 私有 Memory 的访问权限。

update 和 delete 使用当前 record 的 version。写入时 version 已变化，可能得到 `MEMORY_VERSION_CONFLICT`；重试前重新搜索并使用当前结果。content 已经相同的 update 可以直接返回 saved result，不产生新写入。使用 Memory 工具返回的 ID 和当前 version。这些工具由 Agent 调用；公共 SDK 不提供 `memoryCreate()` 等对应方法。

## 能力边界 {#capability-boundaries}

这些是 Agent 管理的工具，不是公共 memory-store、mount 或 SDK CRUD endpoints。见[当前 API 边界](../reference/not-supported.md)。

Session transcript、工作区文件和 [Agent Database](./data-storage.md) 与 Memory 分开。创建或删除 Session 不是 Memory 管理操作，`actor.ref` 也不会创建私有文件或数据库存储。

## Memory 与 Context compaction {#memory-and-context-compaction}

Memory 可用且允许写入时，runtime 可以在压缩对话 context 前保留有用的事实。它使用同一组 Memory 工具保存事实和经验、解决矛盾并避免重复。这不保证每句话都会保存，也不保证每一轮都会搜索 Memory。
