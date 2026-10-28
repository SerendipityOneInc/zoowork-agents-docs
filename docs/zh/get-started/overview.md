---
description: 对比 Managed Agents 与自建 agent loop，了解核心资源、支持的工具、执行流程、预览状态和计费。
source: /en/get-started/overview
source_hash: 8998b97d7af4d5f3773b3c9bc0e5f7d09af1528b1116ff5750d40e91770cf174
---

# ZooWork Managed Agents 概览

ZooWork Managed Agents 提供托管的 Agent runtime，让 Agent 使用模型和工具完成任务。
定义 Agent、发送任务，再通过 TypeScript SDK、Python SDK 或 HTTP API 接收进度和结果。

你的应用提供指令、业务工具和用户访问检查。ZooWork 管理模型与工具循环、对话历史、
sandbox 执行和持久化事件。先在 ZooWork Platform [创建 API key 并充值](./authentication.md)，再跟随[快速开始](./quickstart.md)完成一个报告任务。

## Managed Agents 与自建 agent loop

如果你的应用调用模型、执行模型返回的工具调用，并自己保存历史，那么你维护的是一个 agent loop。
Managed Agents 替你运行这个 loop。

| | 自建 agent loop | ZooWork Managed Agents |
|---|---|---|
| **是什么** | 应用调用模型、执行工具，再把结果发回模型 | 托管 runtime，为可复用的 Agent 运行模型与工具循环 |
| **你负责运行** | 模型调用、工具执行器、sandbox 基础设施和对话存储 | 业务工具、用户访问检查，以及结果如何展示 |
| **适合** | 需要精细控制每一次模型请求 | 多步骤任务、在 sandbox 中处理代码和文件，以及在请求返回后继续执行的任务 |

[将 agent loop 迁移到 Managed Agents](./migration.md) 逐项对照了职责划分。

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

## 支持的工具

Agent 通过工具完成工作。有的工具在托管 sandbox 或平台服务中运行，有的在你的后端或你接入的服务中运行。

| 能力 | 工具或机制 | 指南 |
|---|---|---|
| sandbox 文件与命令 | `read`、`write`、`edit`、`apply_patch`、`exec`、`process` | [工具](../build/tools.md)、[云沙箱参考](../build/cloud-sandbox-reference.md) |
| 网页搜索与抓取 | `web_fetch`、`web_search`、`web_image_search` | [工具](../build/tools.md) |
| PDF 与图片 | `pdf`、`image` | [图像与 PDF 工具](../build/tools.md#图像与-pdf-工具) |
| 输出文件 | `artifact_publish`；把输入文件上传到 `/workspace` | [文件与产物](../build/files.md) |
| 长期事实 | Memory 工具（启用时） | [Agent Memory](../build/memory.md) |
| 结构化数据 | `agent_db` | [Agent Database](../build/data-storage.md) |
| 你的业务操作 | 应用执行的 custom tools | [自定义工具](../build/tools.md#应用执行的自定义工具) |
| 外部服务 | 公开的远程 MCP server | [MCP Server](../build/mcp.md) |
| 可复用的指令 | Skills | [Skills](../build/skills.md) |

用 `tool_policy` 收窄工具集，用[权限策略](../build/permissions.md)要求调用前审批。
即使工具在这张表里，缺少对应服务或部署支持时仍然可能不可用。依赖某项流程之前，先阅读
[可用性与限制](../reference/capabilities.md)。

## 预览状态与计费

API 目前处于 Developer Preview。同一版本内响应可能增加字段，应用应忽略无法识别的字段和
事件类型，而不是直接报错。

Agent 任务从组织的预充值余额中扣费，组织内所有 Project 共用这份余额。
[Usage](../reference/usage.md) 以 Platform credits 报告消耗。Usage 只是报告，不是花费上限：
公共 API 没有服务端强制执行的 per-Session 花费上限，应用需要自己执行策略，必要时
[中断任务](../build/events.md#user-interrupt)。余额和实际扣费请在
[ZooWork Platform](https://platform.zoowork.ai) 查看。

## 下一步

- [快速开始](./quickstart.md)：获取 API key 并完成第一个任务。
- [迁移](./migration.md)：将应用管理的 agent loop 迁移到 Managed Agents。
- [Agent 配置](../build/agents.md)：定义并管理可复用的 Agent。
- [启动 Session](../build/sessions.md)：分配任务并继续对话。
- [Session 操作](../build/session-operations.md)：读取执行状态并管理已保存的对话。
