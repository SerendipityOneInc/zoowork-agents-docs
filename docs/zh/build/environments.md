---
title: Environments
description: 了解默认托管 Environment，以及当前自定义 Environment 管理的限制。
source: /en/build/environments
source_hash: 87bb0d9cd9ea8a9707f09d2911f61f690c9336e81131e85a363571f1cad1558d
---

# Environments

Environment 定义云端 sandbox 的软件、镜像文件、构建步骤和网络策略。
Agent 使用托管的默认 Environment，因此无需先创建 Environment 就能运行任务。

## API 可用范围 {#api-availability}

在 [ZooWork Platform](https://platform.zoowork.ai) 创建的 Platform API key，目前不能创建、
列出或管理自定义 Environment。Environment 管理请求返回 `404 service_api.not_found`。
SDK 中的 Environment 方法不会改变这个访问限制。

按[快速开始](../get-started/quickstart.md)使用默认 sandbox。
API key 的配置和范围见[鉴权](../get-started/authentication.md)。

## 使用默认 Environment {#一个-environment-里有什么}

创建 Agent 时，省略 `environment_id` 和 `environment_version`。
Agent 会解析并固定托管的默认 Environment。Session 使用其所属 Agent 的 Environment，
不接受单独的 Environment ID。

默认镜像包含[云沙箱参考](./cloud-sandbox-reference.md)列出的编程语言、文档库、实用工具和浏览器。
依赖额外软件前，先检查这份清单。

任务文件保存在 `/workspace`。让 Agent 使用文件工具创建文件，再按[文件与产物](./files.md)发布并获取结果。
修改运行中的 sandbox 不会创建 Environment version。
运行时安装的软件不保证在 sandbox 替换后仍然存在。

## 自定义镜像构建 {#构建状态}

Platform API key 不能管理自定义包列表、镜像文件上传、构建脚本、网络策略配置和版本构建。
受支持的 Platform 流程中，没有需要轮询的自定义 Environment 构建。

任务需要特定依赖或服务配置时，在自己的后端执行该操作，再通过
[应用执行的工具](./tools.md#应用执行的自定义工具)或 [MCP](./mcp.md)提供给 Agent。

## 相关文档 {#related}

- [云沙箱参考](./cloud-sandbox-reference.md)：查看默认软件。
- [文件与产物](./files.md)：创建文件并获取已发布的输出。
- [当前 API 边界](../reference/not-supported.md)：查看其他不可用流程。
