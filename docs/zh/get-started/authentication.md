---
title: 鉴权
source: /en/get-started/authentication
source_hash: 6057c1d512ee081015df9557258722af631ec979f8575e5dfa1c010c05a13ca6
---

# 鉴权

调用 ZooClaw API 只需要一个凭证：一个组织级 service token，本文档统称为你的 **API key** 。

- 它是一个以 `zct_` 开头的字符串。
- 以 `Authorization: Bearer zct_...` 发送。
- 在 TypeScript SDK 里作为 `apiKey` 传入。

带版本前缀的 base URL 是：

```
https://claw-interface.ecap.yesy.live/service/v1
```

## 配置客户端

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })
```

`baseUrl` 是可选的——默认指向公开 API，`ZOOCLAW_BASE_URL` 可覆盖它。`/models`、`/agents/{id}/sessions` 这类路径会直接拼在它后面。

## 只能放在服务端

**这个 key 认证的是一个组织，不是一个终端用户。** 任何拿到它的人都能创建、读取、修改、启动、停止、删除你组织里的每一个 agent，并读取这些 agent 下的每一份会话记录。**没有按用户细分的版本，也没有只读版本。**

把它留在你自己控制的服务器上：

- 不要放进浏览器打包产物、移动端 App、桌面端 App，或任何在构建时会被内联进客户端的环境变量。
- 不要提交进代码仓，不要打进日志或错误信息。
- **在你的用户和 ZooClaw API 之间放你自己的后端。** 你的后端持有这个 key，按你自己的方式认证用户，并决定每个用户能碰哪个 agent、哪个会话。

## 网关替你做的事

你的请求会经过一个网关，它认证这个 key 并把每个请求限定在你的组织范围内。其中三条行为会直接影响你写的代码。

**它替你设定 ownership。** `createAgent()` 的入参里要求一个 `ownership` 对象，但网关会用你 key 所属的租户锚点**覆盖你传的任何值** 。传准确的值既不可能也没必要，传占位符就行。

```ts
const created = await zc.createAgent({
  resource: { name: 'my-agent', model: { primary: 'litellm/claude-sonnet-5' } },
  // 会被网关用你 key 自己的锚点覆盖。
  ownership: { owner_uid: 'placeholder', org_id: 'placeholder' },
})
```

**它替你注入 agent 调用模型所需的平台凭证。** 你不需要创建、提供或轮换模型凭证。这件事发生在创建之后，而且是真实写入：**它会把 agent 的 `config_version` 连续 bump 两次** ，所以创建回执上的 `config_version: 1`，等你下一次 `getAgent()` 返回时已经是 `3` 了。不要把创建时拿到的版本号当作仍然有效。

**它不会启动 agent。** 新建的 agent 返回时 `status.desired_state === 'stopped'`，而对一个停止状态的 agent 调 `createSession()` 会失败并返回 `409 agent_not_running`。**你必须自己调 `startAgent()`。** 完整的「创建后启动」流程见[快速开始](/zh/get-started/quickstart)。

正因为凭证由网关注入，凭证相关的端点在这个网关上**刻意不开放** 。SDK 里仍然带着 `putCredential()` 和 `listCredentials()`——**它们在这里一律返回 404** 。目前没有任何受支持的方式来托管你自己的、或你终端用户的第三方凭证。

## 租户隔离：返回 404，不是 403

属于其他组织的 agent id 会返回 **404，而不是 403** 。API 选择隐藏存在性，而不是确认它。两个后果：

1. **不要把 404 读成「已删除」。** 它的含义是「这个 key 看不到任何具有该 id 的 agent」，这涵盖了已删除、从未存在、以及属于别人三种情况。如果你需要知道自己的 agent 是否还在，请在你这边自行记录。
2. **agent id 不是密钥，但也别到处散。** 在同一个组织内，任何 key 都能 `getAgent()` 它得知的任何 agent id，所以粘进群聊的一个 id 就是一份可读的配置。id 本身不是凭证，跨组织知道它也没有任何访问权。

**列表比读取更严格** ：agent 列表要按明确的 `owner_uid` + `org_id` 选择器对，且是 AND 匹配。同一组织内**由另一个 key 创建的 agent，可以按 id 读到，但不会出现在这个 key 的列表里** 。SDK 没有暴露 `listAgents()` 方法——请自行记录你创建过的 agent id。

## 验证一个 key 是否可用

最便宜的存活检查是 `listModels()`。它不涉及任何 agent，不创建任何东西，返回你的组织可选的模型列表。

```ts
import { createZooclawClient, ZooclawError } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

try {
  const models = await zc.listModels()
  console.log(`ok: ${models.length} models, e.g. ${models[0]?.model}`)
} catch (e) {
  if (e instanceof ZooclawError && e.status === 401) {
    console.error('key rejected:', e.type) // service_token.invalid
    process.exit(1)
  }
  throw e
}
```

用 curl 做同样的检查：

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  https://claw-interface.ecap.yesy.live/service/v1/models
```

缺失或无效的 key 返回 **401** 。请匹配 `ZooclawError.status` 和 `ZooclawError.type`，**不要** 去解析报错文本。

## 一个 key 能触达什么

| 能力 | 用你的 API key 能否触达 |
|---|---|
| `listModels()` | 能 |
| Agent 的创建、读取、修改、删除 | 能，限于你的组织内 |
| `startAgent()` / `stopAgent()` | 能 |
| `listAgentSkills()` | 能 |
| 你的 agent 下的 session、事件、SSE 流 | 能 |
| 安装你自己组织上传的 skill | 路由对 `org` 和 `personal` scope 是开放的；我们尚未实测（见 [Skills](/zh/build/skills)） |
| 安装全局目录里的 skill | **不能——返回 404。** 全局 skill 在 agent 创建时就已经挂上了 |
| `putCredential()` / `listCredentials()` | **不能——设计如此的 404** ；网关自己注入模型凭证 |
| 其他组织的任何 agent id | **不能——返回 404，不是 403** |
| 列出同组织内由另一个 key 创建的 agent | 不能——列表选择器是精确匹配；按 id 读取仍然可行 |
| 把 key 本身按用户细分或降为只读 | 不存在这样的变体 |

::: warning 尚未验证
我们没有实测过 key 的轮换与吊销，所以本页不描述任何相关流程。**不要假设 key 可以从你自己的代码里轮换或吊销** ，也不要构建依赖此能力的流程。key 一旦泄露，请视为需要联系签发方处理。
:::
