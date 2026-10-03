---
description: Check current public API boundaries and choose supported alternatives for secrets, integrations, budgets, and self-hosting.
---

# Current public API boundaries

Use a supported integration path before depending on a feature available in another Managed Agents product. The boundaries below describe the public ZooWork API; they do not make claims about internal tools or other ZooWork products.

| Capability | Current boundary | What to use instead |
|---|---|---|
| Agent Database viewer | Direct catalog and table-row inspection is unavailable in production, even though the SDK has methods. | Ask the Agent to query with `agent_db` and return results or publish an [Artifact](../build/files.md). |
| Atomic Agent configuration updates | Production rejects `expected_config_version` on Agent updates. | Omit it, serialize writes in your backend, and [read back configuration](../build/agents.md). |
| Custom Environment management | Custom Environment creation, image builds, and version management are not available to Platform API keys. | Use the [default managed Environment](../build/environments.md). |
| Native chat-channel management | Chat-channel setup and management are not available to Platform API keys. | Connect your backend to chat platforms and forward messages through [API Sessions](../build/channels.md). |
| Skill registry publishing | The public API does not expose registry uploads, version publishing, or deletion. | Configure [visible Skill assignments](../build/skills.md), or keep application instructions in Agent persona documents. |
| Console Agent builder and Session runner | Agent creation and Session execution use the SDK or HTTP API. | Use the [Quickstart](../get-started/quickstart.md) and SDK/HTTP API. |
| Public organization, Project, or API-key Admin API | Not provided through `/service/v1`. | Manage them in [Platform](../get-started/authentication.md). |
| Turnkey ZooData/RAG/connector setup | There is no documented public provisioning API for ZooData retrieval or connectors. | Connect your own service with [custom tools or public MCP](../build/retrieval.md). |
| Credential vault and authenticated/private MCP provisioning | Public keys cannot provision Agent credentials. A credential field is not a usable provisioning flow. | Keep service credentials in your backend and execute a [custom tool](../build/tools.md). |
| Direct workspace file access and general binary input upload | Direct workspace reads, writes, and directory listing are not currently available as a supported public workflow. A general binary input upload and materialization flow is not provided. | Provide text in Session messages and retrieve [published Artifacts](../build/files.md). |
| Session spending caps | The public API provides usage reporting but no server-enforced per-Session spending cap. | Query [Usage](./usage.md), enforce application policy, and explicitly [interrupt work](../build/events.md#user-interrupt) when appropriate. |
| Public rate-limit configuration API or fixed quotas | Not established by the public API contract. | Handle 429 with backoff and avoid hardcoded provider quotas. |
| Standalone Memory stores, mounts, or Dreams jobs | No public management workflow is established. | Use the enabled [Agent Memory tools](../build/memory.md) within their scope. |
| Self-hosted worker registration and custom sandbox provider | No public worker or provider onboarding contract is established. | Use the [managed Cloud sandbox](../build/cloud-sandbox-reference.md). |
| Managed private GitHub connection and automatic PR publishing | The public API does not provision a managed private GitHub connection or automatic PR publishing. | Clone public repositories in the sandbox; keep private repository operations in your own authenticated backend. |
| General session Outcome definition or rubric resource API | Outcomes are documented for scheduled `agentTurn`; broader resource APIs are not established. | Use the [Schedules](../build/schedules.md) Outcome flow or validate results in your application. |
| Public delegation provisioning, roster/advisor/thread API | Runtime delegation alone does not establish a publicly configurable Cloud workflow or SDK orchestration surface. | Coordinate ordinary Agents and Sessions in your backend until a supported public enablement and tool contract are documented. |

## Fields are not workflows

An SDK type can describe a response field without proving that your key can call the route that produces it. A configuration field can exist without granting access to the service it references. Follow [API-key resource scope](../get-started/authentication.md) and the requirements in each guide.

For API-key requirements and tool availability, see [Availability and limits](./capabilities.md).
