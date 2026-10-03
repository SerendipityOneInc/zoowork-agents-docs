---
title: 文件与产物
description: 把任务输入写入 Agent 工作区，查看文件，并发布和下载产物。
source: /en/build/files
source_hash: 953ceca70efb74f8349719744ebb9ec70976dcab31aecbe27c1c28ea706409b0
---

# 文件与产物

给 Agent 提供任务所需的输入，再获取它生成的文件。通过 Files endpoint 把文本输入写入它的 `/workspace`。需要分享输出时，让 Agent 发布 Artifact，然后通过 API 或 SDK 获取已发布的记录。

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

读取 Agent 的 ownership，供下面的文件和 Artifact 读请求使用：

```bash
agent=$(curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY")
OWNER_UID=$(jq -er '.ownership.owner_uid' <<<"$agent")
ORG_ID=$(jq -er '.ownership.org_id' <<<"$agent")
```

这些 query 字段必须与 Agent 的 ownership 相符。它们不授予权限：API key 仍需有权访问 Agent，包括适用时的 project scope。projection 没有 ownership 时应停止，不要自己编造值。

## 1. 写入文本输入 {#1-write-a-text-input}

workspace 文件读取和文本写入可以使用 Files SDK 方法或以下 HTTP 示例。

把一个小 CSV 写入 `/workspace/sales.csv`：

```bash
jq -n --arg content $'month,sales\nJanuary,100\nFebruary,120\nMarch,80\n' \
  '{path: "/workspace/sales.csv", content: $content}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/files" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

`path` 和 `content` 都必须是字符串。使用 `/workspace` 下的绝对路径；path traversal 会被拒绝。endpoint 写入 UTF-8 文本，并在需要时创建父目录。写入普通工作区文件返回 `{}`，不会更新 Agent 的 persona 或 configuration version。

这是文本写入 endpoint，不是 binary 或 multipart upload。Environment source uploads 是镜像构建输入，不是 session 附件。消息的 `attachments` 数组也不是上传 endpoint：把 URL 放进 `attachments` 不会将文件上传到 Agent 工作区。构建 binary 输入流程前，先查看[能力边界](../reference/not-supported.md)。

## 2. 让 Agent 处理文件 {#2-ask-the-agent-to-process-it}

创建一个 session，把任务放在第一条消息中：

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

prompt 请求一次工具调用，不保证它一定发生。读取 event stream，确认 Agent 已处理文件并发布结果：

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

等待 `run.finished`，确认 `payload.status` 为 `succeeded`，然后按 Ctrl+C。stream 会继续为后续回合保持连接。发布失败或需要审批时，先查看 [Session events](./events.md)，再请求下载。

## 3. 下载已发布的 Artifact {#4-download-the-published-artifact}

`artifact_publish` 发布 `/workspace` 下已有、非空的 regular file；目录和 symlink 会被拒绝。参数是 `path`，可以是绝对路径，也可以相对于工作区。发布需要 active sandbox 和当前 Agent run。direct upload 路径支持最大 100 MiB 的文件；fallback 发布路径支持最大 25 MiB。Agent 创建文件后，不会自动把它发布为 Artifact。

按这个 session 和 source path 列出 Artifacts：

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

page 包含 `{artifacts, page, has_more}`。分页从 1 开始；`limit` 默认 50，最大 100。还可以用 ISO timestamp 格式的 `created_before` 过滤。如果没有 ready record，应查看 run 和 Artifact 状态，不要自己构造 ID 或 URL。`has_more` 为 true 时，继续读取下一页。record 可以处于 `pending`、`ready`、`failed`、`deleted`。查看单条 record 时，使用 `GET /agents/{agent_id}/artifacts/{artifact_id}`，并带上相同的 `owner_uid`、`org_id` query 字段。

先请求 access URL，再下载文件；不要给 Artifact 下载请求添加 API key：

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

下载响应是 `{artifact_id, url}`。record 没有 ready download URL 时返回 `409 artifact_not_ready`。手写 HTTP path 时，把 action 冒号编码为 `%3A`。

SDK 已提供 `listArtifacts`、`getArtifact`、`downloadArtifact`、`deleteArtifact`；签名和 filter 见 [Artifacts reference](../reference/typescript-sdk.md)。这些读取方法不意味着存在对应的上传方法。

### Access URL 与删除 {#access-urls-and-deletion}

把 Artifact URL 当作 bearer credential：拿到它的人就能读取文件。根据 deployment，URL 可能是平台 resolver URL，也可能是直接的 object-store presigned URL。resolver URL 检查 record 当前的 access version 和 ready status；删除 Artifact 后，后续 resolver 访问会被拒绝。此前签发的 presigned URL 可能在过期或存储对象被移除前继续可用。删除不能保证立即撤销已经分享的所有 URL，包括跟随 resolver redirect 后取得的 presigned URL。

应用不再需要一个 ready Artifact 时，可以删除它：

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

已经 deleted 的 record 会直接返回，不会再次执行删除。其他非 ready 状态返回 `409 artifact_not_ready`。删除 Artifact 不会删除工作区 source file。再次请求 download URL，也不保证得到不同 URL：record 的 access version 不变时，resolver URL 可以保持稳定。

## 查看工作区文件 {#3-inspect-workspace-files}

需要当前工作区文件，而不是已发布 Artifact 时，可以使用这些可选操作。列出工作区：

```bash
curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/agents/$AGENT_ID/files" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'path=/workspace' \
  --data-urlencode "owner_uid=$OWNER_UID" \
  --data-urlencode "org_id=$ORG_ID"
```

目录响应包含 `path` 和 `entries`。每个 entry 有 `name`、`type`、`size`、`updated_at`。默认省略隐藏文件；添加 `showHidden=true` 才显示。

读取文本时，把相同请求的路径改为 `path=/workspace/report.md`。文件响应包含 `{path, content}`。PDF、图片或 Office 文件应使用下面的 binary endpoint；文本 endpoint 按 UTF-8 解码内容。

### 下载当前文件 {#download-the-current-file}

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

这个 endpoint 返回当前 regular file 的原始字节。内容上限是 100 MiB；更大的文件返回 `413 file_too_large`。`download=true` 选择 attachment disposition，省略时选择 inline disposition。这个下载不会发布 Artifact，100 MiB 的读取上限也不是上传上限。

## 分析 PDF 与图片 {#analyze-pdfs-and-images}

PDF 或图片已经位于 `/workspace` 时，让 Agent 使用 `pdf` 或 `image` 工具。参数、模型要求和限制见[图像与 PDF 工具](./tools.md#图像与-pdf-工具)。这个工具流程不提供 binary upload 或 Session attachment API。

## SDK 调用

以下示例要求安装包含该方法的 SDK release。先检查已安装的 exports；缺少方法时使用本页 HTTP 示例。

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

文件读取会从 Agent projection 获取 ownership selectors。content 方法返回原始 bytes；文本写入不提供 binary upload。
