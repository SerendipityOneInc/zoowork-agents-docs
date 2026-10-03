---
description: 查看 API key 要求、工具可用性与当前公共 API 限制。
source: /en/reference/capabilities
source_hash: bfb4b2157802e6c4384d4f71041d47f302449680464165f5725db0324e24b4b3
---

# 可用性与限制

可用功能取决于 key 的资源范围、已启用的工具和服务配置。下表列出了各项功能的指南与使用条件。

## 找到对应指南

| 任务 | 指南 | 主要条件 |
|---|---|---|
| 获取 key 并限定请求范围 | [Authentication](../get-started/authentication.md) | 在 Platform 创建 key；请求限定为 key owner 与 Project。 |
| 配置 Agent 工具和审批 | [Tools](../build/tools.md)、[权限策略](../build/permissions.md) | deployment 提供的工具和应用业务授权是不同层次。 |
| 检索私有知识 | [Retrieval](../build/retrieval.md) | 应用或 MCP 服务负责检索和数据权限。 |
| 复用任务指令 | [Skills](../build/skills.md) | 配置可见的 Skill assignment；公共 API 不开放 registry 发布。 |
| 自定义 sandbox | [Environments](../build/environments.md)、[Cloud 参考](../build/cloud-sandbox-reference.md) | Platform key 不能管理 Environment。 |
| 写入文本并读取文件 | [文件与产物](../build/files.md) | 文本输入、binary 读取和已发布 artifact 是不同流程。 |
| 保存结构化数据 | [Agent Database](../build/data-storage.md) | Native database tools 与只读 viewer 的访问和配置要求不同。 |
| 保存 Agent memory | [Memory](../build/memory.md) | 工具必须已启用且可用，不承诺每个新 turn 自动 recall。 |
| 继续或取消任务 | [Session 操作](../build/session-operations.md)、[Events](../build/events.md) | stream 断开不会取消 run。 |
| 接收服务器通知 | [Webhooks](../build/webhooks.md) | 需要服务配置和签名验证。 |
| 创建周期任务 | [Schedules](../build/schedules.md) | Outcome evaluation 限于文档所述的 scheduled agentTurn 流程。 |
| 查看消耗 | [Usage](./usage.md) | Platform key 只查自己的 Usage；查询不是 budget cap。 |

尚无受支持公共流程的能力见[当前边界](./not-supported.md)。
