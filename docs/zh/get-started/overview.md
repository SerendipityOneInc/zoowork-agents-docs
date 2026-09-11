---
description: 了解 ZooWork Managed Agents 提供什么、适用于哪些任务，以及 Agent、Session 和 Event 如何协作。
source: /en/get-started/overview
source_hash: 9ff8757a8f63c44f4c75b5e15e0d3a0a8059b9d3156e6e700837f536784653ba
---

# ZooWork Managed Agents 概览

ZooWork Managed Agents 让你通过 TypeScript SDK 或 HTTP API，在自己的应用中运行 Agent。
Agent 可以使用工具完成任务，例如写入文件、运行命令，或调用已配置的外部服务。

你定义 Agent 的指令和可用工具、发送任务，并向用户展示结果。
ZooWork 负责模型与工具调用循环、对话历史、沙箱执行和事件存储。
你的应用通过事件流获取执行进度和回复。

要运行第一个任务，请前往[快速开始](./quickstart.md)。

## 适用场景

当你的应用需要以下能力时，可以使用 Managed Agents：

- **委派多步骤任务。** 让 Agent 选择并调用工具完成工作，例如生成并检查一份报告。
- **继续对话。** 在同一个 Session 中发送后续消息，沿用已保存的对话历史。
- **跟踪执行过程。** 展示回复和工具执行进度，读取已保存的事件，并重新连接事件流。
- **在托管沙箱中运行代码和操作文件。** 配置 Agent，无需自行搭建工具执行基础设施。

## 核心概念

| 概念 | 含义 |
|---|---|
| **Agent** | 可复用的配置，包含指令、模型选择、工具和 Skills，并具有启动、停止的生命周期。 |
| **Session** | 属于某个 Agent 的持久对话。发送下一条消息即可继续这次对话。 |
| **Event** | 保存在 Session 中的消息或执行更新，包括回复、工具活动和回合结束。 |

例如，一个配置为编写报告的 Agent，可以在一个 Session 中处理销售报告。
你的请求、它的工具执行过程和回复，都会作为 Event 出现在这个 Session 中。
资源细节和生命周期见[核心概念](./concepts.md)。

## 工作流程

1. **创建并启动 Agent。** 定义配置，然后启动 Agent，使它可以接受 Session。
2. **创建 Session。** 与这个 Agent 开始一次对话。
3. **发送消息。** 描述你希望它完成的任务。
4. **读取事件流。** ZooWork 执行模型与工具调用；你的应用收到回复、工具活动，以及携带本回合结果的 `run.finished` 事件。
5. **继续对话。** 向同一个 Session 发送下一条消息。回合结束后，对话历史仍然可用。

默认沙箱由平台按需管理。完成第一个任务不需要单独创建 Environment。
执行过程与持久状态的详细说明见[架构](./architecture.md)。

## 配置 Agent

- [Agents](../build/agents.md)：配置指令和模型选择。
- [工具](../build/tools.md)：控制内置工具并连接 MCP 服务器。
- [Skills](../build/skills.md)：添加可复用的任务指令与资源。
- [Environments](../build/environments.md)：定制沙箱依赖和网络规则。

同一个 Agent 下的 Session 默认共享工作区。需要隔离不同用户的工作区时，
请参阅[每用户一个 Agent](../build/per-user-agents.md)。

## 下一步

- [快速开始](./quickstart.md)：创建 Agent 并完成一个报告任务。
- [TypeScript SDK](../reference/typescript-sdk.md)：查阅客户端方法和选项。
- [能力矩阵](../reference/capabilities.md)：确认支持范围与验证状态。
