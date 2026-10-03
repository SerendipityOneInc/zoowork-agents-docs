---
description: 核对当前公共API边界，为secrets、集成、budget和self-hosting选择已有方案。
source: /en/reference/not-supported
source_hash: 5e9413061e3f66e5aa7d89c0c6679f93338267682976e96feea13c35e5d01b92
---

# 当前公共 API 边界

依赖其他 Managed Agents 产品的能力前，先确认 ZooWork 有受支持的接入流程。下面只描述 ZooWork 公共 API，不推断内部工具或其他 ZooWork 产品的能力。

| 能力 | 当前边界 | 替代方案 |
|---|---|---|
| 自定义 Environment 管理 | Platform API key 不开放自定义 Environment 创建、镜像构建和版本管理。 | 使用[默认托管 Environment](../build/environments.md)。 |
| 原生聊天渠道管理 | Platform API key 不开放聊天渠道配置和管理。 | 在后端对接聊天平台，再通过 [API Session](../build/channels.md)转发消息。 |
| Skill registry 发布 | 公共 API 不开放 registry 上传、版本发布和删除。 | 配置[可见的 Skill assignment](../build/skills.md)，或在 Agent persona 文档中维护应用指令。 |
| Console Agent builder 和 Session runner | Agent 创建和 Session 执行使用 SDK 或 HTTP API。 | 使用[快速开始](../get-started/quickstart.md)和 SDK/HTTP API。 |
| 公共组织、Project 或 API-key Admin API | `/service/v1` 不提供这一管理接口。 | 在 [Platform](../get-started/authentication.md) 管理。 |
| 开箱即用的 ZooData/RAG/connector 配置 | ZooData retrieval 和 connectors 尚无已记录的公共 provisioning API。 | 用 [custom tools 或公开 MCP](../build/retrieval.md) 连接自己的服务。 |
| Credential vault 和需认证/private MCP provisioning | 公共 key 不能 provision Agent credentials，存在 credential 字段也不表示已有可用流程。 | 将服务凭证留在后端，执行 [custom tool](../build/tools.md)。 |
| 通用 binary 输入上传或全局 Files API | 尚未记录通用 binary 输入上传及 materialization 流程。 | 使用已有的[文本输入与 workspace 读取](../build/files.md)。 |
| Session 花费上限 | 公共 API 提供 Usage 查询，不提供服务端强制执行的 per-Session 花费上限。 | 查询 [Usage](./usage.md)，由应用执行策略，需要时显式[中断任务](../build/events.md#user-interrupt)。 |
| 公共 rate-limit 配置 API 或固定 quota | 公共 API contract 尚未确立。 | 对 429 做 backoff，不硬编码其他 provider 的 quota。 |
| 独立 Memory stores、mounts 或 Dreams jobs | 尚无公共管理流程。 | 在 scope 内使用已启用的 [Agent Memory 工具](../build/memory.md)。 |
| Self-hosted worker 注册或 custom sandbox provider | 尚无公共 worker/provider onboarding contract。 | 使用[托管 Cloud sandbox](../build/cloud-sandbox-reference.md)。 |
| 托管 private GitHub 连接及自动发布 PR | 公共 API 不提供托管 private GitHub connection 或自动发布 PR 的配置流程。 | 在 sandbox clone 公开仓库；私有仓库操作放到应用已认证的后端。 |
| 通用 Session Outcome 定义或 rubric resource API | Outcome 指南限于 scheduled `agentTurn`，未确立更广的 resource API。 | 使用 [Schedules](../build/schedules.md) 中的 Outcome 流程，或由应用验证结果。 |
| 公共 delegation provisioning、roster/advisor/thread API | 有 runtime delegation 不代表已有可公开配置的 Cloud 流程或 SDK orchestration 接口。 | 在公开 enablement 和 tool contract 确立前，由应用后端协调普通 Agent 和 Session。 |

## 字段不等于流程

SDK type 可以描述响应字段，但不能证明当前 key 可以调用产生该字段的 route。配置字段可以存在，但不会自动授予目标服务的权限。按 [key 的资源范围](../get-started/authentication.md)和各指南的使用条件接入。

API key 要求和工具可用性见[可用性与限制](./capabilities.md)。
