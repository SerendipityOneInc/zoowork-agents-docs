---
description: Check API-key requirements, tool availability, and current public API limits.
---

# Availability and limits

Available features depend on your key's resource scope, enabled tools, and service configuration. Use the table below to find each guide and its requirements.

## Find the guide

| Task | Guide | Important condition |
|---|---|---|
| Get a key and scope requests | [Authentication](../get-started/authentication.md) | Create a key in Platform; requests are scoped to its owner and Project. |
| Configure Agent tools and approvals | [Tools](../build/tools.md), [Permissions](../build/permissions.md) | Deployment-provided tools and application authorization are separate. |
| Retrieve private knowledge | [Retrieval](../build/retrieval.md) | Your application or MCP service provides retrieval and data permissions. |
| Reuse task instructions | [Skills](../build/skills.md) | Configure visible Skill assignments; registry publishing is not available through the public API. |
| Customize the sandbox | [Environments](../build/environments.md), [Cloud reference](../build/cloud-sandbox-reference.md) | Environment management is not available to Platform keys. |
| Generate and retrieve files | [Files and artifacts](../build/files.md) | Ask the Agent to create a file and publish it as an Artifact before downloading. |
| Store structured data | [Agent Database](../build/data-storage.md) | Native database tools and the read-only viewer have different access and configuration requirements. |
| Save Agent memory | [Memory](../build/memory.md) | Tools must be enabled and available; no automatic recall on every new turn is promised. |
| Continue or cancel work | [Session operations](../build/session-operations.md), [Events](../build/events.md) | A stream disconnection does not cancel the run. |
| Receive server notifications | [Webhooks](../build/webhooks.md) | Service configuration and signature verification are required. |
| Schedule recurring tasks | [Schedules](../build/schedules.md) | Outcome evaluation is limited to the documented scheduled agentTurn flow. |
| Inspect consumption | [Usage](./usage.md) | Platform key Usage is restricted to that key; reporting is not a budget cap. |

For capabilities without a supported public workflow, see [Current boundaries](./not-supported.md).
