---
title: Agent Database
description: 通过 agent_db 工具管理 Agent 自己的结构化数据；production 暂不提供直接查看数据库的接口。
source: /en/build/data-storage
source_hash: 5b00b977777e25038ff664e51a87fece4ae9ff62d51acc8c1254c899c6cc5ae3
---

# Agent Database

Agent Database 为 Agent 提供自己的托管 libSQL 数据库。Agent 在任务中使用 `agent_db` 建表、写入和查询数据。需要读取数据时，让 Agent 查询后通过 Session 返回结果，或将报告发布为 Artifact。

数据库跨 Session 属于同一个 Agent。新 Session 或 `actor.ref` 不会创建独立数据库。用户不能共享 Agent 数据时，使用[每用户一个 Agent](./per-user-agents.md)。

## 开始之前 {#before-you-begin}

示例复用[快速开始](../get-started/quickstart.md)中的 SDK client 和运行中 Agent。curl 使用[鉴权](../get-started/authentication.md)中设置的环境变量。

Agent 的工具策略必须允许 `agent_db`。production 数据库 viewer 当前不可用，这不影响 Agent 使用该工具。完成[快速开始](../get-started/quickstart.md)，复用运行中的 Agent 和 API Session。

在后端使用 Bash、curl 7.76+ 和 jq 1.6+ 运行下面的代码。key 必须有权访问该 Agent，包括适用时的 project scope，见[鉴权](../get-started/authentication.md)。

```bash
export AGENT_ID='your-existing-agent-id'
export SESSION_ID='your-existing-session-id'
```

## 使用 Agent Database {#use-agent-database}

数据库支持可用时，第一次 `agent_db` 调用会创建 Agent 的数据库。工具接受非空 `sql` 字符串和可选的位置参数 `args`，默认是 `[]`。Agent 不选择 hostname、数据库名或 credential。

### 让 Agent 建表 {#ask-the-agent-to-create-a-table}

发送明确选择 Agent Database 的任务：

::: code-group

```ts [TypeScript]
const receipt = await client.postEvents(agentId, sessionId, [
  {
    "type": "user.message",
    "content": "Use agent_db to create a sales table with month TEXT PRIMARY KEY and amount INTEGER NOT NULL. Insert or replace January=100, February=120, and March=80 using SQL parameters, then query the total. Use Agent Database, not a workspace SQLite file.",
    "idempotency_key": "agent-db-sales-01"
  }
])
console.log(receipt.events[0]?.accepted)
```

```python [Python]
receipt = await client.post_events(agent_id, session_id,
    [
        {
            "type": "user.message",
            "content": "Use agent_db to create a sales table with month TEXT PRIMARY KEY and amount INTEGER NOT NULL. Insert or replace January=100, February=120, and March=80 using SQL parameters, then query the total. Use Agent Database, not a workspace SQLite file.",
            "idempotency_key": "agent-db-sales-01"
        }
    ],
)
if not receipt or receipt[0].get("accepted") is not True:
    raise RuntimeError("The message was not accepted")
```

```bash [curl]
curl -sS --fail-with-body \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{
    "type":"user.message",
    "content":"Use agent_db to create a sales table with month TEXT PRIMARY KEY and amount INTEGER NOT NULL. Insert or replace January=100, February=120, and March=80 using SQL parameters, then query the total. Use Agent Database, not a workspace SQLite file.",
    "idempotency_key":"agent-db-sales-01"
  }]}'
```

:::

TypeScript 检查 `receipt.events[0].accepted`，Python 检查 `receipt[0]["accepted"]`。这是已有 Session，读取[事件流](./events.md#streaming-a-turn)时应传入上次处理完成的 cursor，直到新一轮的 `run.finished`。检查 `agent_db` 结果中的表、数据行和总额。消息被接受，不代表工具已经运行或数据库已经创建。

例如，表创建后，Agent 可以用以下工具参数插入一行：

```json
{"sql":"INSERT INTO sales (month, amount) VALUES (?, ?)","args":["April",90]}
```

这是工具输入，不是公共 SQL 请求体。schema 初始化和数据修改通过 Agent 的工具调用完成。

### 数据库 viewer 的可用性 {#database-viewer-availability}

production 数据库 viewer 当前不可用。即使 `agent_db` 已成功创建数据，catalog 和 table-row 请求仍返回 404。已发布的 SDK 保留了 viewer 方法，但这些方法不属于当前可用的 production 集成流程。修改分页参数或重新建表不能开启 viewer。

需要检查数据时，让 Agent 使用 `agent_db` 查询，并通过 [Session 事件](./events.md)返回结果，或通过 [Artifacts](./files.md)发布报告。这是由 Agent 执行的查询，不是应用直接访问数据库的 API。

## 其他数据来源 {#other-data-sources}

`/workspace` 中的 SQLite 文件属于工作区，与 Agent Database 分开。数据库 viewer 不会查看它。默认 sandbox 中的 `psql` 和 `redis-cli` 连接你提供的服务；安装客户端不会创建服务端或配置 credentials。见[云沙箱参考](./cloud-sandbox-reference.md#数据库)和[文件与产物](./files.md)。

Agent Database 保存结构化行，不会创建托管文档索引或 RAG API。通过[自定义工具](./tools.md#应用执行的自定义工具)或 [MCP](./mcp.md)连接现有应用数据库或 retrieval 服务。集成方式见[检索与数据连接](./retrieval.md)。
