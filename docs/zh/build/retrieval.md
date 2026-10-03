---
title: 通过工具接入知识库
description: 通过 custom tools 或 MCP，把 Agent 连接到应用中的知识服务。
source: /en/build/retrieval
source_hash: 477be59df1e52747b813e4891e4248a3da1ad99a70043914913afd6ecf146353
---

# 通过工具接入知识库

Agent 需要产品文档、客户记录或已有知识库里的事实时，给它一个搜索工具。
索引和访问控制留在你的服务中。Agent 发出查询，收到相关片段，再用这些片段回答问题。

这个应用示例通过工具连接已有搜索服务，提供 RAG 应用中的 retrieval 步骤，
不会创建平台托管的索引。

示例复用[快速开始](../get-started/quickstart.md)中的 client 和 Agent。Python 调用在 async 函数中运行。curl 先完成[鉴权](../get-started/authentication.md)中的环境变量设置。

## 选择执行路径

| 搜索服务的情况 | 使用方式 | 凭据和访问检查放在哪里 |
|---|---|---|
| 后端已经可以调用它，或它需要访问私网 | Custom tool | 你的后端。 |
| 它提供公网可达的 MCP endpoint，接受平台不带 stored credential 的请求 | MCP | MCP 服务中，并遵守公共连接要求。 |

已有 retriever 时，从 custom tool 开始。SQL 查询、vector search 或第三方搜索 API
都可以用这个模式，不需要更换索引。

## 通过应用执行检索

### 1. 声明搜索工具

创建接受 query 的 custom tool，并用 persona 告诉 Agent 何时需要检索事实：

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const agent = await zc.createAgent({
  resource: {
    name: 'support-assistant',
    persona: {
      docs: [{
        name: 'AGENTS.md',
        content: 'For product-specific facts, search the support documents first. Cite the returned sources. If the documents do not answer the question, say so.',
      }],
    },
    custom_tools: [{
      name: 'search_knowledge',
      description: 'Search approved support documents for product-specific facts. Returns relevant passages and source identifiers.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    }],
  },
})

await zc.startAgent(agent.agent_id)
await zc.waitUntilRunning(agent.agent_id)
```

```python [Python]
from zoowork import create_zoowork_client

client = create_zoowork_client()
agent = await client.create_agent(
    {
        "name": "support-assistant",
        "persona": {
            "docs": [
                {
                    "name": "AGENTS.md",
                    "content": "For product-specific facts, search the support documents first. Cite the returned sources. If the documents do not answer the question, say so."
                }
            ]
        },
        "custom_tools": [
            {
                "name": "search_knowledge",
                "description": "Search approved support documents for product-specific facts. Returns relevant passages and source identifiers.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string"
                        }
                    },
                    "required": [
                        "query"
                    ]
                }
            }
        ]
    },
)
await client.start_agent(agent["agent_id"])
await client.wait_until_running(agent["agent_id"])
```

```bash [curl]
agent=$(curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "resource": {
    "name": "support-assistant",
    "persona": {
      "docs": [
        {
          "name": "AGENTS.md",
          "content": "For product-specific facts, search the support documents first. Cite the returned sources. If the documents do not answer the question, say so."
        }
      ]
    },
    "custom_tools": [
      {
        "name": "search_knowledge",
        "description": "Search approved support documents for product-specific facts. Returns relevant passages and source identifiers.",
        "input_schema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string"
            }
          },
          "required": [
            "query"
          ]
        }
      }
    ]
  }
}
JSON
)
AGENT_ID=$(jq -er '.agent_id' <<<"$agent")
curl -sS --fail-with-body --request POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/start" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

平台把工具声明交给模型。Agent 请求它时，由应用执行。
工具由模型选择，description 和 persona 用来指导选择。

### 2. 执行请求并返回片段

这里的 `searchSupportDocuments()` 是从你自己的服务导入的**应用函数**。
它应返回少量片段，每一项包含文档标识、文字，以及可用时的来源 URL。
函数必须使用可信的请求上下文执行应用访问检查，不能依赖模型传入的 user 或 tenant id。

::: code-group

```ts [TypeScript]
import { customToolUse, isRunFinished } from '@zoowork-ai/sdk'
import { searchSupportDocuments } from './knowledge-service.js'

const session = await zc.createSession(agent.agent_id, {
  initial_events: [{
    type: 'user.message',
    content: 'What response time does our Enterprise support plan provide?',
  }],
})

for await (const ev of zc.streamEvents(agent.agent_id, session.session_id)) {
  const call = customToolUse(ev)
  if (call?.phase === 'requested' && call.name === 'search_knowledge') {
    const query = call.input?.query
    let result: unknown
    if (typeof query !== 'string' || query.trim() === '') {
      result = { error: 'A non-empty query is required.' }
    } else {
      try {
        const passages = await searchSupportDocuments(query)
        result = { passages }
      } catch {
        result = { error: 'Document search is temporarily unavailable.' }
      }
    }
    await zc.resolveCustomToolCall(agent.agent_id, call.callId, {
      content: [{ type: 'json', value: result }],
      resolvedBy: 'knowledge-service',
    })
  }
  if (isRunFinished(ev)) break
}
```

```python [Python]
from zoowork import custom_tool_use, is_run_finished
from knowledge_service import search_support_documents

session = await client.create_session(agent["agent_id"], {
    "initial_events": [{
        "type": "user.message",
        "content": "What response time does our Enterprise support plan provide?",
    }],
})
async for event in client.stream_events(agent["agent_id"], session["session_id"]):
    call = custom_tool_use(event)
    if call is not None and call.phase == "requested" and call.name == "search_knowledge":
        query = (call.input or {}).get("query")
        if not isinstance(query, str) or not query.strip():
            result = {"error": "A non-empty query is required."}
        else:
            try:
                result = {"passages": await search_support_documents(query)}
            except Exception:
                result = {"error": "Document search is temporarily unavailable."}
        await client.resolve_custom_tool_call(
            agent["agent_id"], call.call_id,
            content=[{"type": "json", "value": result}],
            resolved_by="knowledge-service",
        )
    if is_run_finished(event):
        break
```

:::

返回片段后，等待中的调用可以继续，Agent 接着处理任务。
空结果表示没有匹配且可访问的文档。服务错误应在返回内容中保留为错误，不能伪装成空搜索结果。
错误信息不要包含凭据或服务内部细节。

应用在 run 等待时重启，可以用 `listCustomToolCalls(agentId, { status: 'pending' })`
恢复 pending calls。结果大小、timeout，以及 accepted 和 consumed 的区别，
见 [Custom tools](./tools.md#执行并返回结果)。不要假定应用只会执行一次 pending 请求。

## 通过 MCP 执行检索

Retriever 提供满足[连接要求](./mcp.md#连接要求)的 MCP Server 时，只声明 Agent 需要的搜索工具：

::: code-group

```ts [TypeScript]
await zc.updateAgent(agent.agent_id, {
  mcp: [{
    name: 'knowledge',
    url: 'https://mcp.example.com/knowledge',
    transport: 'streamable-http',
    toolFilter: ['search_documents'],
    exposure: 'deferred',
  }],
})
```

```python [Python]
await client.update_agent(agent["agent_id"],
    {
        "mcp": [
            {
                "name": "knowledge",
                "url": "https://mcp.example.com/knowledge",
                "transport": "streamable-http",
                "toolFilter": [
                    "search_documents"
                ],
                "exposure": "deferred"
            }
        ]
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "mcp": [
    {
      "name": "knowledge",
      "url": "https://mcp.example.com/knowledge",
      "transport": "streamable-http",
      "toolFilter": [
        "search_documents"
      ],
      "exposure": "deferred"
    }
  ]
}
JSON
```

:::

URL 和工具名称是你服务的占位值。这次更新会整体替换 MCP 数组，
提交时带上 Agent 应保留的其他 Servers。平台发现目录并直接调用远程搜索工具，
应用不需要为这次 MCP 调用处理 custom tool result。

Server 必须满足公共的 [MCP 连接要求](./mcp.md#连接要求)。
私有服务或由后端负责认证的服务，使用上面的应用执行路径。

## 让答案有返回证据

返回回答问题需要的片段，并附上稳定的来源标识。
要求 Agent 引用这些来源，在检索材料不能回答问题时说明这一点。
大结果可能被截断，返回整个文档集合反而难以保留有用证据。

测试三个问题：答案只存在于你文档里的问题、没有匹配文档的问题，
以及匹配文档对当前用户不可见的问题。分别检查搜索结果和最终答案，每次检查使用新的 Session。

## 下一步

- [工具](./tools.md)——声明字段、pending call 恢复和结果限制。
- [MCP Server](./mcp.md)——远程目录、连接要求和工具选择。
- [权限策略](./permissions.md)——工具调用前的审批。
- [鉴权](../get-started/authentication.md)——API key 范围和应用授权。
- [Agent Database](./data-storage.md)——选择 Agent 数据库工具或自己的数据库。
- [当前边界](../reference/not-supported.md)——检查 connector 配置与授权流程是否可用。
