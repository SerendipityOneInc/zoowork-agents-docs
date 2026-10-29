---
title: 保护你的部署
description: 面向真实用户上线前，按优先级检查 API key、终端用户访问、数据隔离、工具、审批、webhook 和用量。
source: /en/security/secure-deployment
source_hash: 1f7d5e1532c3fa5b095ea9847bbcd30441d006ed97059178a486c63e6990b44e
---

# 保护你的部署

在 Managed Agents 集成开始服务真实用户之前，按这份清单逐项检查。条目按影响大小排序：
前几项保护 API key、隔离不同用户的数据；后几项限制一次错误或被操纵的工具调用能造成的影响，
以及能跑多少工作。每一项都说明要做什么、为什么、以及哪篇指南讲具体做法。
[风险与边界](./risks-and-boundaries.md)说明每类数据存在哪里、谁能访问。

## 1. API key 只放在后端 {#1-keep-the-api-key-in-your-backend}

把 Platform API key 存在服务端的 secret 配置里，只从后端调用 ZooWork。
不要把它放进浏览器或移动端代码，也不要放进 Agent 指令、Session 消息、上传的文件或 sandbox。

这个 key 不只对应一个用户或一个 Agent。它可以读取和修改所属组织与 Project 范围内的每个 Agent，
读取它们的 Sessions，用 `exec` 在它们的 sandbox 里执行命令，并发起消耗组织预付余额的工作。
放在 Agent 能读到的地方的内容，也可能经由 Agent 流出：消息会保存在 Session 历史里，
`/workspace` 文件对该 Agent 的每个 Session 可见，默认 sandbox 的出站网络不受限制。

更换 key 时，先创建新 key 并部署，再吊销旧 key。吊销会停止认证，但不会删除用这个 key 创建的
Agents、Sessions 或文件。

见 [Authentication 与 API key](../get-started/authentication.md#key-的范围与安全)。

## 2. 不同应用和环境使用不同的 Project {#2-use-separate-projects-for-separate-applications-and-environments}

为每个应用、每个环境（例如开发和生产）分别创建 Project，并使用各自的 key。
同一 Project 内的 key 可以访问同一批 Agents。key 访问不到其他 Project 的 Agent，这类请求返回 404。

上传 Skills 时也遵循这个边界：named Project key 写入的是 `project` Skill，只在该 Project 内可见；
Default Project key 写入的是 `org` Skill，在整个组织内共享。Project 不隔离资金，
同一组织下所有 Project 共用组织的预付余额。

见 [Authentication 与 API key](../get-started/authentication.md#key-的范围与安全)
和 [Skills](../build/skills.md#api-availability)。

## 3. 在后端授权每个请求 {#3-authorize-every-request-in-your-backend}

ZooWork 认证的是你的 API key，不是你的终端用户。后端必须负责用户登录、决定每个用户能使用哪些
Agents 和 Sessions，并在代表用户发起每次调用之前做检查：创建 Session、发送事件、
读取流、读取历史，以及处理审批。

把用户到 Agent、用户到 Session 的映射保存在你的数据库里。不要不经映射检查就接受浏览器传来的
Agent 或 Session ID。Labels、Session `metadata` 和 `actor.ref` 都是元数据，不授予访问权限。

见[每用户一个 Agent](../build/per-user-agents.md#authorize-each-agent-and-session-request)。

## 4. 不能共享数据的用户使用独立 Agent {#4-give-users-who-must-not-share-data-separate-agents}

Session 只隔离对话历史。Agent 的 `/workspace` 文件、Agent Database 和 `agent` scope 的 memory
由它的所有 Sessions 共享。设置 `sandbox.scope: 'session'` 会让各 Session 使用独立的 sandbox 实例，
但它们仍然使用同一个 workspace。

如果用户之间不能看到彼此的文件、数据库记录或保存的事实，为每个用户创建一个 Agent。
如果多个用户共用一个 Agent，由后端为每个已认证用户发送稳定的 `actor: { ref }`，
让每个用户拥有独立的 `user_agent` memory scope。没有 actor 的消息使用 Agent owner 的身份：
这些用户会共用 owner 的私有 memory，并且可以写入共享的 `agent` scope。

见[每用户一个 Agent](../build/per-user-agents.md) 和
[Memory scope](../build/memory.md#choose-a-memory-scope)。

## 5. 在 custom tool 内部检查授权 {#5-check-authorization-inside-custom-tools}

Agent 调用应用执行的 custom tool 时，实际操作由你的后端执行。把工具输入当作不可信输入：
它由模型生成，而模型读到的内容可能影响它。先校验输入，再根据你自己的 Session 映射确定终端用户，
而不是根据工具输入里的值，然后检查这个用户是否有权执行这个操作，最后才执行。
平台审批可以在请求到达你之前拦下它，但不能代替这些检查。

服务凭据（例如数据库密码和第三方 API token）保存在后端，只在 custom tool 内部使用。
公共 API 不会向 Agent 下发凭据，平台调用远程 MCP Server 时也不附带保存的凭据。
一个接受这类无认证请求的 MCP Server，对任何能访问到它的人都同样接受请求，
所以不要通过它暴露私有数据或写操作。ZooWork 可以附加到 MCP 调用上的 Agent 和 Session 标识
只是请求上下文，不能证明调用方已获授权。

见 [Custom tool](../build/tools.md#应用执行的自定义工具)和
[MCP Server](../build/mcp.md#连接要求)。

## 6. 用 `tool_policy` 缩小工具范围 {#6-narrow-the-tool-set-with-tool-policy}

用 `tool_policy` 去掉任务不需要的内置工具，例如 `exec` 或 web 工具。
对 MCP Server，用 `toolFilter` 只暴露需要的原生工具；省略它会暴露该 server 的完整目录。

先检查下面这些工具，因为它们会访问网络，或修改之后的 Sessions 会用到的状态：

| 工具 | 为什么要检查 |
|---|---|
| `exec` | 在 sandbox 中执行命令。默认 sandbox 的出站网络不受限制，禁用 web 工具也不会限制 `exec`。 |
| `web_fetch`、`web_search`、`web_image_search` | 通过平台服务把 web 内容带进 Agent 的 context。 |
| `cron` | 部署提供该工具时，Agent 可以创建、修改和触发自己的 schedule。 |

除非你的产品需要 Agent 自己管理 schedule，否则禁用 `cron`。
每个包含 `tool_policy` 的 PUT 都会替换整个 policy，所以更新前先读取并合并当前 policy。

见[工具](../build/tools.md#用-tool-policy-收窄工具集)和
[MCP Server](../build/mcp.md#选择-mcp-工具)。

## 7. 高风险调用需要审批 {#7-require-approval-for-risky-calls}

对需要保留、但不能无人值守执行的工具，在 `tool_policy.permissions` 中设置 `always_ask`，
或在 MCP Server 上设置 `permission` / `tools`。匹配的调用会等待决定后再执行。
如果某个 MCP 工具每次调用都需要重新确认，再加上 `requireConfirmation: true`。

Agent 还可以更新自己的 persona 文档（例如 `AGENTS.md`），之后的回合会把它当作指令读取。
要在每次修改写入前先审查，把 `tool_policy.permissions.persona_doc_update` 设为 `always_ask`。

只把 pending approval 展示给有权决定的用户，并且只提供 `allowed_decisions` 中的选项。
`allow-always` 会在本 Session 剩余时间内放行匹配的规则；如果该规则是 MCP Server 级的默认策略，
这次授权可能覆盖同一 server 的其他工具。pending approval 在十分钟后会被拒绝。

见[权限策略](../build/permissions.md)。

## 8. 把外部内容当作不可信输入 {#8-treat-outside-content-as-untrusted-input}

网页、搜索结果、上传的文件、MCP 结果和 custom tool 结果都会进入模型的 context。
其中的文字可能试图给 Agent 下达新指令，这叫 prompt injection。不要指望模型自己忽略它。
用这份清单的其他条目限制一次被操纵的回合能做什么：更少的工具、高风险调用需要审批、
custom tool 内部做授权、Agent 能读到的地方不放 secret，以及不能共享数据的用户使用独立 Agent。

见 [Prompt injection](./risks-and-boundaries.md#prompt-injection)。

## 9. 验证 webhook 签名 {#9-verify-webhook-signatures}

处理每次 webhook 投递之前，用 SDK helper 或 Standard Webhooks 库基于原始请求体验证签名。
比较事件 `id` 与已签名的 `webhook-id` header，按事件 ID 去重，并把 `whsec_` signing secret
存在服务端的 secret 存储里。webhook 只是通知，状态要通过读取对应资源来确认。

见 [Webhooks](../build/webhooks.md#verify-before-acknowledging)。

## 10. 把 Artifact URL 当作凭据 {#10-treat-artifact-urls-as-credentials}

持有 Artifact 下载 URL 的任何人都能读取文件。只把 URL 交给有权查看文件的用户，
不要把 URL 写进日志，并删除不再需要的 Artifacts。删除不会立即吊销所有已发出的 URL：
presigned URL 可能在过期或存储对象被移除之前一直可用。

见[文件与产物](../build/files.md#access-urls-and-deletion)。

## 11. 关注用量并停止失控的工作 {#11-watch-usage-and-stop-runaway-work}

公共 API 没有服务端强制的单 Session 花费上限，同一组织的所有 Project 共用组织的预付余额。
在后端查询 [Usage](../reference/usage.md)，按用户或任务执行你自己的限额，
并在超限时发送 [`user.interrupt`](../build/events.md#user-interrupt) 停止当前 run。
用 Platform key 查询的 Usage 只包含归属于该 key 的用量；组织管理员可以在 Platform 查看全组织用量。

启用状态的 schedule 会持续触发，包括 Agent 自己创建的 schedule。定期列出每个 Agent 的 schedule，
暂停或删除不在预期内的，并且在删除 Agent 之前先删除它的 schedule：Agent 删除后，
它的 schedule 路由会返回 404。

见[审查与监控 Session](./monitor-sessions.md) 和
[Schedules](../build/schedules.md#enable-pause-and-delete)。

## 相关 {#related}

- [风险与边界](./risks-and-boundaries.md)：数据存在哪里、谁能访问，以及主要风险。
- [审查与监控 Session](./monitor-sessions.md)：审查工具调用，尽早发现问题。
- [权限策略](../build/permissions.md)：为工具调用设置审批。
- [每用户一个 Agent](../build/per-user-agents.md)：独立 workspace 与后端授权。
