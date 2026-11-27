---
description: Install and configure the ZooWork Go SDK, locate client methods, and read events, webhooks, and API errors.
---

# Go SDK reference

Use the Go SDK to call ZooWork Managed Agents from a Go application. The import path is
`github.com/SerendipityOneInc/zoowork-sdk-go`. The package name is `zoowork`.

## Installation

Use Go 1.26 or later. To install a released version in an existing module, run:

```bash
go get github.com/SerendipityOneInc/zoowork-sdk-go
```

Create a [Project API key](../get-started/authentication.md) and set
`ZOOWORK_API_KEY` in your application's environment. Follow the Go tabs in the
[Quickstart](../get-started/quickstart.md) to create an Agent, start a Session, and stream a turn.

## Configuration

Create a client with `zoowork.NewClient(zoowork.Config{})`. The client can be shared
across concurrent calls. Pass a `context.Context` with a suitable deadline to bound a request
or close an event stream.

| Config field | What it controls |
| --- | --- |
| `APIKey` | Explicit Project API key. When left empty, the client reads `ZOOWORK_API_KEY`. |
| `BaseURL` | API base URL including `/service/v1`. Defaults to `ZOOWORK_BASE_URL`, then `https://clawapi.ecap.gsmo.ai/service/v1`. |
| `HTTPClient` | Optional `*http.Client` for custom transport settings. |

Requests that take a `zoowork.Object` use the API's original JSON field names. A key set to
`nil` is sent as JSON `null`. Leave it out to omit the field. JSON responses represented as
`Object` keep fields added by the service and decode numbers as `json.Number`.

## Client methods

Run `go doc github.com/SerendipityOneInc/zoowork-sdk-go.Client` for method signatures.
Use the linked guides for request and response fields, limits, and availability.

| Task | Methods |
| --- | --- |
| [Configure and start an Agent](../build/agents.md) | `CreateAgent`, `ListAgents`, `IterAgents`, `IterAgentPages`, `GetAgent`, `UpdateAgent`, `DeleteAgent`, `StartAgent`, `StopAgent`, `WaitUntilRunning`, `GetSystemPrompt`, `PreviewSystemPrompt`, `UpgradeSystemPrompt` |
| Build and apply an Agent | `CreateBuildAgent`, `GetBuild`, `OpenBuildSession`, `GetBuildRun`, `RetryBuildApply`, `PublishBuild` |
| Share, install, or update an Agent | `CreateShareLink`, `ListShareLinks`, `RevokeShareLink`, `PreviewInstall`, `InstallSharedAgent`, `ListInstalledAgents`, `UpdateInstalledAgent`, `GetUpdateStatus` |
| Inspect saved Build revisions | `ListRevisions`, `GetRevisionDiff` |
| [Choose a model](./models.md) | `ListModels` |
| [Connect a channel](../build/channels.md) | `ListChannels`, `AddChannel`, `UpdateChannel`, `RemoveChannel`, `StartChannelSetup`, `PollChannelSetup`, `CancelChannelSetup`, `WaitForChannelSetup`, and the corresponding `FeishuSetup` helpers |
| [Publish or attach a Skill](../build/skills.md) | `UploadSkill`, `UploadSkillVersion`, `ListSkills`, `DeleteSkill`, `ListAgentSkills`, `PutAgentSkill`, `DeleteAgentSkill` |
| [Manage Sessions](../build/session-operations.md) | `CreateSession`, `GetSession`, `ListSessions`, `ListSessionPage`, `ArchiveSession`, `DeleteSession`, `GetRunOutput` |
| Read or update a Session's model and thinking level | `GetSessionModel`, `UpdateSessionModel` |
| [Send or read events](../build/events.md) | `PostEvents`, `ListEvents`, `ListEventsPage`, `ListAllEvents`, `StreamEvents` |
| [Resolve tool activity](../build/tools.md) | `ListApprovals`, `ListApprovalPage`, `GetApproval`, `ResolveApproval`, `ListCustomToolCalls`, `ListCustomToolCallPage`, `GetCustomToolCall`, `ResolveCustomToolCall` |
| [Transfer files and artifacts](../build/files.md) | `UploadFile`, `ListArtifacts`, `GetArtifact`, `DownloadArtifact`, `DeleteArtifact` |
| [Schedule work](../build/schedules.md) | `ListSchedules`, `CreateSchedule`, `GetSchedule`, `UpdateSchedule`, `DeleteSchedule`, `TriggerSchedule`, `ListScheduleRuns`, `Wake` |
| [Use the sandbox](../build/cloud-sandbox-reference.md) | `Exec` |
| [Manage Environments](../build/environments.md) | `ListEnvironments`, `GetEnvironment`, `CreateEnvironment`, `ArchiveEnvironment`, `CreateEnvironmentVersion`, `GetEnvironmentVersion` |
| [Read usage or balance](./usage.md) | `GetUsage`, `GetBalance` |
| [Manage Vault credentials](../build/vault.md) | `CreateVault`, `ListVaults`, `GetVault`, `UpdateVault`, `ArchiveVault`, `DeleteVault`, `CreateVaultCredential`, `ListVaultCredentials`, `GetVaultCredential`, `UpdateVaultCredential`, `ArchiveVaultCredential`, `DeleteVaultCredential`, `ValidateVaultCredential`, `RevokeSessionVaultBinding`, `CreateVaultOffboarding`, `GetVaultOffboarding` |
| [Manage webhooks](../build/webhooks.md) | `ListAgentWebhooks`, `CreateAgentWebhook`, `GetAgentWebhook`, `UpdateAgentWebhook`, `DeleteAgentWebhook`, `RotateAgentWebhookSecret`, `TestAgentWebhook`, `GetAgentWebhookEvent`, `ListAgentWebhookDeliveries`, `GetAgentWebhookDelivery`, `RedeliverAgentWebhookDelivery`, `RedeliverAgentWebhookDeliveries` |

For method availability with a Platform key, see [Availability and limits](./capabilities.md).

For Agent Build, read `build_session_id` from `CreateBuildAgent` or `session_id` from
`OpenBuildSession`. Use `PostEvents` to send text-only `user.message` events to that Session.
Use the run ID from its events with `GetBuildRun` to check whether the revision was saved and
applied. To install a shared Agent, call `PreviewInstall` and pass its `source_revision_id`
to `InstallSharedAgent` as the expected source revision.

Read the Session's model settings with `GetSessionModel`. Pass its `selection_version` and
`config_version` to `UpdateSessionModel` as `expected_selection_version` and
`expected_config_version`. Set `model_id` to `nil` to restore the Agent's model and thinking
settings. Updates apply to the next turn.

## Event and webhook helpers

`StreamEvents` yields `(SessionEvent, error)` pairs. Check the error during iteration, and use
`IsRunFinished` and `RunOutcome` to identify the turn result. `AssistantText`, `ThinkingText`,
`ExtractToolCall`, and `ExtractCustomToolUse` read normalized event payloads. Resume SSE using the
last processed cursor. For REST history, use the page's next cursor.

Pass the original HTTP request body and headers to `UnwrapWebhook` to verify and parse a
webhook. Use `VerifyWebhookSignature` to verify without parsing, or `SignWebhook` to sign
test deliveries. The verifier reads `ZOOWORK_WEBHOOK_SECRET` when no secrets are passed.

## API errors

Use `errors.As(err, &apiError)` with `var apiError *zoowork.Error` to read `Status`, `Type`,
and `Code`. `Code` holds the top-level server code and `Type` holds the nested type when
present. Match on these fields using [Errors and retries](./errors.md). For Vault, use
`IsVaultBetaUnavailable` to check availability and `VaultSessionErrorCode` to match binding errors.
