---
description: Define reusable sandbox templates and attach versioned environments to agents.
---

# Environments

::: warning Not yet verified
None of this surface has been exercised end to end. We have never built an Environment, never
attached one to an agent, and never observed a sandbox start from one.

The SDK types the whole resource, and `listEnvironments()` answers `200`. Everything past that
is a typed contract we have not watched run. If your project depends on preinstalled packages,
plan a fallback: an agent with no `environment_id` runs on the system default and works today.
:::

An Environment is an immutable sandbox template. You declare packages, files, and a build
script once; the platform builds an image from that declaration; agents then pin an exact
built version. It is the answer to "the agent needs my Python dependencies" and "the agent
must only reach these hosts".

## What an Environment holds

| Part | What it does |
|---|---|
| `packages.apt` / `packages.npm` / `packages.pip` | Preinstalled packages. Installation order is fixed: apt, then npm, then pip. |
| `files` | Controlled files written under `/opt/zooclaw/environment/`. An executable top-level `bin/*` file is linked into `/usr/local/bin`. |
| `build` | A script that runs during image build, plus an optional `verify_script` whose non-zero exit fails the version. |
| `networking` | `unrestricted`, or `limited` with an `allowed_hosts` list. |

The config object accepts exactly those four keys. Any other key returns
`400 invalid_environment_config`.

```json
{
  "packages": {
    "apt": ["gettext-base"],
    "npm": ["is-number@7.0.0"],
    "pip": ["tomli==2.2.1"]
  },
  "files": [
    { "path": "bin/example-cli", "contentBase64": "IyEvYmluL3NoCg==", "executable": true }
  ],
  "build": {
    "script": "printf built > /opt/zooclaw/environment/build-marker",
    "verify_script": "example-cli"
  },
  "networking": {
    "type": "limited",
    "allowed_hosts": ["example.com"]
  }
}
```

`networking.type` takes one of two values, and it is required whenever `networking` is
present at all:

- `unrestricted` - no outbound restriction. `allowed_hosts` is not accepted here; sending it
  returns `400`.
- `limited` - only the domains in `allowed_hosts` are reachable; everything else is denied.
  Entries are domain names and support a `*.` prefix for one sub-domain level. Omitting the
  list means limited with nothing allowed.

Omitting `networking` entirely defaults to `{ "type": "unrestricted" }`.

File paths are normalized relative POSIX paths. Inline `contentBase64` across one request is
capped at 1 MB after decoding; inline content plus direct uploads together are capped at
50 MB. Larger files go through a separate presigned upload flow that mints an `upload_id`,
which you then reference from `files[]` instead of inlining bytes.

## Constraints you cannot design around

These are properties of the platform, not defaults you can change.

- **Three package managers, and only three.** apt, npm, pip. There is no other installer
  hook.
- **A custom Environment always inherits one fixed platform base.** Arbitrary inheritance
  chains are not supported. You cannot start from your own image.
- **No secrets, no runtime credentials, no custom environment variables, and no sandbox
  start hooks.** An Environment is a build-time artifact. `build.script` runs when the image
  is built, never when a sandbox starts. If your dependency needs an API key at runtime,
  an Environment is not where it goes.
- **Versions are immutable.** A retry after a failed build retries that same version and
  keeps the attempt and log history.
- **Skills, personas, and workspace files are not part of an Environment.** You submit
  packages, files, and a build script explicitly; nothing is inferred from anywhere else.

## Pinning an Environment to an agent

`AgentResource` accepts both fields at the top level:

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const agent = await zc.createAgent({
  resource: {
    name: 'data-cruncher',
    model: { primary: 'litellm/claude-sonnet-5' },
    environment_id: 'env_example',
    environment_version: 3,
  },
})
```

`updateAgent` accepts the same pair:

```ts
await zc.updateAgent(agentId, { environment_id: 'env_example', environment_version: 4 })
```

The resolution rules:

| What you send | What happens |
|---|---|
| Neither field | The agent pins the system default. |
| `environment_id` only | The latest ready version is resolved **during that request** and pinned. |
| `environment_version` only | `400`. |
| Both | That exact version is pinned. |

**The agent does not re-resolve `latest` when it starts.** Whatever was resolved at write
time is what runs, forever, until you PUT a new pin. Publishing a new Environment version
changes nothing for an already-pinned agent. The response reports the pinned result as
`resolved_environment`.

Two errors to expect:

- `409 environment_not_ready` - the version you pinned is still building, or its build
  failed. Poll that specific version's `status` until it reads `ready`; the Environment's
  top-level row does not answer this question.
- `409 environment_locked` - the agent already created its first sandbox. **The Environment
  is fixed from that moment on.** Stopping the agent does not clear the lock, so you cannot
  stop, re-pin, and start again. Choose the Environment before the agent's first turn, or
  create a new agent.

A cross-tenant `environment_id` is hidden as `404`, not `403`.

## Calling the Environments API

`ZooworkClient` covers this resource with six typed methods, all normalizing failures into
`ZooworkError`:

| Method | What it does |
|---|---|
| `listEnvironments({ page })` | The Environments in your org, `page` 1-based. |
| `getEnvironment(environmentId)` | Reads one Environment. |
| `createEnvironment({ resource, ownership }, idempotencyKey?)` | Creates an Environment and its first version. |
| `archiveEnvironment(environmentId)` | Archives it. |
| `createEnvironmentVersion(environmentId, config, idempotencyKey?)` | Adds an immutable version. A retry after a failed build retries **that** version and keeps its attempt log. |
| `getEnvironmentVersion(environmentId, version)` | Reads one version. This is the call you poll. |

The platform default Environment - the one a fresh agent is pinned to - is not in
`listEnvironments()`, and `getEnvironment()` on it answers `404`. The gateway forces an org
selector and the default belongs to no org, so this is a selector mismatch, not a permission
problem.

`listEnvironments()` answered `200` with an empty list. That is the only thing on this path we
have actually run.

### Creating an Environment

`createEnvironment` takes `{ resource, ownership }`, and **`ownership` is required here** -
unlike `createAgent`, where the gateway derives it and you omit it. Take the pair from any
agent record's `ownership`. `resource` is `{ name, description?, config }`, with `config`
exactly the four-key object above.

```ts
const env = await zc.createEnvironment(
  {
    resource: {
      name: 'data-cruncher-env',
      config: {
        packages: { pip: ['tomli==2.2.1'] },
        networking: { type: 'limited', allowed_hosts: ['example.com'] },
      },
    },
    ownership: agent.ownership!,
  },
  'env-create-01',
)

console.log(env.environment_id)   // env_...
console.log(env.version?.version) // 1
console.log(env.version?.status)  // 'queued'
```

The first version comes back inline on the create as `EnvironmentRecord.version`, so there is
no follow-up `getEnvironmentVersion()` needed to see it. Later versions go through
`createEnvironmentVersion(environmentId, config)`, which wraps your config as
`{ resource: { config } }`; that body has not been exercised against a live deployment.

Give both calls a stable `Idempotency-Key`. Versions have no delete at all, and
`archiveEnvironment()` archives the entire Environment - the first version cannot be removed.

### Routes with no wrapper

Four operations have no client method. Call them with a plain `fetch` against the same base
URL and the same bearer:

| Operation | Request |
|---|---|
| Build logs | `GET {base}/environments/{environment_id}/versions/{version}/logs?offset=0&limit=200` |
| Retry a failed build | `POST {base}/environments/{environment_id}/versions/{version}/retry` |
| Mint file uploads | `POST {base}/environments/uploads` |
| Finalize an upload | `POST {base}/environments/uploads/{upload_id}:finalize` |

Read the logs incrementally with the `next_offset` the response returns. Percent-encode the
colon in any path you build by hand: a raw `:` makes the engine miss the route and answer
`404`.

## Build states

Poll the **version**, not the Environment, and the field is `status` - there is no `state` on a
version, and a loop written against one compares `undefined` to `'ready'` forever.

```ts
const version = env.version!.version!
let v = await zc.getEnvironmentVersion(env.environment_id, version)

while (v.status !== 'ready' && v.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 2000))
  v = await zc.getEnvironmentVersion(env.environment_id, version)
}
if (v.status === 'failed') throw new Error(`${v.failure_stage}: ${v.failure_message}`)
```

A version walks `queued`, `submitting`, `building`, `verifying`, `ready`. Any phase can end in
`failed`, and `failure_stage` names which one. The Environment's own `status` is `active` or
`archived` - it is lifecycle, not build progress, and it reads `active` the whole time a build
is running.

The Environment row carries two version numbers and they are not the same number.
`latest_version` is the newest version *created*: it is `1` the instant you create an
Environment, while that version is still `queued`. `latest_ready_version` is the newest one
that finished building, and it is `null` until a build lands. **Pin `latest_ready_version`.**
Pinning `latest_version` is how an agent create earns the `409 environment_not_ready` above.

## Related

- [Agents](./agents.md) - the full agent resource and `config_version` semantics.
- [Tools](./tools.md) - what the agent can do inside the sandbox this Environment builds.
- [Capability matrix](../reference/capabilities.md) - verification status across the API.
