---
title: Agent Database
description: 通过 agent_db 工具管理 Agent 自己的结构化数据，并用公共 API 查看数据库表。
source: /en/build/data-storage
source_hash: dea1a9317b20234aeb29763ade3ca7e78e98a36510831ea3a74d1da42c8fe8c3
---

# Agent Database

Agent Database 为 Agent 提供自己的托管 libSQL 数据库。Agent 在任务中使用 `agent_db` 建表、写入和查询数据。应用可以通过只读公共 API 查看已有的表。

数据库跨 Session 属于同一个 Agent。新 Session 或 `actor.ref` 不会创建独立数据库。用户不能共享 Agent 数据时，使用[每用户一个 Agent](./per-user-agents.md)。

## 开始之前 {#before-you-begin}

示例复用[快速开始](../get-started/quickstart.md)中的 SDK client 和运行中 Agent。curl 使用[鉴权](../get-started/authentication.md)中设置的环境变量。

deployment 必须提供 `agent_db` 工具和数据库 viewer；两者可能独立可用。Agent 的工具策略必须允许 `agent_db`。完成[快速开始](../get-started/quickstart.md)，复用运行中的 Agent 和 API Session。

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
const receipt = await zc.postEvents(agentId, sessionId, [
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

检查回执的 `events[0].accepted`，再读取[事件流](./events.md#streaming-a-turn)直到 `run.finished`。检查 `agent_db` 结果中的表、数据行和总额。消息被接受，不代表工具已经运行或数据库已经创建。

例如，表创建后，Agent 可以用以下工具参数插入一行：

```json
{"sql":"INSERT INTO sales (month, amount) VALUES (?, ?)","args":["April",90]}
```

这是工具输入，不是公共 SQL 请求体。schema 初始化和数据修改通过 Agent 的工具调用完成。

### 查看已有的表 {#inspect-existing-tables}

读取 Agent 的数据库 catalog：

```bash
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/database" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

ready 响应包含 `status: "ready"` 和 `tables`，每个 table 有 `name` 和 `kind`。数据库尚未创建时，响应为：

```json
{"status":"not_provisioned"}
```

viewer 不会创建数据库。viewer 支持不可用时，请求可能返回 `404`。应先确认同一个 key 可以读取 Agent，再把这个响应解释为数据库可用性结果。

`sales` 存在后，读取数据行：

```bash
curl -sS --fail-with-body --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/database/tables/sales/rows" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'limit=20' \
  --data-urlencode 'offset=0'
```

响应包含 `status`、`table`、`schema`、`columns`、`rows`、`limit` 和 `offset`。`limit` 默认 100，接受 1 到 100 的整数。`offset` 默认 0，必须是非负整数。未知表返回 `404`；无效分页返回 `400`；检查期间被删除的数据库可能返回 `409 database_unavailable`。

这些 endpoints 只读，不提供任意 SQL 执行或写入。使用 HTTP 请求调用；SDK 不提供对应的数据库方法。

## 其他数据来源 {#other-data-sources}

`/workspace` 中的 SQLite 文件属于工作区，与 Agent Database 分开。数据库 viewer 不会查看它。默认 sandbox 中的 `psql` 和 `redis-cli` 连接你提供的服务；安装客户端不会创建服务端或配置 credentials。见[云沙箱参考](./cloud-sandbox-reference.md#数据库)和[文件与产物](./files.md)。

Agent Database 保存结构化行，不会创建托管文档索引或 RAG API。通过[自定义工具](./tools.md#应用执行的自定义工具)或 [MCP](./mcp.md)连接现有应用数据库或 retrieval 服务。集成方式见[检索与数据连接](./retrieval.md)。

## SDK 调用

以下示例要求安装包含该方法的 SDK release。先检查已安装的 exports；缺少方法时使用本页 HTTP 示例。

::: code-group

```ts [TypeScript]
const catalog = await zc.getAgentDatabase(agentId)
const page = await zc.getAgentDatabaseRows(agentId, 'results', { limit: 100, offset: 0 })
```

```python [Python]
catalog = await client.get_agent_database(agent_id)
page = await client.get_agent_database_rows(agent_id, "results", limit=100, offset=0)
```

:::

这两个只读方法不会创建缺失的数据库。保留 `status: "not_provisioned"` 和未知字段。
