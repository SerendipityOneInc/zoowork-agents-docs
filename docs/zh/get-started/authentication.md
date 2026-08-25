---
title: 鉴权
source: /en/get-started/authentication
source_hash: 701bb04fa9309f413a3d9b9cdb2740dffde2daa050492179e1f05ad85efc8272
---

# 鉴权

调用 ZooWork API 只需要一个凭证：一个组织级 service token，也就是你的 **API key** 。

- 它是一个以 `zct_` 开头的字符串。
- 以 `Authorization: Bearer zct_...` 发送。
- 在 TypeScript SDK 里作为 `apiKey` 传入。

带版本前缀的 base URL 是：

```
https://clawapi.ecap.gsmo.ai/service/v1
```

## 获取 key

key 在 ZooWork App 里创建，位置是 **设置 → API Keys**：

1. 打开 ZooWork App，进入**设置**，切到 **API Keys** 标签页。
2. 点 **Create API Key**，起一个日后认得出的名字（`orders-backend`，不要叫 `test`），
   然后复制密钥。它**只显示这一次**，之后无法再取回——弄丢就只能轮换。
3. 个人组织里任何成员都能建；企业组织里这个标签页要求 **admin** 角色——看不到就找你的
   组织管理员要一把。

之后的管理也在同一页：**Rotate** 立即作废旧密钥并把新密钥显示一次；**Revoke** 直接吊销。
两者都没有 API——key 管理刻意只在 App 里，**所以不要在你自己的代码里写轮换流程**。key 一旦
泄露，立刻去 App 里 **Rotate**。

## 配置客户端

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })
```

`baseUrl` 是可选的——默认指向公开 API，`ZOOWORK_BASE_URL` 可覆盖它。`/models`、`/agents/{id}/sessions` 这类路径会直接拼在它后面。

## 只能放在服务端

**这个 key 认证的是一个组织，不是一个终端用户。** 任何拿到它的人都能创建、读取、修改、启动、停止、删除你组织里的每一个 agent，并读取这些 agent 下的每一份会话记录。**没有按用户细分的版本，也没有只读版本。**

把它留在你自己控制的服务器上：

- 不要放进浏览器打包产物、移动端 App、桌面端 App，或任何在构建时会被内联进客户端的环境变量。
- 不要提交进代码仓，不要打进日志或错误信息。
- **在你的用户和 ZooWork API 之间放你自己的后端。** 你的后端持有这个 key，按你自己的方式认证用户，并决定每个用户能碰哪个 agent、哪个会话。

**这个 key 是 API 接受的唯一凭据。** 没有给你自己、或你终端用户的密钥用的保险库——把它们留在你自己的服务里。见[不支持的能力](/zh/reference/not-supported)。

## 租户隔离：返回 404，不是 403

属于其他组织的 agent id 会返回 **404，而不是 403** 。API 选择隐藏存在性，而不是确认它。两个后果：

1. **不要把 404 读成「已删除」。** 它的含义是「这个 key 看不到任何具有该 id 的 agent」，这涵盖了已删除、从未存在、以及属于别人三种情况。如果你需要知道自己的 agent 是否还在，请在你这边自行记录。
2. **agent id 不是密钥，但也别到处散。** 在同一个组织内，任何 key 都能 `getAgent()` 它得知的任何 agent id，所以粘进群聊的一个 id 就是一份可读的配置。id 本身不是凭证，跨组织知道它也没有任何访问权。

**列表比读取更严格** ：agent 列表要按明确的 `owner_uid` + `org_id` 选择器对，且是 AND 匹配。同一组织内**由另一个 key 创建的 agent，可以按 id 读到，但不会出现在这个 key 的列表里** 。`listAgents()` 用的就是这套选择器，所以它只列出你自己这个 key 拥有的 agent——组织内由别的 key 创建的，请自行记录它们的 id。

## 验证一个 key 是否可用

最便宜的存活检查是 `listModels()`。它不涉及任何 agent，不创建任何东西，返回你的组织可选的模型列表。

```ts
import { createZooworkClient, ZooworkError } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

try {
  const models = await zc.listModels()
  console.log(`ok: ${models.length} models, e.g. ${models[0]?.model}`)
} catch (e) {
  if (e instanceof ZooworkError && e.status === 401) {
    console.error('key rejected:', e.type) // service_token.invalid
    process.exit(1)
  }
  throw e
}
```

用 curl 做同样的检查：

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  https://clawapi.ecap.gsmo.ai/service/v1/models
```

缺失或无效的 key 返回 **401** 。请匹配 `ZooworkError.status` 和 `ZooworkError.type`，**不要** 去解析报错文本。

## 一个 key 能触达什么

| 能力 | 用你的 API key 能否触达 |
|---|---|
| `listModels()` | 能 |
| Agent 的创建、读取、修改、删除 | 能，限于你的组织内 |
| `listAgents()` | 能——但选择器是 `owner_uid` AND `org_id`，所以你只看得到自己这个 key 创建的 agent |
| `startAgent()` / `stopAgent()` | 能 |
| `listAgentSkills()` | 能 |
| 你的 agent 下的 session、事件、SSE 流 | 能 |
| 安装你自己组织上传的 skill | 路由对 `org` 和 `personal` scope 是开放的；我们尚未实测（见 [Skills](/zh/build/skills)） |
| 安装全局目录里的 skill | **不能——返回 404。** 全局 skill 在 agent 创建时就已经挂上了 |
| 上传 skill（`uploadSkill()` / `uploadSkillVersion()`） | 这条 multipart 路由只收 `org` 和 `personal` scope；`global` 和 `pack` 是 403。实测到哪一步见 [Skills](/zh/build/skills) |
| 你自己 agent 下的定时任务 | 挂在 agent 下的路由，七个方法都在客户端上。实测到哪一步见[能力矩阵](/zh/reference/capabilities) |
| 你组织内的 environment | 限于你的组织。平台默认的那个 environment——新建 agent 被钉上的那个——任何 key 都读不到，因为网关强制加了组织选择器，而默认 environment 不属于任何组织。见 [Environments](/zh/build/environments) |
| 其他组织的任何 agent id | **不能——返回 404，不是 403** |
| 列出同组织内由另一个 key 创建的 agent | 不能——列表选择器是精确匹配；按 id 读取仍然可行 |
| 把 key 本身按用户细分或降为只读 | 不存在这样的变体 |
