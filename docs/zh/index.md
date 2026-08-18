---
title: ZooClaw Managed Agents
layout: home
source: /en/
source_hash: e1bde3bcacf54d69303c46ad5d58adc293d54835e606086b075cef45afd96f4c
hero:
  text: 跑在我们基础设施上的 Agent
  tagline: 建 agent、启动、开会话、把持久化的事件流回来。一个 API key，一个 TypeScript SDK。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/get-started/quickstart
    - theme: alt
      text: 能力矩阵
      link: /zh/reference/capabilities
features:
  - title: 断线可续传的事件流
    details: 每一个 SSE 帧都在 id 行里带一个 session 内持久的 seq。断了就用 after 查询参数重连，服务端从那一点开始重放，你不用重新拉一遍历史再去重。
  - title: 一个 API key 走完整个生命周期
    details: 建 agent、启动、改配置、跑会话、打断、停机、删除。
  - title: 带外注入 system.message
    details: 往正在跑的会话里塞一条 system.message，模型下一轮就把它读进上下文——不占掉一个用户回合。
  - title: 一个客户端，两种线格式
    details: 同一个事件，REST 返回 snake_case、SSE 返回 camelCase，两边都不带顶层 type 字段。SDK 把两种都归一成一个 SessionEvent。
---

::: warning Developer Preview
本 API 处于 Developer Preview 阶段，正式可用前仍可能变更。路由存在、但我们没有驱动过的地方，页面上会挂一个「尚未验证」的标记；没有标记的，都是在一套真实部署上实测过的。
:::

## 从哪开始

1. [快速开始](/zh/get-started/quickstart) —— 从一个 key 到第一条流式回复，包含 `startAgent()` 这一步
2. [事件与流式](/zh/build/events) —— 事件词汇表、用 `after` 续流，以及 `listEvents` 为什么会在长会话上静默截断
3. [能力矩阵](/zh/reference/capabilities) —— 哪些实测跑通、哪些只是路由存在、哪些没有

## 你会拿到什么

**Agent** —— 持久化、带版本的配置对象：name、model、persona、skills、tool policy。新建出来的 agent 带的是 `status.desired_state === 'stopped'`，所以你必须先调 `startAgent()`，它才会接受 session。等 `status.desired_state`，永远不要等 `status.actual_state` —— `running` 根本不在它的取值里，那个循环永远不会返回。

**Session** —— 一段对话，作为 agent 的子资源创建：`POST /agents/{id}/sessions`，SDK 里是 `createSession(agentId, input)`。它持有整份 transcript，也是你写入或读取的每一个事件的作用域。没有顶层的 session 集合。

**Event** —— 两个方向上的最小单位。你写入四种：`user.message`、`user.interrupt`、`system.message`、`user.tool_confirmation`；读回来的是一份持久的、按 `seq` 排序的日志，记着 agent 做过什么（`run.started`、`agent.thinking`、`agent.assistant`、`agent.tool`、`run.finished`）。一个回合结束于 `run.finished`，它的 `payload.status` 是 `succeeded`、`failed` 或 `aborted`。流本身是 session 作用域的，回合结束并不会把它关掉。

## 这里没有什么

**客户端执行的自定义工具不存在** —— 没有 `{type: "custom"}` 工具定义，没有 `user.custom_tool_result`，agent 不会回调你的进程。session 级的 outcome 定义、凭据保险库、session 的 `resources[]` 挂载、平台 webhook 也都没有。在你围绕其中任何一条做设计之前，先读[不支持的能力](/zh/reference/not-supported)。
