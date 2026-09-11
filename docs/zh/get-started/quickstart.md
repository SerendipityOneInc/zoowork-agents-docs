---
title: 快速开始
description: 使用 TypeScript 或 curl 创建第一个 Agent、启动会话，并流式读取回复。
source: /en/get-started/quickstart
source_hash: c859b83851e696ded47992dd0b41b5b4302bbdb86120c664d3daef9e7d7c7986
---

# 快速开始

创建一个 Agent、启动会话，并流式读取回复。本例让 Agent 把三个月的销售数据整理成报告，
保存为 `report.md`，再读回文件确认合计金额。

## 核心概念

| 概念 | 含义 |
|---|---|
| Agent | 你创建并启动的配置，包括模型、工具和 Skills。 |
| Session | 与 Agent 的一段会话，保存你的消息和它的工作过程。 |
| Events | 通过 Session 交换的消息、工具调用、回复和回合结果。 |

本例使用默认模型和沙箱，无需单独创建 Environment。
需要自定义沙箱时，可以[配置 Environment](../build/environments.md)。

## 前置条件

- 一个 ZooWork 组织 API Key（`zct_...`）。[获取 API Key](https://zoowork.ai/identity?tab=account-api-keys)。
- **TypeScript：** Node.js **22.20+** 和 npm。
- **curl：** Bash、curl **7.76+** 和 `jq` **1.6+**。

## 准备

选择 TypeScript 或 curl，按同一个标签完成本页操作。

::: code-group

```bash [TypeScript]
npm install @zoowork-ai/sdk
```

```bash [curl]
curl --version
jq --version
```

:::

在终端中设置 API Key：

```bash
export ZOOWORK_API_KEY='zct_...'
```

::: warning 保护 API Key
在服务端或本地开发电脑上运行示例。不要把 Key 放进浏览器代码或 Agent 的沙箱。
:::

**TypeScript：** 将下方 TypeScript 代码块按顺序复制到 `quickstart.mts`，包括清理代码，
最后使用页面末尾的命令运行。

**curl：** 在同一个 Bash 终端里逐块执行。确认每次请求成功后再继续，
命令会保存返回的 ID，供下一步使用。

## 创建第一个 Session

### 1. 创建 Agent

创建 Agent 并保存它的 ID。SDK 读取 `ZOOWORK_API_KEY`，默认使用公开 API 地址。
curl 示例显式设置这个地址。

::: code-group

<<< ../../snippets/quickstart.ts#create [TypeScript]

<<< ../../snippets/quickstart.sh#create [curl]

:::

curl 请求中的 `onboarding: false` 由 SDK 自动补充。

### 2. 启动 Agent

创建 Session 前，先启动 Agent。

::: code-group

<<< ../../snippets/quickstart.ts#start [TypeScript]

<<< ../../snippets/quickstart.sh#start [curl]

:::

启动错误的处理见 [Agent 生命周期](../build/agents.md)。

### 3. 创建 Session

为这次任务创建 Session，并保存返回的 `session_id`。

::: code-group

<<< ../../snippets/quickstart.ts#session [TypeScript]

<<< ../../snippets/quickstart.sh#session [curl]

:::

### 4. 发送消息并读取回复

让 Agent 生成销售报告。消息里已经包含全部数据，无需准备输入文件或外部服务。

::: code-group

<<< ../../snippets/quickstart.ts#send [TypeScript]

<<< ../../snippets/quickstart.sh#send [curl]

:::

响应中的 `events[0].accepted` 应为 `true`，表示消息已被接受。
接下来读取事件流，查看 Agent 的执行过程和结果。事件会被保存，所以即使 Agent 在你连接前
就开始工作，仍然可以读回这些进度。

::: code-group

<<< ../../snippets/quickstart.ts#stream [TypeScript]

<<< ../../snippets/quickstart.sh#stream [curl]

:::

**TypeScript** 打印回复和工具调用，在收到 `run.finished` 后关闭连接。
**curl** 显示原始事件流。看到 `event_type: "run.finished"` 后，检查 `payload.status`，
再按 **Ctrl+C** 回到终端。事件连接会等待后续回合，直到你主动关闭它。

成功回合的状态为 `succeeded`。同时，Agent 的回复应确认报告已保存，合计销售额为 **300 美元**。
工具名称和措辞可能不同，下面是示意输出；curl 仅展示部分事件字段：

::: code-group

```text [TypeScript]
[tool] exec
I saved report.md and read it back to verify the three monthly sales and the $300 total.
Turn: succeeded
```

```text [curl]
event: event
data: {"event_type":"agent.assistant","payload":{"message":{"content":[{"type":"text","text":"I saved report.md and verified total sales of $300."}]}}}

event: event
data: {"event_type":"run.finished","payload":{"status":"succeeded"}}
```

:::

::: tip 回合未成功时
如果结果为 `failed`、`aborted`，或连接在收到 `run.finished` 前关闭，
请先检查[会话历史](../build/sessions.md)再重试。仍可使用下方请求清理 Agent。
:::

## 执行过程中发生了什么

收到消息后，ZooWork 会：

1. 运行 Agent，由它决定使用哪些工具完成任务。
2. 按需创建或复用托管沙箱，在其中执行工具并保存 `report.md`。
3. 保存并流式返回执行事件。
4. 通过 `run.finished` 返回回合结果，Session 保留，可继续发送消息。

## 清理

完成示例后，先停止 Agent 以释放沙箱，再删除 Agent。请先保存需要保留的内容。
如果停止失败，解决错误后再删除。

::: code-group

<<< ../../snippets/quickstart.ts#cleanup [TypeScript]

<<< ../../snippets/quickstart.sh#cleanup [curl]

:::

使用以下命令运行拼接好的 TypeScript 示例：

```bash
node quickstart.mts
```

如果程序提前退出，使用已打印的 Agent ID 执行上面的清理请求。
curl 用户在按 Ctrl+C 关闭事件流后执行清理。

## 下一步

- [架构](./architecture.md)：了解托管执行、状态持久保存和计算按需启停。
- [Agents](../build/agents.md)：选择模型、工具和 Skills。
- [Sessions](../build/sessions.md)：继续对话、读取历史。
- [事件与流式](../build/events.md)：处理事件、超时和重新连接。
- [示例应用](https://github.com/SerendipityOneInc/zoowork-quickstarts)：构建完整应用。
- [编码助手 Skill](https://github.com/SerendipityOneInc/zoowork-sdk-skills)：为编码助手提供 ZooWork SDK 使用说明。
