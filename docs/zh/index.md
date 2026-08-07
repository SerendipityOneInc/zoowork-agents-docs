---
layout: home
source: /en/
source_hash: pending
hero:
  name: ZooClaw Managed Agents
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
    details: 每一帧都带持久的 seq。断了就用 ?after=<seq> 重连，服务端从那里继续放——不丢、不重。
  - title: 一个 API key 走完整个生命周期
    details: 建 agent、启动、开会话、流式读取、停机、删除，全部一套凭证。模型凭证由网关代种，你不用管。
  - title: 带外注入 system.message
    details: 在两轮之间往会话里塞一条运营侧的说明，模型下一轮就能读到——不占用户消息的位置。
  - title: 一个客户端，两种线格式
    details: REST 返回 snake_case、SSE 返回 camelCase，同一个事件两种拼写。SDK 归一成一个 SessionEvent。
---

::: warning Developer Preview
本 API 处于 Developer Preview 阶段，正式可用前仍可能变更。
:::

## 你会拿到什么

**Agent** —— 持久化、带版本的配置对象。建一次，之后一直用 `agent_id` 引用。

**Session** —— 挂在某个 agent 下的一段持久会话。历史存在服务端，你不需要自己维护上下文窗口。

**Event** —— 会话里发生的一切的最小单位。只追加、按 `seq` 持久排序。你写入四种，读取的种类更多。

## 这里没有什么

**客户端执行的自定义工具不存在** ——没有 `{type: "custom"}` 工具定义，没有 `user.custom_tool_result`，agent 不会回调你的进程。如果你的产品形态是「agent 调用我的函数、我查我的数据库再把结果还回去」，请先读[不支持的能力](/zh/reference/not-supported)，那里列了完整清单和每一条的替代路径（有些是「没有替代」）。

## 从哪开始

1. [快速开始](/zh/get-started/quickstart) —— 五分钟跑通一轮完整对话
2. [事件与流式](/zh/build/events) —— 整套文档里最该读透的一页
3. [能力矩阵](/zh/reference/capabilities) —— 哪些实测跑通、哪些只是路由存在、哪些没有
