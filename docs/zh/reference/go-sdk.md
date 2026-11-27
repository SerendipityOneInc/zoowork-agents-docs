---
description: 安装和配置 ZooWork Go SDK，查找 client 方法，并处理事件、webhook 和 API 错误。
source: /en/reference/go-sdk
source_hash: 4500c0a206ee5dc4a862388a4edf4af6add5cf9151dbf03a2bdad1d21b1970d6
---

# Go SDK 参考

在 Go 应用中使用 Go SDK 调用 ZooWork Managed Agents。导入路径为
`github.com/SerendipityOneInc/zoowork-sdk-go`，包名为 `zoowork`。

## 安装

使用 Go 1.26 或更高版本。在已有 module 中安装已发布的版本：

```bash
go get github.com/SerendipityOneInc/zoowork-sdk-go
```

创建 [Project API key](../get-started/authentication.md)，在应用环境中设置
`ZOOWORK_API_KEY`。按[快速开始](../get-started/quickstart.md)的 Go 标签创建 Agent、启动 Session 并读取回合的事件流。

## 配置

用 `zoowork.NewClient(zoowork.Config{})` 创建 client。多个并发请求可以共享同一个 client。
传入带 deadline 的 `context.Context` 限制请求时长或关闭事件流。

| Config 字段 | 用途 |
| --- | --- |
| `APIKey` | 显式传入 Project API key。留空时读取 `ZOOWORK_API_KEY`。 |
| `BaseURL` | 包含 `/service/v1` 的 API 地址。默认读取 `ZOOWORK_BASE_URL`，未设置时使用 `https://clawapi.ecap.gsmo.ai/service/v1`。 |
| `HTTPClient` | 可选的 `*http.Client`，用于自定义 HTTP transport。 |

使用 `zoowork.Object` 的请求沿用 API 的 JSON 字段名。把键设为 `nil` 会发送 JSON
`null`。省略该键即可省略字段。返回为 `Object` 的响应保留服务端新增字段，并以 `json.Number` 读取数字。

## Client 方法

使用 `go doc github.com/SerendipityOneInc/zoowork-sdk-go.Client` 查看方法签名。请求与响应字段、限制和可用范围见各指南。

| 操作 | 方法 |
| --- | --- |
| [配置和启动 Agent](../build/agents.md) | `CreateAgent`、`ListAgents`、`IterAgents`、`IterAgentPages`、`GetAgent`、`UpdateAgent`、`DeleteAgent`、`StartAgent`、`StopAgent`、`WaitUntilRunning`、`GetSystemPrompt`、`PreviewSystemPrompt`、`UpgradeSystemPrompt` |
| [选择模型](./models.md) | `ListModels` |
| [连接 Channel](../build/channels.md) | `ListChannels`、`AddChannel`、`UpdateChannel`、`RemoveChannel`、`StartChannelSetup`、`PollChannelSetup`、`CancelChannelSetup`、`WaitForChannelSetup`，以及对应的 `FeishuSetup` 方法 |
| [发布或添加 Skill](../build/skills.md) | `UploadSkill`、`UploadSkillVersion`、`ListSkills`、`DeleteSkill`、`ListAgentSkills`、`PutAgentSkill`、`DeleteAgentSkill` |
| [管理 Session](../build/session-operations.md) | `CreateSession`、`GetSession`、`ListSessions`、`ListSessionPage`、`ArchiveSession`、`DeleteSession`、`GetRunOutput` |
| [发送或读取事件](../build/events.md) | `PostEvents`、`ListEvents`、`ListEventsPage`、`ListAllEvents`、`StreamEvents` |
| [处理工具调用](../build/tools.md) | `ListApprovals`、`ListApprovalPage`、`GetApproval`、`ResolveApproval`、`ListCustomToolCalls`、`ListCustomToolCallPage`、`GetCustomToolCall`、`ResolveCustomToolCall` |
| [传输文件和产物](../build/files.md) | `UploadFile`、`ListArtifacts`、`GetArtifact`、`DownloadArtifact`、`DeleteArtifact` |
| [安排任务](../build/schedules.md) | `ListSchedules`、`CreateSchedule`、`GetSchedule`、`UpdateSchedule`、`DeleteSchedule`、`TriggerSchedule`、`ListScheduleRuns`、`Wake` |
| [使用沙箱](../build/cloud-sandbox-reference.md) | `Exec` |
| [管理 Environment](../build/environments.md) | `ListEnvironments`、`GetEnvironment`、`CreateEnvironment`、`ArchiveEnvironment`、`CreateEnvironmentVersion`、`GetEnvironmentVersion` |
| [读取 Usage 或余额](./usage.md) | `GetUsage`、`GetBalance` |
| [管理 Vault credential](../build/vault.md) | `CreateVault`、`ListVaults`、`GetVault`、`UpdateVault`、`ArchiveVault`、`DeleteVault`、`CreateVaultCredential`、`ListVaultCredentials`、`GetVaultCredential`、`UpdateVaultCredential`、`ArchiveVaultCredential`、`DeleteVaultCredential`、`ValidateVaultCredential`、`RevokeSessionVaultBinding`、`CreateVaultOffboarding`、`GetVaultOffboarding` |
| [管理 webhook](../build/webhooks.md) | `ListAgentWebhooks`、`CreateAgentWebhook`、`GetAgentWebhook`、`UpdateAgentWebhook`、`DeleteAgentWebhook`、`RotateAgentWebhookSecret`、`TestAgentWebhook`、`GetAgentWebhookEvent`、`ListAgentWebhookDeliveries`、`GetAgentWebhookDelivery`、`RedeliverAgentWebhookDelivery`、`RedeliverAgentWebhookDeliveries` |

Platform key 可以调用哪些方法，见[可用性与限制](./capabilities.md)。

## 事件与 webhook

`StreamEvents` 每次返回一组 `(SessionEvent, error)`。迭代时检查错误，用
`IsRunFinished` 和 `RunOutcome` 获取回合结果。`AssistantText`、`ThinkingText`、
`ExtractToolCall` 和 `ExtractCustomToolUse` 读取规范化的事件内容。用已处理的最后一个 cursor
恢复 SSE。继续读取 REST 历史时使用上一页返回的 next cursor。

把原始 HTTP 请求体和 header 传给 `UnwrapWebhook`，验证并解析 webhook。只验证签名时使用
`VerifyWebhookSignature`，给测试投递签名时使用 `SignWebhook`。未传入 secret 时，验证函数会读取
`ZOOWORK_WEBHOOK_SECRET`。

## API 错误

先声明 `var apiError *zoowork.Error`，再用 `errors.As(err, &apiError)` 读取
`Status`、`Type` 和 `Code`。`Code` 保留服务端的顶层错误码，有嵌套错误类型时
`Type` 保留该类型。根据[错误与重试](./errors.md)匹配这些字段。用 `IsVaultBetaUnavailable`
判断 Vault 可用性，用 `VaultSessionErrorCode` 匹配 binding 错误。
