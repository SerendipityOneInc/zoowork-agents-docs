---
lang: zh-CN
description: 创建 Session、选择 Agent 配置、发送首条消息并继续对话。
source: /en/build/sessions
source_hash: ff47448f86e448ab753355ecc22422fa07611c80b7d65a89d05c2f45f979a452
---

# 创建 Session

Session 是属于一个 Agent 的持久对话。先创建 Session，再发送 `user.message` 开始工作；也可以用 `initial_events` 合并这两步。对话历史保存在服务端，后续消息无需重发历史。

Session 属于 Agent。应用应在自己的 conversation ID 旁保存 `agent_id` 和 `session_id`，每个 Session 调用都使用这两个 ID。Session 分开保存对话历史，但同一个 Agent 的 Session 默认共享 workspace。需要分开用户文件时，见 [每用户一个 Agent](./per-user-agents.md)。

## 前置条件 {#prerequisites}

使用后端 [API key](../get-started/authentication.md) 和已有 Agent。新建 Agent 处于 stopped 状态，创建 Session 前先 start，否则返回 `409 agent_not_running`。API readiness 使用 `status.desired_state`，不要用渠道连接状态判断。见 [Agent 生命周期](./agents.md)。

SDK 示例使用[认证](../get-started/authentication.md)中配置的 `client`。Agent ID 在 TypeScript 中记为 `agentId`，Python 中记为 `agent_id`，curl 中使用 `AGENT_ID`。Python 的 `await` 示例在 async 函数内运行。先启动 Agent：

::: code-group

```ts [TypeScript]
await client.startAgent(agentId)
```

```python [Python]
await client.start_agent(agent_id)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

默认 Cloud sandbox 按需管理。本例无需创建 Environment；自定义依赖在 [Agent 的 Environment](./environments.md) 中配置。

## 创建 Session {#create-a-session}

::: code-group

```ts [TypeScript]
const session = await client.createSession(agentId, {
  metadata: { source: 'my-app', conversation_id: 'conversation-42' },
})
const sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id, {
    "metadata": {"source": "my-app", "conversation_id": "conversation-42"},
})
session_id = session["session_id"]
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"metadata":{"source":"my-app","conversation_id":"conversation-42"}}'
```

:::

curl 后续请求使用创建响应中的 `session_id`，将它保存为 `SESSION_ID`。

空 Session 等待输入。`session_id` 是 opaque ID；`api:` 属于 `session_key`，不属于 ID。没有顶层 `/sessions` collection：HTTP 创建路径是相对于 `/service/v1` base 的 `POST /agents/{agent_id}/sessions`。

`metadata` 是应用自己的 JSON object。在创建时填写它用于关联；它不选择用户身份，也不提供访问控制。只能在创建时写入的限制见 [Session 操作](./session-operations.md#store-session-metadata)。

### Idempotency-Key

TypeScript 的 `createSession` 可选第三个参数，或 Python `create_session` 的 `idempotency_key` keyword argument，作为 `Idempotency-Key` header。创建响应丢失时，使用同一个 key 恢复同一个 Session。后续输入事件分别使用稳定的 `idempotency_key`。见 [错误与重试](../reference/errors.md)。

### 选择配置快照 {#choose-a-configuration-snapshot}

省略 `runtime_mode` 时，后续 turn 解析当前 active Agent 配置。要在创建时固定当前 active 配置，通过 SDK 或 HTTP 显式设置 `runtime_mode: "active"`：

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"runtime_mode":"active","metadata":{"source":"my-app"}}'
```

| 创建请求 | 配置选择 |
|---|---|
| 省略 `runtime_mode` | 后续 turn 解析当前 active Agent 配置。 |
| 显式设置 `runtime_mode: "active"` | 在创建时固定当前 active 配置。 |

两种方式都不接受调用方传入 `config_version`。其他 runtime mode 有不同选择规则。这是在选择已保存的配置，不提供 Session-local `model`、`system`、`tools`、`mcp_servers`、`skills` 或 Environment override。这些设置通过 [Agent 配置](./agents.md) 修改。

### 带上首条消息 {#include-the-first-message}

首条消息已准备好时，用 `initial_events` 替代上面的空 Session 创建请求：

::: code-group

```ts [TypeScript]
const seeded = await client.createSession(agentId, {
  initial_events: [{ type: 'user.message', content: 'My display name is Ada.' }],
})
```

```python [Python]
seeded = await client.create_session(agent_id, {
    "initial_events": [{"type": "user.message", "content": "My display name is Ada."}],
})
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{"type":"user.message","content":"My display name is Ada."}]}'
```

:::

选择这种方式时，后续调用使用这次响应的 Session ID。这里只接受 `user.message`，最多 50 条事件；`content` 必须是非空字符串。interrupt 和工具回复在 Session 创建后发送。actor 规则见 [Message 输入](./events.md#user-message)。

## 发送工作并读取响应 {#send-work-and-read-the-response}

对上面创建的空 Session 发送首条消息：

::: code-group

```ts [TypeScript]
await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'My display name is Ada.', idempotency_key: 'conversation-42-turn-1' },
])
```

```python [Python]
await client.post_events(agent_id, session_id, [{
    "type": "user.message", "content": "My display name is Ada.",
    "idempotency_key": "conversation-42-turn-1",
}])
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.message","content":"My display name is Ada.","idempotency_key":"conversation-42-turn-1"}]}'
```

:::

202 receipt 确认排队，不代表执行完成。读取已保存事件或连接 stream 观察响应。下面的 helper 读取一个普通 turn：

::: code-group

```ts [TypeScript]
import { assistantText, isRunFinished, runOutcome } from '@zoowork-ai/sdk'

async function readTurn(sessionId: string, cursor?: string) {
  let text = ''
  let outcome: string | undefined
  for await (const ev of client.streamEvents(agentId, sessionId, cursor ? { cursor } : {})) {
    cursor = ev.cursor ?? cursor
    text += assistantText(ev)
    if (isRunFinished(ev)) {
      outcome = runOutcome(ev)
      break
    }
  }
  return { text, cursor, outcome }
}

const first = await readTurn(sessionId)
console.log(first.outcome, first.text)
```

```python [Python]
from contextlib import aclosing
from zoowork import assistant_text, is_run_finished, run_outcome

async def read_turn(session_id: str, cursor: str | None = None):
    text = ""
    outcome = None
    async with aclosing(client.stream_events(agent_id, session_id, cursor=cursor)) as stream:
        async for event in stream:
            cursor = event.cursor or cursor
            text += assistant_text(event)
            if is_run_finished(event):
                outcome = run_outcome(event)
                break
    return {"text": text, "cursor": cursor, "outcome": outcome}

first = await read_turn(session_id)
print(first["outcome"], first["text"])
```

```bash [curl]
curl -N "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream'
```

:::

SDK reader 在一个 `run.finished` 后退出；curl 输出原始 SSE frame，会一直读取直到你停止它。保存最后一个 SSE `id:` 值用于续传。`run.finished` 结束一个 turn，Session 和 stream 可以继续存在。等待异步工作的 yielded turn 也可能成功结束。把它当作任务完成前，先阅读 [结束状态与 yielded turn](./events.md#turn-outcomes)。

## 继续对话 {#multi-turn}

向同一个 Session 发送下一条消息，从最后处理的事件 cursor 继续读取：

::: code-group

```ts [TypeScript]
await client.postEvents(agentId, sessionId, [
  { type: 'user.message', content: 'What is my display name?', idempotency_key: 'conversation-42-turn-2' },
])
const second = await readTurn(sessionId, first.cursor)
console.log(second.text) // mentions Ada
```

```python [Python]
await client.post_events(agent_id, session_id, [{
    "type": "user.message", "content": "What is my display name?",
    "idempotency_key": "conversation-42-turn-2",
}])
second = await read_turn(session_id, first["cursor"])
print(second["text"])
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"user.message","content":"What is my display name?","idempotency_key":"conversation-42-turn-2"}]}'

curl -N -G "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream' \
  --data-urlencode "cursor=$EVENT_CURSOR"
```

:::

curl 中的 `EVENT_CURSOR` 是第一回合最后处理的 SSE `id:` 值。成功处理后保存 cursor，将它作为 opaque token。timeout、重连、interrupt 和工具响应见 [事件与流式响应](./events.md)。读取状态和历史、列出、归档或删除见 [Session 操作](./session-operations.md)。

## SDK 调用

以下示例要求安装包含该方法的 SDK release。先检查已安装的 exports；缺少方法时使用本页 HTTP 示例。

::: code-group

```ts [TypeScript]
const session = await zc.createSession(agentId, { runtime_mode: 'active', idle_compaction: false })
```

```python [Python]
session = await client.create_session(agent_id, {"runtime_mode": "active", "idle_compaction": False})
```

:::

显式 active 模式在创建时固定当前配置；省略该字段时后续 turn 解析 active 配置。`idle_compaction` 可为 true、false 或 null；省略时保留服务端默认值。
