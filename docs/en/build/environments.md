---
description: Define reusable sandbox templates and attach versioned environments to agents.
---

# Environments

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

## Environment configuration model

Environment versions are reproducible build artifacts with a deliberately small input model:

- **Package installation** supports apt, npm, and pip.
- **Base image** is the managed ZooWork platform image. Your configuration adds packages,
  files, and a build script on top of it.
- **Build-time configuration** runs `build.script` while the image is built. Keep runtime
  credentials and application secrets outside the Environment definition.
- **Immutable versions** preserve the input and build history. Create a version for a new
  configuration; use the retry operation to rebuild the same version.
- **Agent configuration remains separate.** Skills, personas, and workspace files are
  attached through their own Agent APIs.

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
| `createEnvironmentVersion(environmentId, config, idempotencyKey?)` | Adds a new immutable configuration version, not a retry of the old one. |
| `getEnvironmentVersion(environmentId, version, opts?)` | Reads aggregate build state; optional `opts.resourceClass` selects `starter`, `pro` or `ultra`. |

The platform default Environment - the one a fresh agent is pinned to - is not in
`listEnvironments()`, and `getEnvironment()` on it answers `404`. The gateway forces an org
selector and the default belongs to no org, so this is a selector mismatch, not a permission
problem.

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
`{ resource: { config } }`.

Give both calls a stable `Idempotency-Key`. Versions have no delete at all, and
`archiveEnvironment()` archives the entire Environment - the first version cannot be removed.

### Direct HTTP endpoints

Call these four operations with a plain `fetch` against the same base
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
import { createZooworkClient } from '@zoowork-ai/sdk'

const version = env.version!.version!
const deadline = Date.now() + 5 * 60_000
const cancel = new AbortController() // call cancel.abort() to stop this wait
const bounded = createZooworkClient({
  fetch: (url, init) => fetch(url, {
    ...init,
    signal: AbortSignal.any([
      cancel.signal,
      AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
    ]),
  }),
})
let v
while (Date.now() < deadline && !cancel.signal.aborted) {
  v = await bounded.getEnvironmentVersion(env.environment_id, version)
  if (v.status === 'ready') break
  if (v.status === 'failed') throw new Error(v.failure_message ?? 'Build failed')
  if (v.status === 'partial_ready') {
    const selected = await bounded.getEnvironmentVersion(env.environment_id, version, {
      resourceClass: 'starter',
    })
    if (selected.status === 'failed') throw new Error('Selected class failed')
    // This example waits for ALL classes, not just starter. Re-read the aggregate next.
  }
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
if (v?.status !== 'ready') throw new Error('Build wait cancelled or timed out; inspect class status')
```

::: warning Build states
A version can be `queued`, `submitting`, `building`, `verifying`, `partial_ready`, `ready`
or `failed`. `partial_ready` means some classes are ready while others may be building or
failed; it can be transient or a partial terminal result. It is not itself a verdict for your
chosen class. This conservative example waits for aggregate ready with bounded requests;
a terminal partial build exits by timeout rather than waiting forever.
:::

The Environment's top-level `status` is `active` or `archived`, not build progress.

The Environment row carries two version numbers and they are not the same number.
`latest_version` is the newest version *created*: it is `1` the instant you create an
Environment, while that version is still `queued`. `latest_ready_version` is the newest one
that finished building, and it is `null` until a build lands. **Pin `latest_ready_version`.**
Pinning `latest_version` is how an agent create earns the `409 environment_not_ready` above.

## Related

- [Agents](./agents.md) - the full agent resource and `config_version` semantics.
- [Tools](./tools.md) - what the agent can do inside the sandbox this Environment builds.
