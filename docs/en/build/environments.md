---
description: Understand the default managed Environment and the current limits on custom Environment management.
---

# Environments

An Environment defines the software, image files, build steps, and network policy for a
cloud sandbox. Agents use a managed default Environment, so you can run tasks without
creating an Environment first.

## API availability

Platform API keys created in [ZooWork Platform](https://platform.zoowork.ai) cannot currently
create, list, or manage custom Environments. Environment-management requests return
`404 service_api.not_found`. SDK Environment methods do not change this access limit.

Use the default sandbox with the [Quickstart](../get-started/quickstart.md). See
[Authentication](../get-started/authentication.md) for API-key setup and scope.

## Use the default Environment {#what-an-environment-holds}

When creating an Agent, omit `environment_id` and `environment_version`. The Agent resolves
and pins the managed default Environment. Sessions use that Agent's Environment; they do
not take a separate Environment ID.

The default image includes the languages, document libraries, utilities, and browser
described in [Cloud sandbox reference](./cloud-sandbox-reference.md). Check that inventory
before depending on additional software.

Keep task files in `/workspace`; ask the Agent to create them with its file tools and
use [Files and artifacts](./files.md) to publish and retrieve results. Changes made inside
a running sandbox do not create an Environment version. Software installed at runtime is
not guaranteed to survive sandbox replacement.

## Custom image builds {#build-states}

Custom package lists, image-file uploads, build scripts, network-policy configuration,
and version-build management are not available with Platform API keys. There is no custom
Environment build to poll in the supported Platform workflow.

For work that requires a specific dependency or service configuration, run that operation
in your own backend and expose it through an
[application-executed tool](./tools.md#application-executed-custom-tools) or [MCP](./mcp.md).

## Related

- [Cloud sandbox reference](./cloud-sandbox-reference.md) — inspect the default software.
- [Files and artifacts](./files.md) — create files and retrieve published outputs.
- [Current API boundaries](../reference/not-supported.md) — check other unavailable workflows.
