---
title: 渠道
description: 了解当前渠道管理限制，并通过 API Session 接入聊天应用。
source: /en/build/channels
source_hash: c4c2ea2d20f6f2485394620eb1d59f8b755c80e1f02e4832cd32ad3f17a3a707
---

# 渠道

Channel 把聊天平台账号连接到 Agent。目前，Platform API key 不能使用托管的渠道绑定和引导式配置。

Agent 不需要渠道也能运行任务。通过应用后端使用 [API Session](./sessions.md)即可。

## 当前可用范围 {#current-availability}

在 [ZooWork Platform](https://platform.zoowork.ai) 创建的 Platform API key，不能列出、创建、
更新或移除托管渠道绑定，也不能执行扫码配置。这些请求返回 `404 service_api.not_found`。
SDK 中存在渠道方法，不表示这些路由可用。

Key 的配置见[鉴权](../get-started/authentication.md)。

## 接入自己的聊天应用 {#connect-your-chat-application}

后端可以把聊天平台接到普通 API Session：

1. 通过聊天平台自己的 API 接收消息，并认证发送者。
2. 在应用中查找该用户的 Agent 和 Session。用户不能共享持久化文件时，
   使用[每用户一个 Agent](./per-user-agents.md)。
3. 为新对话[创建 Session](./sessions.md)，或向已有 Session
   [发送事件](./events.md#user-message)。
4. 读取[事件流](./events.md#streaming-a-turn)，再通过聊天平台 API 发送 Agent 的回复。

ZooWork API key 和聊天平台凭证都保存在后端。
应用负责消息路由、用户访问检查和投递重试。
创建 API Session 不会配置托管渠道，也不会认证聊天平台账号。

## Agent 就绪状态 {#agent-readiness}

创建 API Session 前，先启动 Agent，再按[快速开始](../get-started/quickstart.md)检查
`status.desired_state` 是否为 `running`。Agent 不需要渠道就能就绪。
`status.actual_state` 和 `status.channels` 不反映渠道健康，见 [Agent 生命周期](./agents.md#agent-生命周期)。
