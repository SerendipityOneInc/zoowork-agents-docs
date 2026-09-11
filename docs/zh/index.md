---
title: ZooWork Managed Agents
description: 全托管的 Agent 基础设施。在持久会话中创建并运行 Agent，实时获取结果，并保留事件历史。
layout: page
sidebar: false
aside: false
source: /en/
source_hash: 2072e7432be36b6930cb6c1487af39ba55edea5ed9731f07e43c8b67c1b20b32
hero:
  text: 用 Agent 构建应用。运行交给 ZooWork。
  tagline: 全托管的 Agent 基础设施。在持久会话中创建并运行 Agent，实时获取结果，并保留事件历史。
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
    sampleMeta: 创建 Agent 和 Session · Node 22.20+
    sampleLinkText: 查看完整 Quickstart
    sampleLink: /zh/get-started/quickstart
    streamLabel: 示例 SESSION 事件
  nouns:
    title: Agent、Session、Event
    intro: 配置 Agent，创建 Session，通过 Event 跟踪执行。这三个概念将你的应用连接到托管运行时。
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
        body: 双向的基本单位。你写入四种类型，读回一份持久的、带序号的日志，
          可以从你见过的最后一个 cursor 续传。
        linkText: 事件与流式
        link: /zh/build/events
  journey:
    title: 从一把 key 到上线
    intro: 按生命周期顺序排列 —— 或者直接跳到你需要的那一页。
    stages:
      - name: 开始使用
        hint: 从 key 到第一条流式回复
        chips:
          - { text: 概览, link: /zh/get-started/overview, icon: compass }
          - { text: 快速开始, link: /zh/get-started/quickstart, icon: play }
          - { text: 核心概念, link: /zh/get-started/concepts, icon: compass }
      - name: 构建
        hint: 一个面一个面地过
        chips:
          - { text: Agents, link: /zh/build/agents, icon: agent }
          - { text: Sessions, link: /zh/build/sessions, icon: thread }
          - { text: 事件与流式, link: /zh/build/events, icon: pulse }
          - { text: Skills, link: /zh/build/skills, icon: skill }
          - { text: 工具, link: /zh/build/tools, icon: wrench }
          - { text: Environments, link: /zh/build/environments, icon: layers }
      - name: 交付给用户
        hint: 你的产品，他们各自的 agent
        chips:
          - { text: 每用户一个 agent, link: /zh/build/per-user-agents, icon: users, badge: NEW }
          - { text: 渠道, link: /zh/build/channels, icon: chat }
      - name: 知道边界在哪
        hint: 已验证、未测试、不存在
        chips:
          - { text: 能力矩阵, link: /zh/reference/capabilities, icon: table }
          - { text: 不支持的能力, link: /zh/reference/not-supported, icon: blocked }
          - { text: 错误处理, link: /zh/reference/errors, icon: alert }
          - { text: TypeScript SDK, link: /zh/reference/typescript-sdk, icon: brackets }
  band:
    title: 这里的每一条断言，要么已验证，要么被标注。
    body: 一项能力只有在真实部署上被实际跑通之后，才会被写成「可用」。其余的一律带明确标注；
      而不存在的东西会有属于它自己的一页说明它不存在，并给出真正的替代方案。
    columns:
      - title: 能力矩阵
        body: 已验证、未测试、缺失 —— 一张表，按面拆分。
        linkText: 查看矩阵
        link: /zh/reference/capabilities
      - title: 不支持的能力
        body: 自定义工具、webhook、文件上传 —— 逐条点名的缺失，每条都附上该怎么做。
        linkText: 设计前先看这里
        link: /zh/reference/not-supported
---

<ZcHome>

<template v-slot:intro>

全托管的 Agent 基础设施。在持久会话中创建并运行 Agent，实时获取结果，并保留事件历史。

</template>

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

<template v-slot:edges>

通过[概览](./get-started/overview.md)了解 ZooWork 的工作方式，或跟随[快速开始](./get-started/quickstart.md)
完成一个任务，包括结果检查与资源清理。

**客户端执行的自定义工具不存在**：没有 `{type: "custom"}` 这种工具定义，也没有
`user.custom_tool_result` 事件，所以 agent 永远不会回调进你的进程。session 级的 outcome
定义、vault、session 的 `resources[]` 挂载、平台 webhook，同样都不存在。在围绕它们做设计之前，
先读[不支持的能力](./reference/not-supported.md)。

</template>
</ZcHome>
