# Environments

::: warning Not yet verified
This page covers the whole Environments surface, and none of it has been exercised end to
end.

What we have confirmed: the resource is reachable with an ordinary API key. A list call
returns `200` with an empty list. That is the extent of it. We have never built an
Environment, never attached one to an agent, and never observed a sandbox start from one.

Everything below the list call comes from the platform's own API documentation. Treat it as
a map of the surface, not as instructions we have followed. If your project depends
on preinstalled packages, plan a fallback: an agent with no `environment_id` runs on the
system default and works today.
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

This is the one part of the surface the SDK types cover. `AgentResource` accepts both fields
at the top level:

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

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
  failed. Poll that specific version until it is ready; do not read the Environment's
  top-level state and guess.
- `409 environment_locked` - the agent already created its first sandbox. **The Environment
  is fixed from that moment on.** Stopping the agent does not clear the lock, so you cannot
  stop, re-pin, and start again. Choose the Environment before the agent's first turn, or
  create a new agent.

A cross-tenant `environment_id` is hidden as `404`, not `403`.

## Calling the Environments API

The SDK has no Environment methods. `ZooclawClient` exposes nothing for this resource, so use
a plain `fetch` against the same base URL with the same bearer.

::: tip Lower-level escape hatch
Everything below bypasses the SDK. There is no type checking, no error normalization into
`ZooclawError`, and no guarantee the response shape stays stable across Developer Preview
releases. Parse defensively and ignore unknown fields.
:::

The list call is the one request we have actually run:

```ts
const base = process.env.ZOOCLAW_BASE_URL! // https://claw-interface.ecap.yesy.live/service/v1
const res = await fetch(`${base}/environments`, {
  headers: { Authorization: `Bearer ${process.env.ZOOCLAW_API_KEY}` },
})
console.log(res.status) // 200
console.log(await res.json())
```

It returned `200` with an empty list. The underlying route takes an `org_id` selector, which
the gateway fills in from your key the same way it does for agents.

The rest of the surface, from the platform documentation:

| Operation | Request |
|---|---|
| Create | `POST {base}/environments` |
| List | `GET {base}/environments` |
| Retrieve | `GET {base}/environments/{environment_id}` |
| Create a version | `POST {base}/environments/{environment_id}/versions` |
| Retrieve a version | `GET {base}/environments/{environment_id}/versions/{version}` |
| Build logs | `GET {base}/environments/{environment_id}/versions/{version}/logs?offset=0&limit=200` |
| Retry a failed build | `POST {base}/environments/{environment_id}/versions/{version}/retry` |
| Archive | `POST {base}/environments/{environment_id}:archive` |
| Mint file uploads | `POST {base}/environments/uploads` |
| Finalize an upload | `POST {base}/environments/uploads/{upload_id}:finalize` |

Create and create-version should carry a stable `Idempotency-Key`. The first version has no
hard delete.

We are not printing a full create body. We have not run the call, and the exact `resource`
envelope around the `config` object above is the part we cannot confirm without running it.
The `config` object itself is documented verbatim by the platform and is reproduced faithfully
in this page.

## Build states

A version moves through `queued`, `submitting`, `building`, `verifying`, `ready`. Any phase
can end in `failed`.

Poll the **specific version**, not the Environment. The Environment's top-level state does not
tell you whether the version you pinned is usable. Read build logs incrementally with the
`next_offset` the logs response returns.

## Related

- [Agents](/en/build/agents) - the full agent resource and `config_version` semantics.
- [Tools](/en/build/tools) - what the agent can do inside the sandbox this Environment builds.
- [Capability matrix](/en/reference/capabilities) - verification status across the API.
