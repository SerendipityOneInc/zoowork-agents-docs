---
title: ZooWork Managed Agents
layout: page
pageClass: zc-home-page
sidebar: false
aside: false
source: /en/
source_hash: 40ae02a7a6991bcf2cf031f454f94fc341bf205b4ffae1494d163a7fd9bdc94a
hero:
  text: 创建一个 agent，streaming 拿回每一个事件。
  tagline: 一个由你自己的代码驱动的托管 agent 运行时。可续传的持久事件流；skills、sessions
    与聊天渠道；一个 API key，一个 TypeScript SDK。
home:
  hero:
    accent: streaming 拿回每一个事件。
    actions:
      - text: 快速开始
        link: /zh/get-started/quickstart
        theme: brand
      - text: TypeScript SDK
        link: /zh/reference/typescript-sdk
      - text: 能力矩阵
        link: /zh/reference/capabilities
    note: API key 由你所在组织的管理员发放 —— 没有自助注册入口。
  panel:
    tab: quickstart.ts
    streamLabel: SESSION EVENT STREAM
    rows:
      - { seq: 'seq 1', type: run.started }
      - { seq: 'seq 2', type: agent.thinking }
      - { seq: 'seq 3', type: agent.assistant, detail: '"I can research topics and…"' }
      - { seq: 'seq 4', type: agent.tool, detail: 'web_search · start → end' }
      - { seq: 'seq 5', type: run.finished, detail: succeeded }
  nouns:
    title: 四个名词撑起整套 API
    intro: SDK 做的每一件事，都是作用在这四者之一上的动词。把它们学一遍，之后每一页参考文档都能自己读懂。
    items:
      - name: Agent
        id: agt_
        body: 一份持久的、带版本的配置 —— 模型、persona、skills、tool policy。
          它创建出来是停止状态，要先 start，它才会接受 session。
        linkText: Agents
        link: /zh/build/agents
      - name: Session
        id: ses_
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
      - name: Skill
        id: skl_
        body: registry 里的一份打包能力，版本独立于任何 agent。
          不钉版本地安装它，一次发布就会到达每一个装了它的 agent。
        linkText: Skills
        link: /zh/build/skills
  journey:
    title: 从一把 key 到上线
    intro: 按生命周期顺序排列 —— 或者直接跳到你需要的那一页。
    stages:
      - name: 开始使用
        hint: 从 key 到第一条流式回复
        chips:
          - { text: 快速开始, link: /zh/get-started/quickstart, icon: play }
          - { text: 鉴权, link: /zh/get-started/authentication, icon: key }
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
    body: 一项能力只有在真实部署上被实际跑通之后，才会被写成"可用"。其余的一律带明确标注；
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

```ts
import {
  createZooworkClient, assistantText, isRunFinished,
} from '@zoowork-ai/sdk'

const zc = createZooworkClient() // reads ZOOWORK_API_KEY

const { agent_id } = await zc.createAgent({
  resource: {
    name: 'quickstart-agent',
    model: { primary: 'litellm/claude-sonnet-5' },
  },
})
await zc.startAgent(agent_id)
await zc.waitUntilRunning(agent_id)

const { session_id } = await zc.createSession(agent_id, {
  initial_events: [{ type: 'user.message', content: 'Hi' }],
})

for await (const ev of zc.streamEvents(agent_id, session_id)) {
  process.stdout.write(assistantText(ev))
  if (isRunFinished(ev)) break
}
```

<template v-slot:edges>

**客户端执行的自定义工具不存在**：没有 `{type: "custom"}` 这种工具定义，也没有
`user.custom_tool_result` 事件，所以 agent 永远不会回调进你的进程。session 级的 outcome
定义、vault、session 的 `resources[]` 挂载、平台 webhook，同样都不存在。在围绕它们做设计之前，
先读[不支持的能力](/zh/reference/not-supported)。

</template>
</ZcHome>
