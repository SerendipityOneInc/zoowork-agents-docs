---
title: 架构
description: 了解 Managed Agents API 如何连接应用、模型、工具与隔离执行环境，以及状态持久保存、计算按需启停的工作方式。
source: /en/get-started/architecture
source_hash: 044357d986e25131456a18e7f7d2f6c089c27952a7cd329f2dd7a2353378643b
---

# 架构

**Managed Agents API** 为你的应用提供持久化 Agent 和托管执行能力。
你定义 Agent 要做什么、发送消息并接收事件。API 负责模型与工具的执行循环、会话状态和沙箱生命周期。

## 应用与托管执行

![应用向 Managed Agents API 发送消息并接收 SSE 事件。API 管理会话和上下文，调用模型推理，在隔离沙箱内执行代码和文件操作，并连接外部工具。](https://assets.yesy.site/f/images/2026/09/qdvtaf6e.png)

[查看架构图原图](https://assets.yesy.site/f/images/2026/09/qdvtaf6e.png)

应用通过 TypeScript SDK 或 HTTP 接入。两者使用相同的 API，以及相同的 Agent、Session 和 Event 资源。

| 组件 | 职责 |
|---|---|
| **你的应用** | 定义 Agent 指令与可用工具，建立 Agent 与用户的对应关系，发送消息并展示结果。 |
| **Managed Agents API** | 维护会话和上下文，协调模型与工具调用，管理执行，保存并流式返回事件。 |
| **模型** | 在 Agent 配置范围内生成回复、选择工具调用。 |
| **沙箱** | 为代码、命令和文件操作提供隔离执行环境。 |
| **外部工具** | 连接已配置的 MCP Server 和服务，遵循各自的访问要求。 |

例如，[快速开始](./quickstart.md)让 Agent 生成一份销售报告。
模型选择工具，沙箱写入并读取 `report.md`，应用通过 Session 事件流接收进度和回复。

API 在执行过程中持续保存事件。应用可以读取历史、重新连接事件流，无需新建 Session。
`run.finished` 表示一个回合结束，Session 仍可接收下一条消息。详见[事件与流式](../build/events.md)。

## 状态持久保存，计算按需启停

Agent 的状态与计算具有独立的生命周期。会话和工作文件可以跨越多次沙箱执行持续保留，
因此 Agent 可以执行任务、等待，再继续工作，无需让沙箱始终处于运行状态。

![Agent 与 Session 状态、工作区文件持续保留；沙箱计算沿时间线经历运行、暂停、运行、暂停，按照生命周期策略暂停，并在需要时恢复。](https://assets.yesy.site/f/images/2026/09/9b1wf1tq.png)

[查看计算生命周期原图](https://assets.yesy.site/f/images/2026/09/9b1wf1tq.png)

| 层次 | 沙箱暂停时 |
|---|---|
| **Agent 与 Session 状态** | Agent 配置、会话历史和已保存的事件仍然可用。 |
| **工作区文件** | 持久化工作区中的文件独立于活跃计算保存。 |
| **沙箱计算** | 按照生命周期策略暂停，在需要时恢复执行。 |

Agent 生成 `report.md` 后，可以等待你的下一条消息。当你让它补充预测时，
它可以使用已有会话和工作区文件，恢复工具执行。应用继续使用同一个 Agent 和 Session。

::: info 沙箱生命周期
自动暂停和恢复由托管运行时管理。暂停遵循沙箱生命周期策略，`run.finished` 不表示计算会立即暂停。
主动停止 Agent 会释放沙箱，与自动暂停是不同的操作。
此处生命周期描述经过源码核对，不构成经过线上验证的时延或性能保证。
:::

## 配置与隔离

**Agent** 定义指令、模型、工具和 Skills。**Session** 保存与该 Agent 的一段会话。
可选的 **Environment** 提供沙箱依赖、文件和网络策略；开始时使用默认 Environment 即可。

默认情况下，同一 Agent 的多个 Session 共享沙箱和工作区。
如果应用需要隔离不同用户的工作区，请为[每个用户创建独立 Agent](../build/per-user-agents.md)。

[能力矩阵](../reference/capabilities.md)记录各项能力的验证状态；公共 API 缺口单独列在[不支持的能力](../reference/not-supported.md)中。

## 下一步

- [核心概念](./concepts.md)：Agent、Session、Event 资源及其生命周期。
- [工具](../build/tools.md)：配置 Agent 可以执行或访问的能力。
- [Environments](../build/environments.md)：准备自定义依赖和网络规则。

## 检查你的理解

::: details 回合结束后，Session 也结束了吗？
没有。`run.finished` 记录一个回合的结果。你可以发送新消息继续同一个 Session，也可以稍后读取已保存的历史。
:::

::: details 沙箱暂停后，会丢失会话或工作区文件吗？
不会。Session 历史、持久化工作区文件和活跃计算具有独立的生命周期。
自动暂停让执行进入等待，同时保留这些状态。
:::

::: details 每个 Session 都有独立的工作区吗？
默认没有。同一个 Agent 的多个 Session 共享工作区。需要隔离不同用户的工作区时，应创建独立的 Agent。
:::
