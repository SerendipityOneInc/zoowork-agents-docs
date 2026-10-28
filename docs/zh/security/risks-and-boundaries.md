---
title: 风险与边界
description: 了解 key、配置、Session 历史、文件、memory 和数据分别存在哪里，谁能读取或修改，以及如何降低主要风险。
source: /en/security/risks-and-boundaries
source_hash: ffd32dbf0b3802acf9553bc378d7f3ec869cf75a073bc89586f6659990448aa8
---

# 风险与边界

Agent 的数据分布在几个地方：你的后端、Agent 配置、Session 历史、workspace、memory、
Agent Database 和已发布的 Artifacts。每个地方有各自的读取方和写入方。本页先列出它们，
再说明基于 Managed Agents 构建的应用面临的主要风险，以及降低每种风险的控制手段。
[保护你的部署](./secure-deployment.md)把这些控制手段整理成了清单。

## 每类数据存在哪里 {#where-each-thing-lives}

表中的「你的后端」指使用该 Agent 所属组织和 Project 的 Platform API key 发出的请求。
同一 Project 内的所有 key 对其中的 Agents 有相同的访问权限；其他 Project 的 key 会得到 404。

| 内容 | 存在哪里 | 谁能读取 | 谁能修改 |
|---|---|---|---|
| Platform API key | 你后端的 secret 存储。Platform 只显示一次 secret。 | 你的后端。 | 在 Platform 中，组织 owner 创建 key，组织管理员可以吊销 key。 |
| 你的服务凭据 | 你的后端。公共 API 不能向 Agent 下发凭据。 | 你的后端，在 custom tool 内部使用。 | 你的后端。 |
| Agent 配置：指令、模型、工具、MCP Server、`tool_policy` | 与 Agent 一起保存。 | 你的后端。模型每个回合都会读取指令，并可能在回复中复述。 | 你的后端，通过 `updateAgent`。Agent 也可以在运行中更新自己的 persona 文档，见 [Prompt injection](#prompt-injection)。 |
| Session 历史和事件 | 按 Session 保存。 | 你的后端。每个 Session 的对话与该 Agent 的其他 Sessions 分开。 | 你的输入和 Agent 的工作会追加到其中。删除 Session 后公共读取不再返回它，但 transcript 和事件会为审计保留。 |
| `/workspace` 文件 | Agent 的持久化 workspace。 | 每个 Session 中的 Agent，通过文件工具和 `exec`。你的后端，通过 `exec`。 | 每个 Session 中的 Agent；你的后端，通过 `uploadFile` 和 `exec`。 |
| Agent memory | Memory 服务，分为 `agent` 和 `user_agent` scope。 | `agent` scope：该 Agent 任何 Session 中的回合。`user_agent` scope：该 actor 的回合；消息没有 actor 时为 owner 的回合。 | 只能由 Agent 通过 Memory 工具修改。`agent` scope：owner 的回合和获得授权的系统活动。`user_agent` scope：该 actor。 |
| Agent Database | 属于该 Agent 的托管数据库。 | Agent 在每个 Session 中通过 `agent_db` 读取。生产环境没有直接查看器。 | Agent 通过 `agent_db` 修改。 |
| 已发布的 Artifacts | 独立于 workspace 文件的发布副本。 | 你的后端，以及持有下载 URL 的任何人。 | Agent 发布；你的后端可以删除。 |
| Sandbox 及其网络 | 托管、隔离的 Linux sandbox。默认用户不是 root，可以免密码执行 `sudo`。 | Agent 执行的命令；你的后端，通过 `exec`。 | 默认 Environment 的出站网络不受限制。Platform key 不能修改 Environment 或其网络策略。 |
| Webhook signing secret | 在注册 endpoint 或轮换 secret 时返回。 | 你的 webhook 接收端。普通的 endpoint 读取不会返回它。 | 你的后端，通过轮换修改。 |

下面各节链接到每一项对应的指南。

## Prompt injection {#prompt-injection}

Prompt injection 是 Agent 读到的内容里试图给它下达新指令的文字。模型会把工具结果当作 context 读取，
所以网页、搜索结果、上传的文档、MCP 结果、custom tool 结果，或者之前某个 Session 写下的文件，
都可能带有这类文字。如果模型照做，Agent 就会以你的配置赋予它的权限，替这段文字的作者调用工具。

影响可能延续到这个回合之后。被操纵的回合可以写入之后的 Sessions 会读取的 workspace 文件、
Agent Database 记录或 memory；可以用 `cron` 创建 schedule；也可以更新 Agent 的 persona
文档，之后的回合会把它当作指令使用。

`web_fetch` 会把抓取到的网页文本标记为不可信的外部内容，并提示模型不要执行其中的指令。
这能降低风险，但不提供任何强制保证。与其依赖模型自己识别，不如限制被操纵的回合能做什么：

- 去掉任务不需要的工具，并对修改数据或访问网络的调用要求审批。见
  [工具](../build/tools.md#用-tool-policy-收窄工具集)和[权限策略](../build/permissions.md)。
- Agent 不需要管理自己的 schedule 时，禁用 `cron`；并把 `persona_doc_update` 设为 `always_ask`，
  这样 Agent 对 persona 文档的每次修改都要经过你的审查。见[权限策略](../build/permissions.md)。
- 在 custom tool 中根据你自己的用户映射授权操作，而不是根据工具输入里的值。
- Agent 能读到的地方都不放 secret。
- 不能共享数据的用户使用独立 Agent，让一个用户任务中的内容接触不到另一个用户的文件或 memory。
- 在事件日志中审查工具调用。见[审查与监控 Session](./monitor-sessions.md)。

## 同一 Agent 的 Sessions 之间共享的数据 {#data-shared-between-sessions-of-one-agent}

Session 是一段对话，不是数据边界。同一个 Agent 的所有 Sessions 共享：

- `/workspace` 文件，包括 `sandbox.scope` 为 `session` 的情况；
- Agent Database；
- `agent` scope 的 memory，以及所有不带 actor 的消息所使用的 owner `user_agent` memory；
- Agent 的配置、persona 文档和 schedule。

每个 Session 保留自己的对话历史，每个 actor 有自己的 `user_agent` memory。

如果一个 Agent 服务多个终端用户，一个用户上传的文件，或 Agent 为某个用户保存的事实，
可能出现在另一个用户的任务中。不能接受这一点时，使用[每用户一个 Agent](../build/per-user-agents.md)。
`actor.ref` 只隔离 `user_agent` memory，不隔离文件或数据库，也不授予访问权限。见
[文件隔离](../build/files.md#file-isolation)、[Agent Database](../build/data-storage.md) 和
[Memory scope](../build/memory.md#choose-a-memory-scope)。

## 工具范围过宽 {#over-broad-tools}

`tool_policy` 为空时，runtime 的默认工具面保持不变，其中包括 sandbox 命令和 web 工具。
声明 MCP Server 时不写 `toolFilter`，会暴露它的完整目录；不写 `permission` 或 `tools`，
它的调用不经审批直接执行。Agent 能调用的越多，一次错误或被操纵的决定能造成的影响就越大。

- 用 `tool_policy` 去掉任务不需要的内置工具。见
  [工具](../build/tools.md#用-tool-policy-收窄工具集)。
- 用 `toolFilter` 只暴露任务需要的 MCP 工具。见 [MCP Server](../build/mcp.md#选择-mcp-工具)。
- 对修改数据或访问其他系统的工具设置 `always_ask`；对每次调用都需要重新确认的 MCP 工具设置
  `requireConfirmation`。见[权限策略](../build/permissions.md)。
- 任务不需要 shell 命令时，去掉 `exec`。禁用 web 工具不会阻止 `exec` 访问网络，
  而 Platform key 不能修改 sandbox 的网络策略。见
  [云沙箱参考](../build/cloud-sandbox-reference.md#沙箱规格)。

## 凭据泄露 {#credential-exposure}

Agent、事件日志或你自己的日志能读到的任何地方，都可能泄露 secret：

- **放在消息或 `system.message` 中：** 它会保存在 Session 历史里。删除 Session 不会抹除已保存的记录。
- **放在指令中：** 模型每个回合都会读取，并可能在回复中复述。
- **放在 workspace 文件中：** 该 Agent 的每个 Session 都能读取，`exec` 执行的命令也能把它发送到任意主机。
- **放在工具参数或结果中：** `agent.tool` 事件会在调用开始时记录 `args`，在结束时记录 `resultPreview`。

服务凭据保存在后端，只在 custom tool 内部使用。custom tool 只返回任务需要的数据，不返回凭据本身。
Platform API key、webhook signing secret 和 Artifact 下载 URL 也是凭据：
保存在 secret 存储里，不写进日志；可能泄露时立即吊销或轮换。见
[Authentication](../get-started/authentication.md#替换或撤销-key)、
[Webhooks](../build/webhooks.md#maintain-the-endpoint) 和
[文件与产物](../build/files.md#access-urls-and-deletion)。

## 用量失控 {#cost-exhaustion}

Agent 的工作消耗组织的预付余额，组织下所有 Project 共用这笔余额。公共 API 提供用量报告，
但没有服务端强制的单 Session 花费上限。下面这些情况会让花费增长得比预期更快：

- 一个任务执行了很多模型和工具步骤，或者在用户离开后仍在继续；
- schedule 以很短的间隔触发，包括 Agent 用 `cron` 自己创建的 schedule；
- Agent 在它的 schedule 之前被删除，这些 schedule 会继续触发，而且无法再通过 API 列出或删除；
- 被注入的内容要求 Agent 启动更多工作。

控制手段：

- 按用户、按任务执行你自己的限额，用 [Usage](../reference/usage.md) 检查消耗，
  并用 [`user.interrupt`](../build/events.md#user-interrupt) 停止 run。关闭流不会停止它。
- Agent 不需要自己安排工作时禁用 `cron`，定期列出 schedule，并暂停不在预期内的。见
  [Schedules](../build/schedules.md#enable-pause-and-delete)。
- 要停止一个 Agent 的所有工作，停止该 Agent：这会取消它正在运行的工作，并阻止新的 Sessions。
  删除 Agent 之前先删除它的 schedule。见[停止与删除](../build/agents.md#停止与删除)。

## 相关 {#related}

- [保护你的部署](./secure-deployment.md)：把本页的控制手段整理成按优先级排列的清单。
- [审查与监控 Session](./monitor-sessions.md)：发现意外的工具调用和花费。
- [架构](../get-started/architecture.md)：持久化状态与托管执行如何配合。
- [当前 API 边界](../reference/not-supported.md)：公共 API 不提供的能力，以及替代做法。
