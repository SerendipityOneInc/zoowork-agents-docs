---
description: 理解 ZooWork Managed Agents 的核心资源、执行流程与适用场景。
source: /en/get-started/overview
source_hash: a6da010804dd0cb91949de35a8b817ff6b9f770c70c7b5d05bb3f60223df6e91
---

# ZooWork Managed Agents 概览

ZooWork Managed Agents 提供托管的 Agent runtime，让 Agent 使用模型和工具完成任务。
定义 Agent、发送任务，再通过 TypeScript SDK、Python SDK 或 HTTP API 接收进度和结果。

你的应用提供指令、业务工具和用户访问检查。ZooWork 管理模型与工具循环、对话历史、
sandbox 执行和持久化事件。先在 ZooWork Platform [创建 API key 并充值](./authentication.md)，再跟随[快速开始](./quickstart.md)完成一个报告任务。

## 核心概念

Managed Agents 使用四种资源：

| 概念 | 含义 |
|---|---|
| **Agent** | 可复用的指令、模型配置、工具和 Skills，具有 start/stop 生命周期和持久化 workspace。 |
| **Environment** | sandbox 的软件包、文件和网络策略。Agent 使用托管的默认 sandbox；Platform key 目前不能管理自定义 Environment。 |
| **Session** | 属于一个 Agent 的持久化对话。向同一个 Session 发送消息，可以继续对话。 |
| **Event** | Session 中的消息或执行更新，包括回复、工具活动和 turn 完成事件。 |

例如，报告 Agent 可以有一个用于销售报告的 Session。请求、工具活动和回复记录为 Events。
同一个 Agent 的 Sessions 默认共享 workspace；用户需要独立 workspace 时，使用
[每用户一个 Agent](../build/per-user-agents.md)。

## 工作流程

1. **定义并启动 Agent。** 配置指令和工具，再启动 Agent，使它能够接收 Sessions。
2. **启动 Session。** 创建对话，并提供第一条用户消息。
3. **发送事件并读取流式响应。** ZooWork 执行模型和工具，应用接收回复、工具进度和 run 完成事件。
4. **继续或中断执行。** 向同一个 Session 发送后续消息，或显式中断执行。仅关闭 stream 不会停止 run。

`run.finished` 表示一次 run 结束。在展示任务完成之前，需要检查 termination 字段；
run 可能因等待后续工作而 yield。详见[事件与流式响应](../build/events.md)。

对话历史和 workspace 文件的生命周期独立于活跃的 sandbox compute。
[架构](./architecture.md)解释持久化状态与托管执行之间的关系。
[Agent 轨迹](./trajectories.md)解释应用如何将执行记录用于评估。

## 适用场景

Managed Agents 适合需要以下能力的应用：

- **多步骤任务：** 让 Agent 选择并执行工具，生成和检查结果。
- **托管 Cloud 执行：** 运行代码和文件操作，无需自行构建 sandbox 基础设施。
- **持久化对话：** 使用已有对话历史和 workspace 文件继续任务。
- **异步进度：** 通过持久化事件、流式响应或 Webhooks 跟踪执行。
- **定时任务：** 使用 Schedules 按配置的节奏执行任务。

## 配置能力

选择[内置工具或应用执行的工具](../build/tools.md)，连接 [MCP Server](../build/mcp.md)，
设置[权限策略](../build/permissions.md)，并挂载 [Skills](../build/skills.md)。
[云沙箱参考](../build/cloud-sandbox-reference.md)说明默认执行环境。

公共资源的访问取决于可用路由和服务配置。依赖某项流程之前，先阅读
[可用性与限制](../reference/capabilities.md)。

## 下一步

- [快速开始](./quickstart.md)：获取 API key 并完成第一个任务。
- [迁移](./migration.md)：将应用管理的 agent loop 迁移到 Managed Agents。
- [Agent 配置](../build/agents.md)：定义并管理可复用的 Agent。
- [启动 Session](../build/sessions.md)：分配任务并继续对话。
- [Session 操作](../build/session-operations.md)：读取执行状态并管理已保存的对话。
