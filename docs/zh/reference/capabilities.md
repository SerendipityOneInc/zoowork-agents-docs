---
description: 查看 API key 要求、工具可用性与当前公共 API 限制。
source: /en/reference/capabilities
source_hash: 77205b332c29f60082f2bdc505221a5d66938a5723f3458d982668f43e3ab9e9
---

# 可用性与限制

可用功能取决于 key 的资源范围、已启用的工具和服务配置。下表列出了各项功能的指南与使用条件。

## 找到对应指南

| 任务 | 指南 | 主要条件 |
|---|---|---|
| 获取 key 并限定请求范围 | [Authentication](../get-started/authentication.md) | 在 Platform 创建 key；请求限定为 key owner 与 Project。 |
| 配置 Agent 工具和审批 | [Tools](../build/tools.md)、[权限策略](../build/permissions.md) | deployment 提供的工具和应用业务授权是不同层次。 |
| 检索私有知识 | [Retrieval](../build/retrieval.md) | 应用或 MCP 服务负责检索和数据权限。 |
| 复用任务指令 | [Skills](../build/skills.md) | 配置可见的 Skill assignment；在支持的部署上，按 key 的 registry 写权限上传和发布版本。 |
| 自定义 sandbox | [Environments](../build/environments.md)、[Cloud 参考](../build/cloud-sandbox-reference.md) | Platform key 不能管理 Environment。 |
| 发送、生成并获取文件 | [文件与产物](../build/files.md) | 把输入文件上传到 `/workspace`。让 Agent 把输出发布为 Artifact，再下载结果。 |
| 生成图片、视频和语音 | [媒体生成工具](../build/tools.md#media-generation-tools) | 内置工具，不需要 custom tool 或模型 key。可用模型因部署而异；SDK 没有封装生成文件的下载路由。 |
| 保存结构化数据 | [Agent Database](../build/data-storage.md) | 通过 Session 使用 `agent_db`；production 只读 viewer 当前不可用。 |
| 保存 Agent memory | [Memory](../build/memory.md) | 工具必须已启用且可用，不承诺每个新 turn 自动 recall。 |
| 在一个 Agent 内分隔用户 | [每用户一个 Agent](../build/per-user-agents.md) | `isolation: "session"` 分隔 workspace、Memory 和 Artifact；不分隔 Agent Database 和 Agent owner 的 credential。 |
| 为 MCP Server 提供 credential（每用户或所有 Session 共用） | [Vault（beta）](../build/vault.md) | Beta。需要 Platform API key，以及 TypeScript SDK 0.15.0+ 或 Python SDK 0.10.0+。 |
| 继续或取消任务 | [Session 操作](../build/session-operations.md)、[Events](../build/events.md) | stream 断开不会取消 run。 |
| 接收服务器通知 | [Webhooks](../build/webhooks.md) | 需要服务配置和签名验证。 |
| 创建周期任务 | [Schedules](../build/schedules.md) | Outcome evaluation 限于文档所述的 scheduled agentTurn 流程。 |
| 查看消耗和余额 | [Usage](./usage.md) | Platform key 只查自己的 Usage；任意 key 都能读取组织共享余额。两者都不是 budget cap。 |

