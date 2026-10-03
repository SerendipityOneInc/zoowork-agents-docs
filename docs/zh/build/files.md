---
title: 文件与产物
description: 把文件发送给 Agent，让它创建工作区文件，再发布和下载产物。
source: /en/build/files
source_hash: c097e38c4cf7b1b9e6e389cccdbf9933dd041952feb5c958c0b3638e633892f4
---

# 文件与产物

把输入文件上传到 Agent 的 `/workspace`，或者在 Session 消息中以文本提供任务数据，再让 Agent 处理。需要获取输出时，让 Agent 发布 Artifact，然后通过 API 或 SDK 下载已发布的记录。

工作区文件是某个路径上的当前文件。Artifact 是单独发布的副本，有自己的 ID 和下载 URL。修改工作区文件不会改变已发布的 Artifact。

## 文件隔离 {#file-isolation}

一个 Agent 的所有 sessions 共享 `/workspace`。默认的 `sandbox.scope: 'agent'` 也共享 sandbox 实例。`sandbox.scope: 'session'` 使用不同实例，但挂载同一个 Agent 工作区。因此新 Session 不会创建文件的私有副本。

任务数据和输出应放在 `/workspace`。进程、运行时安装的依赖、`/tmp` 和其他路径，不具有 sandbox 替换后相同的持久化保证。本指南不规定备份策略或保留 SLA。

`actor.ref` 不隔离文件。用户之间不能共享文件时，使用[每用户一个 Agent](./per-user-agents.md)，并在应用中授权每个 Agent/session 请求。

## 开始之前 {#before-you-begin}

示例复用[快速开始](../get-started/quickstart.md)中的 SDK client 和运行中 Agent。curl 使用[鉴权](../get-started/authentication.md)中设置的环境变量。

完成[快速开始](../get-started/quickstart.md)中启动 Agent 的步骤。复用运行中的 `AGENT_ID`，并使用有权访问它的 API key。curl 示例在后端使用 Bash、curl 7.76+ 和 jq 1.6+ 运行。Python 调用放在 async 函数内。key 的访问范围见[鉴权](../get-started/authentication.md)。Artifact 发布还需要发布服务可用。

```bash
export AGENT_ID='your-existing-agent-id'
```

读取 Agent 的 ownership，供下面的 Artifact 请求使用：

```bash
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
OWNER_UID=$(jq -er '.ownership.owner_uid' <<<"$agent")
ORG_ID=$(jq -er '.ownership.org_id' <<<"$agent")
```

这些 query 字段必须与 Agent 的 ownership 相符。它们不授予权限：API key 仍需有权访问 Agent，包括适用时的 project scope。projection 没有 ownership 时应停止，不要自己编造值。

## 把文件发送给 Agent {#send-a-file-to-the-agent}

`uploadFile` 把本地文件复制到 Agent 的 `/workspace`，并返回它的路径。在 Session 消息中写出这个路径，Agent 就会读取该文件。

::: code-group

```ts [TypeScript]
import { readFile } from 'node:fs/promises'

const file = await client.uploadFile(agentId, 'input/report.pdf', await readFile('report.pdf'))
console.log(file.path) // /workspace/input/report.pdf
```

```python [Python]
from pathlib import Path

file = await client.upload_file(agent_id, "input/report.pdf", Path("report.pdf").read_bytes())
print(file["path"])  # /workspace/input/report.pdf
```

```bash [curl]
jq -n --arg data "$(base64 < report.pdf | tr -d '\n')" \
  '{args: ["bash", "-c", "mkdir -p input && printf %s \"$1\" | base64 -d > input/report.pdf", "upload", $data]}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/exec" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @-
```

:::

相对路径以 `/workspace` 为基准，缺少的目录会自动创建。SDK 方法接受 bytes 或字符串，在沙箱内校验文件的 SHA-256 之后，文件才会出现在目标路径，并返回 `path`、`size` 和 `sha256`。

上传通过沙箱命令 API 完成，每个请求携带约 72 KB，速度约为每秒 100 KB，适合几 MB 以内的文件。curl 请求把整个文件放在一个请求里，约 90 KB 以内可用。上传要求使用默认的 `sandbox.scope: 'agent'`。

## 1. 让 Agent 创建并发布文件 {#1-ask-the-agent-to-create-and-publish-a-file}

创建一个 Session，在第一条消息中提供任务数据。Agent 使用文件工具创建报告，再通过 `artifact_publish` 发布：

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

prompt 请求一次工具调用，不保证它一定发生。读取 event stream，确认 Agent 已处理文件并发布结果：

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

等待 `run.finished`，确认 `payload.status` 为 `succeeded`，然后按 Ctrl+C。stream 会继续为后续回合保持连接。发布失败或需要审批时，先查看 [Session events](./events.md)，再请求下载。

## 2. 下载已发布的 Artifact {#4-download-the-published-artifact}

`artifact_publish` 发布 `/workspace` 下已有、非空的 regular file；目录和 symlink 会被拒绝。参数是 `path`，可以是绝对路径，也可以相对于工作区。发布需要 active sandbox 和当前 Agent run。direct upload 路径支持最大 100 MiB 的文件；fallback 发布路径支持最大 25 MiB。Agent 创建文件后，不会自动把它发布为 Artifact。

按这个 session 和 source path 列出 Artifacts：

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

page 包含 `{artifacts, page, has_more}`。分页从 1 开始；`limit` 默认 50，最大 100。还可以用 ISO timestamp 格式的 `created_before` 过滤。如果没有 ready record，应查看 run 和 Artifact 状态，不要自己构造 ID 或 URL。`has_more` 为 true 时，继续读取下一页。record 可以处于 `pending`、`ready`、`failed`、`deleted`。查看单条 record 时，使用 `GET /agents/{agent_id}/artifacts/{artifact_id}`，并带上相同的 `owner_uid`、`org_id` query 字段。

先请求 access URL，再下载文件；不要给 Artifact 下载请求添加 API key：

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

下载响应是 `{artifact_id, url}`。record 没有 ready download URL 时返回 `409 artifact_not_ready`。手写 HTTP path 时，把 action 冒号编码为 `%3A`。

SDK 已提供 `listArtifacts`、`getArtifact`、`downloadArtifact`、`deleteArtifact`；签名和 filter 见 [Artifacts reference](../reference/typescript-sdk.md)。这些读取方法不意味着存在对应的上传方法。

### Access URL 与删除 {#access-urls-and-deletion}

把 Artifact URL 当作 bearer credential：拿到它的人就能读取文件。根据 deployment，URL 可能是平台 resolver URL，也可能是直接的 object-store presigned URL。resolver URL 检查 record 当前的 access version 和 ready status；删除 Artifact 后，后续 resolver 访问会被拒绝。此前签发的 presigned URL 可能在过期或存储对象被移除前继续可用。删除不能保证立即撤销已经分享的所有 URL，包括跟随 resolver redirect 后取得的 presigned URL。

应用不再需要一个 ready Artifact 时，可以删除它：

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

已经 deleted 的 record 会直接返回，不会再次执行删除。其他非 ready 状态返回 `409 artifact_not_ready`。删除 Artifact 不会删除工作区 source file。再次请求 download URL，也不保证得到不同 URL：record 的 access version 不变时，resolver URL 可以保持稳定。

## 分析 PDF 与图片 {#analyze-pdfs-and-images}

PDF 或图片位于 `/workspace` 时（包括你[上传](#send-a-file-to-the-agent)的文件），让 Agent 使用 `pdf` 或 `image` 工具。参数、模型要求和限制见[图像与 PDF 工具](./tools.md#图像与-pdf-工具)。
