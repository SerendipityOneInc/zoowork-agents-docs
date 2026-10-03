---
title: ZooWork Managed Agents
description: 让 Agent 在你的应用中完成实际任务。ZooWork 托管任务执行并保留运行记录，帮助你理解结果、持续改进 Agent。
layout: page
sidebar: false
aside: false
source: /en/
source_hash: c78fd3f38a2da633497d7af7decb922570f13239ffbe61c4ff2031766c122513
hero:
  text: 用 Agent 构建应用。运行交给 ZooWork。
  tagline: 让 Agent 在你的应用中完成实际任务。ZooWork 托管任务执行并保留运行记录，帮助你理解结果、持续改进 Agent。
home:
  hero:
    accent: 运行交给 ZooWork。
    actions:
      - text: 快速开始
        link: /zh/get-started/quickstart
        theme: primary
      - text: 概览
        link: /zh/get-started/overview
      - text: TypeScript SDK
        link: /zh/reference/typescript-sdk
        theme: text
    sampleTabsLabel: SDK 语言
    samples:
      - id: typescript
        label: TypeScript
        install: npm i @zoowork-ai/sdk
        meta: 创建 Agent 和 Session · Node.js 22.20+
      - id: python
        label: Python
        install: python -m pip install zoowork
        meta: 创建 Agent 和 Session · Python 3.10+
    sampleLinkText: 查看完整 Quickstart
    sampleLink: /zh/get-started/quickstart
    streamLabel: 示例 SESSION 事件
  nouns:
    title: Agent、Session、Event
    intro: 配置 Agent，创建 Session，通过 Event 跟踪执行。ZooWork 提供用于执行任务的托管 sandbox。
    items:
      - name: Agent
        id: agt_
        body: 一份持久的、带版本的配置 —— 模型、persona、skills、tool policy。
          它创建出来是停止状态，要先 start，它才会接受 session。
        linkText: Agents
        link: /zh/build/agents
      - name: Session
        id: opaque id
        body: 一次对话，作为某个 agent 的子资源创建。它持有 transcript，
          并且是你写入或读取的每一个事件的作用域。
        linkText: Sessions
        link: /zh/build/sessions
      - name: Event
        id: seq
        body: 双向的基本单位。你写入五种类型，读回一份持久的、带序号的日志，
          可以从你见过的最后一个 cursor 续传。
        linkText: 事件与流式
        link: /zh/build/events
  journey:
    title: 从 API key 到任务执行
    intro: 在 ZooWork Platform 创建 API key 并充值，再运行第一个任务。
    stages:
      - name: 开始使用
        hint: 获取 key、充值，再运行第一个任务
        chips:
          - { text: Authentication 与 API key, link: /zh/get-started/authentication, icon: key }
          - { text: 概览, link: /zh/get-started/overview, icon: compass }
          - { text: 快速开始, link: /zh/get-started/quickstart, icon: play }
          - { text: 架构, link: /zh/get-started/architecture, icon: layers }
          - { text: Agent 轨迹, link: /zh/get-started/trajectories, icon: pulse }
          - { text: 迁移, link: /zh/get-started/migration, icon: layers }
      - name: 定义 Agent
        hint: 配置指令与能力
        chips:
          - { text: Agent 配置, link: /zh/build/agents, icon: agent }
          - { text: 工具, link: /zh/build/tools, icon: wrench }
          - { text: MCP Server, link: /zh/build/mcp, icon: brackets }
          - { text: 权限策略, link: /zh/build/permissions, icon: key }
          - { text: Skills, link: /zh/build/skills, icon: skill }
      - name: 了解 Cloud sandbox
        hint: 查看托管执行环境
        chips:
          - { text: 云沙箱参考, link: /zh/build/cloud-sandbox-reference, icon: brackets }
      - name: 向 Agent 分配任务
        hint: 发送任务并观察执行
        chips:
          - { text: 启动 Session, link: /zh/build/sessions, icon: thread }
          - { text: Session 操作, link: /zh/build/session-operations, icon: layers }
          - { text: 事件与流式, link: /zh/build/events, icon: pulse }
          - { text: Webhooks, link: /zh/build/webhooks, icon: pulse }
      - name: 管理 Agent context
        hint: 提供输入并读取结果
        chips:
          - { text: 文件与产物, link: /zh/build/files, icon: layers }
          - { text: Agent Database, link: /zh/build/data-storage, icon: brackets }
      - name: 构建持久化 Memory
        hint: 保存与读取 Agent memory
        chips:
          - { text: Memory, link: /zh/build/memory, icon: layers }
      - name: 高级编排
        hint: 运行周期任务
        chips:
          - { text: Schedules, link: /zh/build/schedules, icon: play }
      - name: 集成到产品
        hint: 为用户提供独立 workspace
        chips:
          - { text: 每用户一个 Agent, link: /zh/build/per-user-agents, icon: users }
      - name: 参考
        hint: 查询 API 行为与可用性
        chips:
          - { text: Authentication, link: /zh/get-started/authentication, icon: key }
          - { text: TypeScript SDK, link: /zh/reference/typescript-sdk, icon: brackets }
          - { text: Python SDK, link: /zh/reference/python-sdk, icon: brackets }
          - { text: Models, link: /zh/reference/models, icon: layers }
          - { text: Usage, link: /zh/reference/usage, icon: pulse }
          - { text: 错误处理, link: /zh/reference/errors, icon: alert }
          - { text: 可用性与限制, link: /zh/reference/capabilities, icon: layers }
  band:
    title: Agent 配置一次，通过 Session 持续工作。
    body: Agent 配置描述模型、指令、工具、Skills 和运行环境。Session 分别保存每次对话及其事件历史。
    columns:
      - title: 定义能力
        body: 选择内置工具、连接 MCP Server，并挂载可复用的 Skills。
        linkText: 配置工具
        link: /zh/build/tools
      - title: 运行并观察
        body: 创建 Session、发送消息，再消费持久化事件流。
        linkText: 创建 Session
        link: /zh/build/sessions
---

<ZcHome>

<template v-slot:intro>

让 Agent 在你的应用中完成实际任务。ZooWork 托管任务执行并保留运行记录，帮助你理解结果、持续改进 Agent。

先在 [ZooWork Platform](https://platform.zoowork.ai) [创建 API key 并充值](./get-started/authentication.md)，再跟随[快速开始](./get-started/quickstart.md)。

</template>

<template v-slot:sample-typescript>

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const client = createZooworkClient()
const agent = await client.createAgent({
  resource: { name: 'quickstart-agent' },
})
await client.startAgent(agent.agent_id)

const session = await client.createSession(agent.agent_id, {
  initial_events: [{
    type: 'user.message',
    content: 'What can you do?',
  }],
})
```

</template>

<template v-slot:sample-python>

```python
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        agent = await client.create_agent({"name": "quickstart-agent"})
        await client.start_agent(agent["agent_id"])
        await client.create_session(agent["agent_id"], {
            "initial_events": [{
                "type": "user.message",
                "content": "What can you do?",
            }],
        })

asyncio.run(main())
```

</template>

<template v-slot:edges>

通过[概览](./get-started/overview.md)了解 ZooWork 的工作方式，或跟随[快速开始](./get-started/quickstart.md)
完成一个任务，包括结果检查与资源清理。

添加能力时，内置工具和应用执行的工具见[工具](./build/tools.md)，远程工具见
[MCP Server](./build/mcp.md)，需要让工具调用等待审批时见[权限策略](./build/permissions.md)。
在产品中展示执行进度和结果，见[事件与流式](./build/events.md)。

用[文件与产物](./build/files.md)和 [Agent Database](./build/data-storage.md) 管理任务 context。用 [Memory](./build/memory.md) 保存与读取持久化记忆，默认执行环境见[云沙箱参考](./build/cloud-sandbox-reference.md)。各流程的使用条件见[可用性与限制](./reference/capabilities.md)。

</template>
</ZcHome>
