---
description: Write task inputs to an agent's workspace, inspect files, and publish and download artifacts.
---

# Files and artifacts

Give an agent the input it needs, then retrieve the files it produces. Write text inputs into
its `/workspace` through the Files endpoint. To share an output, ask the agent to
publish an Artifact, then retrieve the published record through the API or SDK.

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

Read the agent's ownership for the file and Artifact read requests below:

```bash
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
OWNER_UID=$(jq -er '.ownership.owner_uid' <<<"$agent")
ORG_ID=$(jq -er '.ownership.org_id' <<<"$agent")
```

These query fields must match the agent's ownership. They do not grant access: the API key
must also authorize the agent, including its project scope when applicable. Stop if the
projection has no ownership; do not invent values.

## 1. Write a text input

Use Files SDK helpers or the HTTP examples below for workspace reads and text writes.

Write a small CSV to `/workspace/sales.csv`:

```bash
jq -n --arg content $'month,sales\nJanuary,100\nFebruary,120\nMarch,80\n' \
  '{path: "/workspace/sales.csv", content: $content}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/files" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

`path` and `content` must be strings. Use an absolute path below `/workspace`; path traversal
is rejected. The endpoint writes UTF-8 text and creates parent directories when needed.
Writing an ordinary workspace file returns `{}` and does not update the agent's persona or
configuration version.

This is a text-write endpoint, not a binary or multipart upload. Environment source uploads
are image build inputs, not session attachments. A message's `attachments` array is also not
an upload endpoint: adding a URL to `attachments` does not upload a file into the Agent workspace. See [Capability boundaries](../reference/not-supported.md) before
building a binary input flow.

## 2. Ask the agent to process it

Create a session with the task in its first message:

::: code-group

```ts [TypeScript]
const session = await zc.createSession(agentId, {
  "initial_events": [
    {
      "type": "user.message",
      "content": "Read /workspace/sales.csv. Create /workspace/report.md with a sales table and total. Read it back to verify the total, then publish it with artifact_publish and return the Artifact."
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
                "content": "Read /workspace/sales.csv. Create /workspace/report.md with a sales table and total. Read it back to verify the total, then publish it with artifact_publish and return the Artifact."
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
    "content":"Read /workspace/sales.csv. Create /workspace/report.md with a sales table and total. Read it back to verify the total, then publish it with artifact_publish and return the Artifact."
  }]}')
SESSION_ID=$(jq -er '.session_id' <<<"$session")
```

:::

The prompt requests a tool call; it does not guarantee one. Read the event stream to confirm
that the agent processed the file and published the result:

::: code-group

```ts [TypeScript]
import { isRunFinished } from '@zoowork-ai/sdk'

for await (const event of zc.streamEvents(agentId, sessionId)) {
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

## 3. Download the published Artifact {#4-download-the-published-artifact}

`artifact_publish` publishes an existing non-empty regular file below `/workspace`; directories
and symlinks are rejected. It accepts a `path`, either
absolute or relative to that workspace. Publishing requires an active sandbox and a current
agent run. Direct upload supports files up to 100 MiB;
the fallback publishing path supports up to 25 MiB. Files are not automatically published just
because the agent created them.

List the Artifacts from this session and source path:

::: code-group

```ts [TypeScript]
const artifacts = await zc.listArtifacts(agentId, {
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

const download = await zc.downloadArtifact(agentId, artifactId)
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
await zc.deleteArtifact(agentId, artifactId)
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

## Inspect workspace files {#3-inspect-workspace-files}

Use these optional operations when you need the current workspace file rather than its
published Artifact. List the workspace:

```bash
curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/agents/$AGENT_ID/files" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'path=/workspace' \
  --data-urlencode "owner_uid=$OWNER_UID" \
  --data-urlencode "org_id=$ORG_ID"
```

A directory response contains `path` and `entries`. Each entry has `name`, `type`, `size`,
and `updated_at`. Hidden entries are omitted unless you add `showHidden=true`.

To read text, make the same request with `path=/workspace/report.md`. A file response
contains `{path, content}`. Use the binary endpoint below for PDFs, images, or Office files;
the text endpoint decodes content as UTF-8.

### Download the current file

```bash
curl -sS --fail-with-body --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/files/content" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'path=/workspace/report.md' \
  --data-urlencode "owner_uid=$OWNER_UID" \
  --data-urlencode "org_id=$ORG_ID" \
  --data-urlencode 'download=true' \
  --output current-report.md
```

This endpoint returns raw bytes from the current regular file. The content limit is 100 MiB;
a larger file returns `413 file_too_large`. `download=true` selects attachment disposition;
omitting it selects inline disposition. This download does not publish an Artifact, and its
100 MiB read limit is not an upload limit.

## Analyze PDFs and images

For PDFs or images already available in `/workspace`, ask the Agent to use its `pdf` or
`image` tool. See [Media tools](./tools.md#media-tools) for arguments, model requirements,
and limits. This tool workflow does not provide a binary upload or session attachment API.

## SDK calls

These examples require an SDK release containing the helper. Check the installed exports first; use the HTTP examples if the installed release lacks it.

::: code-group

```ts [TypeScript]
const listing = await zc.getWorkspaceFile(agentId, '/workspace')
await zc.writeWorkspaceFile(agentId, '/workspace/input.txt', 'hello')
const bytes = await zc.getWorkspaceFileContent(agentId, '/workspace/result.bin')
```

```python [Python]
listing = await client.get_workspace_file(agent_id, "/workspace")
await client.write_workspace_file(agent_id, "/workspace/input.txt", "hello")
raw = await client.get_workspace_file_content(agent_id, "/workspace/result.bin")
```

:::

File reads derive ownership selectors from the Agent projection. Content returns raw bytes; text writes do not upload binary files.
