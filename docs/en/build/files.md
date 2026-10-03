---
description: Ask an agent to create workspace files, then publish and download artifacts.
---

# Files and artifacts

Provide task data in a Session message and ask the Agent to create files in `/workspace`.
To retrieve an output, ask the Agent to publish an Artifact, then download the published
record through the API or SDK.

A workspace file is the current file at a path. An Artifact is a separately published copy
with an ID and a download URL. Changing the workspace file does not change an already
published Artifact.

## File isolation

All sessions of an Agent share `/workspace`. The default `sandbox.scope: 'agent'` also shares
the sandbox instance. `sandbox.scope: 'session'` uses separate instances with the same Agent
workspace, so a new session does not make a private copy of its files.

Keep task data and output in `/workspace`. Processes, runtime installs, `/tmp`, and other
paths do not have the same persistence guarantee across sandbox replacement. This guide
does not specify a backup policy or retention SLA.

`actor.ref` does not isolate files. Use [an Agent per user](./per-user-agents.md) when users
must not share files, and authorize every Agent/session request in your application.

## Before you begin

These examples reuse the SDK client and running Agent from [Quickstart](../get-started/quickstart.md). For curl, use the environment variables from [Authentication](../get-started/authentication.md).

Complete [Quickstart](../get-started/quickstart.md) through starting the agent. Reuse its
running `AGENT_ID`, with an API key allowed to access that agent. Run curl examples on your
backend in Bash, with curl 7.76+ and jq 1.6+. Run Python calls inside an async function. See [Authentication](../get-started/authentication.md)
for key scope. Artifact publishing also requires the publishing service to be available.

```bash
export AGENT_ID='your-existing-agent-id'
```

Read the Agent's ownership for the Artifact requests below:

```bash
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
OWNER_UID=$(jq -er '.ownership.owner_uid' <<<"$agent")
ORG_ID=$(jq -er '.ownership.org_id' <<<"$agent")
```

These query fields must match the agent's ownership. They do not grant access: the API key
must also authorize the agent, including its project scope when applicable. Stop if the
projection has no ownership; do not invent values.

## 1. Ask the Agent to create and publish a file

Create a Session with the task data in its first message. The Agent uses its file tools
to create the report and `artifact_publish` to publish it:

::: code-group

```ts [TypeScript]
const session = await client.createSession(agentId, {
  "initial_events": [
    {
      "type": "user.message",
      "content": "Create /workspace/report.md with a sales table for January: 100, February: 120, March: 80, and the total. Read it back to verify the total, then publish it with artifact_publish and return the Artifact."
    }
  ]
})
const sessionId = session.session_id
```

```python [Python]
session = await client.create_session(agent_id,
    {
        "initial_events": [
            {
                "type": "user.message",
                "content": "Create /workspace/report.md with a sales table for January: 100, February: 120, March: 80, and the total. Read it back to verify the total, then publish it with artifact_publish and return the Artifact."
            }
        ]
    },
)
session_id = session["session_id"]
```

```bash [curl]
session=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"initial_events":[{
    "type":"user.message",
    "content":"Create /workspace/report.md with a sales table for January: 100, February: 120, March: 80, and the total. Read it back to verify the total, then publish it with artifact_publish and return the Artifact."
  }]}')
SESSION_ID=$(jq -er '.session_id' <<<"$session")
```

:::

The prompt requests a tool call; it does not guarantee one. Read the event stream to confirm
that the agent processed the file and published the result:

::: code-group

```ts [TypeScript]
import { isRunFinished } from '@zoowork-ai/sdk'

for await (const event of client.streamEvents(agentId, sessionId)) {
  console.log(event)
  if (isRunFinished(event)) break
}
```

```python [Python]
from zoowork import is_run_finished

async for event in client.stream_events(agent_id, session_id):
    print(event)
    if is_run_finished(event):
        break
```

```bash [curl]
curl -N -sS --fail-with-body \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Accept: text/event-stream'
```

:::

Wait for `run.finished`, check that `payload.status` is `succeeded`, then press Ctrl+C. The
stream remains open for later turns. If publishing fails or requires approval, inspect the
[session events](./events.md) before requesting a download.

## 2. Download the published Artifact {#4-download-the-published-artifact}

`artifact_publish` publishes an existing non-empty regular file below `/workspace`; directories
and symlinks are rejected. It accepts a `path`, either
absolute or relative to that workspace. Publishing requires an active sandbox and a current
agent run. Direct upload supports files up to 100 MiB;
the fallback publishing path supports up to 25 MiB. Files are not automatically published just
because the agent created them.

List the Artifacts from this session and source path:

::: code-group

```ts [TypeScript]
const artifacts = await client.listArtifacts(agentId, {
  sessionId, sourcePath: '/workspace/report.md', page: 1, limit: 50,
})
const artifactId = artifacts.artifacts.find((item) => item.status === 'ready')?.artifact_id
if (!artifactId) throw new Error('No ready Artifact was found')
```

```python [Python]
artifacts = await client.list_artifacts(
    agent_id, session_id=session_id, source_path="/workspace/report.md", page=1, limit=50,
)
artifact_id = next(
    (item["artifact_id"] for item in artifacts["artifacts"] if item.get("status") == "ready"),
    None,
)
if artifact_id is None:
    raise RuntimeError("No ready Artifact was found")
```

```bash [curl]
artifacts=$(curl -sS --fail-with-body --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/artifacts" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode "owner_uid=$OWNER_UID" \
  --data-urlencode "org_id=$ORG_ID" \
  --data-urlencode "session_id=$SESSION_ID" \
  --data-urlencode 'source_path=/workspace/report.md' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=50')
ARTIFACT_ID=$(jq -er '[.artifacts[] | select(.status == "ready")][0].artifact_id' <<<"$artifacts")
```

:::

The page contains `{artifacts, page, has_more}`. Pagination is 1-based; `limit` defaults to 50
and accepts at most 100. You can also filter by `created_before`, an ISO timestamp. If no
ready record exists, inspect the run and Artifact status instead of constructing an ID or URL.
When `has_more` is true, continue with the next page. A record can be `pending`, `ready`,
`failed`, or `deleted`. To inspect one record, use `GET /agents/{agent_id}/artifacts/{artifact_id}`
with the same `owner_uid` and `org_id` query fields.

Request an access URL, then download without adding your API key to the Artifact request:

::: code-group

```ts [TypeScript]
import { writeFile } from 'node:fs/promises'

const download = await client.downloadArtifact(agentId, artifactId)
if (!download.url) throw new Error('No Artifact URL was returned')
const response = await fetch(download.url)
if (!response.ok) throw new Error(`Download failed: ${response.status}`)
await writeFile('published-report.md', Buffer.from(await response.arrayBuffer()))
```

```python [Python]
from pathlib import Path
import httpx

download = await client.download_artifact(agent_id, artifact_id)
async with httpx.AsyncClient(follow_redirects=True) as http:
    response = await http.get(download["url"])
    response.raise_for_status()
    Path("published-report.md").write_bytes(response.content)
```

```bash [curl]
download=$(curl -sS --fail-with-body --get --request POST \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/artifacts/$ARTIFACT_ID%3Adownload" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode "owner_uid=$OWNER_UID" \
  --data-urlencode "org_id=$ORG_ID")
ARTIFACT_URL=$(jq -er '.url' <<<"$download")
curl -L -sS --fail-with-body "$ARTIFACT_URL" --output published-report.md
```

:::

The download response is `{artifact_id, url}`. A record without a ready download URL returns
`409 artifact_not_ready`. Percent-encode the action colon as `%3A` in a raw HTTP path.

The SDK already provides `listArtifacts`, `getArtifact`, `downloadArtifact`, and
`deleteArtifact`; see [Artifacts reference](../reference/typescript-sdk.md) for
signatures and filters. There is no equivalent upload method implied by those read methods.

### Access URLs and deletion

Treat an Artifact URL as a bearer credential: anyone holding it can read the file. The URL
may be a platform resolver URL or a direct object-store presigned URL, depending on the
deployment. A resolver URL checks the record's current access version and ready status;
deleting the Artifact prevents later resolver access. A previously issued presigned URL can
remain usable until it expires or the stored object is removed. Deletion does not guarantee
immediate revocation of every URL already shared, including a presigned URL obtained after
following a resolver redirect.

Delete a ready Artifact when your application no longer needs it:

::: code-group

```ts [TypeScript]
await client.deleteArtifact(agentId, artifactId)
```

```python [Python]
await client.delete_artifact(agent_id, artifact_id)
```

```bash [curl]
curl -sS --fail-with-body --get --request DELETE \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/artifacts/$ARTIFACT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode "owner_uid=$OWNER_UID" \
  --data-urlencode "org_id=$ORG_ID"
```

:::

An already deleted record is returned without deleting it again. Other non-ready states
return `409 artifact_not_ready`. Deleting an Artifact does not delete its workspace source.
Requesting a download URL again also does not guarantee a different URL: a resolver URL may
remain stable while the record's access version is unchanged.

## Analyze PDFs and images

For PDFs or images already available in `/workspace`, ask the Agent to use its `pdf` or
`image` tool. See [Media tools](./tools.md#media-tools) for arguments, model requirements,
and limits. This tool workflow does not provide a binary upload or session attachment API.
