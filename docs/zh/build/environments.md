---
title: Environments
source: /en/build/environments
source_hash: 1f68daa425b796f34f278f4b7d9e13f55edf692ac92b18fee184b63d3b66ded3
---

# Environments

::: warning 尚未验证
这一页覆盖的是整个 Environments 面，其中没有任何一部分被端到端实测过。

我们确认了的是：这个资源用一个普通 API key 就能访问到。一次列表调用返回 `200` 和一个空列表。仅此而已。我们从来没有构建过一个 Environment，没有把它挂到 agent 上过，也没有观察到任何一个沙箱是从它启动的。

列表调用之外的所有内容都来自平台自己的 API 文档。把它当作这个面的一张地图，不要当作我们走过的操作步骤。如果你的项目依赖预装的包，请规划一条退路：不带 `environment_id` 的 agent 跑在系统默认之上，今天就能用。
:::

Environment 是一份不可变的沙箱模板。你把包、文件和构建脚本声明一次；平台按这份声明构建一个镜像；agent 随后固定到一个确切的已构建版本上。它回答的是「agent 需要我的 Python 依赖」和「agent 只能访问这些主机」这两类问题。

## 一个 Environment 里有什么

| 组成 | 作用 |
|---|---|
| `packages.apt` / `packages.npm` / `packages.pip` | 预装的包。安装顺序是固定的：先 apt，再 npm，最后 pip。 |
| `files` | 写入 `/opt/zooclaw/environment/` 下的受控文件。顶层 `bin/*` 里可执行的文件会被链接进 `/usr/local/bin`。 |
| `build` | 在镜像构建期间运行的脚本，外加一个可选的 `verify_script`——它非零退出会让这个版本失败。 |
| `networking` | `unrestricted`，或者带 `allowed_hosts` 列表的 `limited`。 |

config 对象只接受这四个 key。任何其他 key 都返回 `400 invalid_environment_config`。

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

`networking.type` 取两个值之一，而且只要 `networking` 出现，它就是必填的：

- `unrestricted`——不限制出网。这里不接受 `allowed_hosts`；传了就返回 `400`。
- `limited`——只有 `allowed_hosts` 里的域名可达，其余一律拒绝。条目是域名，支持 `*.` 前缀匹配一级子域名。省略这个列表意味着限制生效、但什么都不放行。

完全省略 `networking` 时，默认是 `{ "type": "unrestricted" }`。

文件路径是规范化后的相对 POSIX 路径。单次请求里的内联 `contentBase64` 解码后合计上限 1 MB；内联内容加直接上传合计上限 50 MB。更大的文件走一套独立的预签名上传流程，它会发一个 `upload_id`，你在 `files[]` 里引用这个 id，而不是内联字节。

## 你绕不开的约束

这些是平台的性质，不是你能改的默认值。

- **三个包管理器，就只有三个。** apt、npm、pip。没有其他安装器钩子。
- **自定义 Environment 永远继承同一个固定的平台基础镜像。** 不支持任意的继承链。你不能从自己的镜像出发。
- **没有 secret，没有运行时凭证，没有自定义环境变量，也没有沙箱启动钩子。** Environment 是一件构建期产物。`build.script` 在镜像被构建时运行，绝不在沙箱启动时运行。如果你的依赖在运行时需要一个 API key，Environment 不是放它的地方。
- **版本不可变。** 构建失败后的重试，重试的是同一个版本，并保留这次尝试和日志历史。
- **skill、persona 和工作区文件不属于 Environment。** 你显式提交包、文件和构建脚本；不会从任何别处推断出什么。

## 把 Environment 固定到 agent 上

这是这个面里唯一被 SDK 类型覆盖的部分。`AgentResource` 在顶层接受这两个字段：

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

`updateAgent` 接受同样这一对：

```ts
await zc.updateAgent(agentId, { environment_id: 'env_example', environment_version: 4 })
```

解析规则：

| 你传了什么 | 会发生什么 |
|---|---|
| 两个都不传 | agent 固定到系统默认。 |
| 只传 `environment_id` | 最新的 ready 版本**在那次请求期间** 被解析出来并固定。 |
| 只传 `environment_version` | `400`。 |
| 两个都传 | 固定到那个确切版本。 |

**agent 启动时不会重新解析 `latest`。** 写入时解析出来的是什么，跑的就永远是什么，直到你 PUT 一个新的 pin。发布一个新的 Environment 版本，对一个已经固定的 agent 不改变任何事。响应里以 `resolved_environment` 报告固定的结果。

要预料到两种错误：

- `409 environment_not_ready`——你固定的那个版本还在构建，或者它的构建失败了。轮询那个具体版本直到它 ready；不要去读 Environment 的顶层状态然后猜。
- `409 environment_locked`——这个 agent 已经创建过它的第一个沙箱。**从那一刻起 Environment 就定死了。** 停止 agent 不会解开这个锁，所以你没法「停掉、改 pin、再启动」。在 agent 的第一个回合之前就把 Environment 选定，否则就新建一个 agent。

跨租户的 `environment_id` 会被隐藏为 `404`，不是 `403`。

## 调用 Environments API

SDK 没有 Environment 相关的方法。`ZooclawClient` 对这个资源什么都没暴露，所以对同一个 base URL、用同一个 bearer 发普通 `fetch`。

::: tip 更底层的逃生口
下面的一切都绕过了 SDK。没有类型检查，没有归一化成 `ZooclawError` 的错误处理，也不保证响应结构在 Developer Preview 的各次发布之间保持稳定。请防御性地解析，并忽略未知字段。
:::

列表调用是我们真正跑过的那一个请求：

```ts
const base = process.env.ZOOCLAW_BASE_URL! // https://claw-interface.ecap.yesy.live/service/v1
const res = await fetch(`${base}/environments`, {
  headers: { Authorization: `Bearer ${process.env.ZOOCLAW_API_KEY}` },
})
console.log(res.status) // 200
console.log(await res.json())
```

它返回了 `200` 和一个空列表。底层路由接受一个 `org_id` 选择器，网关会像处理 agent 那样，用你的 key 把它填上。

这个面的其余部分，来自平台文档：

| 操作 | 请求 |
|---|---|
| 创建 | `POST {base}/environments` |
| 列表 | `GET {base}/environments` |
| 读取 | `GET {base}/environments/{environment_id}` |
| 创建一个版本 | `POST {base}/environments/{environment_id}/versions` |
| 读取一个版本 | `GET {base}/environments/{environment_id}/versions/{version}` |
| 构建日志 | `GET {base}/environments/{environment_id}/versions/{version}/logs?offset=0&limit=200` |
| 重试一次失败的构建 | `POST {base}/environments/{environment_id}/versions/{version}/retry` |
| 归档 | `POST {base}/environments/{environment_id}:archive` |
| 申请文件上传 | `POST {base}/environments/uploads` |
| 完成一次上传 | `POST {base}/environments/uploads/{upload_id}:finalize` |

创建和创建版本应当带一个稳定的 `Idempotency-Key`。第一个版本没有硬删除。

我们不给出完整的创建请求体。我们没有跑过这个调用，而包在上面那个 `config` 对象外面的 `resource` 信封，正是不跑一遍就无法确认的部分。`config` 对象本身由平台逐字写进了文档，本页忠实照录。

## 构建状态

一个版本依次经过 `queued`、`submitting`、`building`、`verifying`、`ready`。任何一个阶段都可能以 `failed` 结束。

轮询**那个具体的版本** ，不要轮询 Environment。Environment 的顶层状态不会告诉你，你固定的那个版本是否可用。用日志响应返回的 `next_offset` 增量地读构建日志。

## 相关

- [Agents](/zh/build/agents)——完整的 agent 资源和 `config_version` 语义。
- [工具](/zh/build/tools)——在这个 Environment 构建出的沙箱里，agent 能做什么。
- [能力矩阵](/zh/reference/capabilities)——整套 API 的验证状态。
