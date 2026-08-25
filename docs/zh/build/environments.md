---
title: Environments
source: /en/build/environments
source_hash: 11fb0e99b5f0acd1b36f59c3d0ac17efa7e3cc9406b1d65dd63ef411c3581882
---

# Environments

::: warning 尚未验证
这个面没有任何一部分被端到端实测过。我们从来没有构建过一个 Environment，没有把它挂到 agent 上过，也没有观察到任何一个沙箱是从它启动的。

SDK 对整个资源都有类型，`listEnvironments()` 返回 `200`。除此之外的一切都是我们没看着它跑过的、有类型的契约。如果你的项目依赖预装的包，请规划一条退路：不带 `environment_id` 的 agent 跑在系统默认之上，今天就能用。
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

`AgentResource` 在顶层接受这两个字段：

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

- `409 environment_not_ready`——你固定的那个版本还在构建，或者它的构建失败了。轮询那个具体版本的 `status`，直到它读出 `ready`；Environment 的顶层行回答不了这个问题。
- `409 environment_locked`——这个 agent 已经创建过它的第一个沙箱。**从那一刻起 Environment 就定死了。** 停止 agent 不会解开这个锁，所以你没法「停掉、改 pin、再启动」。在 agent 的第一个回合之前就把 Environment 选定，否则就新建一个 agent。

跨租户的 `environment_id` 会被隐藏为 `404`，不是 `403`。

## 调用 Environments API

`ZooworkClient` 用六个有类型的方法覆盖了这个资源，它们的失败都被归一成 `ZooworkError`：

| 方法 | 作用 |
|---|---|
| `listEnvironments({ page })` | 你组织内的 Environment，`page` 从 1 开始。 |
| `getEnvironment(environmentId)` | 读一个 Environment。 |
| `createEnvironment({ resource, ownership }, idempotencyKey?)` | 创建一个 Environment 和它的第一个版本。 |
| `archiveEnvironment(environmentId)` | 归档它。 |
| `createEnvironmentVersion(environmentId, config, idempotencyKey?)` | 追加一个不可变版本。构建失败后的重试，重试的是**那个**版本，并保留它的尝试记录。 |
| `getEnvironmentVersion(environmentId, version)` | 读一个版本。这就是你要轮询的调用。 |

平台默认的那个 Environment——新建 agent 被钉上的那个——不出现在 `listEnvironments()` 里，`getEnvironment()` 对它返回 `404`。网关强制加了组织选择器，而默认 Environment 不属于任何组织，所以这是选择器不匹配，不是权限问题。

`listEnvironments()` 返回了 `200` 和一个空列表。这是这条路径上我们真正跑过的唯一一件事。

### 创建一个 Environment

`createEnvironment` 收的是 `{ resource, ownership }`，而且**这里的 `ownership` 是必填的**——和 `createAgent` 不同，那边由网关推导、你直接省略。这一对从任何一个 agent record 的 `ownership` 里取。`resource` 是 `{ name, description?, config }`，其中 `config` 就是上面那个四 key 的对象。

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

第一个版本在 create 的响应里以 `EnvironmentRecord.version` 内联返回，所以不需要再补一次 `getEnvironmentVersion()` 才能看到它。后续版本走 `createEnvironmentVersion(environmentId, config)`，它会把你的 config 包成 `{ resource: { config } }`；这个请求体没有对着线上部署实测过。

这两个调用都给一个稳定的 `Idempotency-Key`。版本根本没有删除接口，而 `archiveEnvironment()` 归档的是整个 Environment——第一个版本删不掉。

### 没有 wrapper 的路由

有四个操作没有对应的客户端方法。对同一个 base URL、用同一个 bearer 发普通 `fetch`：

| 操作 | 请求 |
|---|---|
| 构建日志 | `GET {base}/environments/{environment_id}/versions/{version}/logs?offset=0&limit=200` |
| 重试一次失败的构建 | `POST {base}/environments/{environment_id}/versions/{version}/retry` |
| 申请文件上传 | `POST {base}/environments/uploads` |
| 完成一次上传 | `POST {base}/environments/uploads/{upload_id}:finalize` |

用日志响应返回的 `next_offset` 增量地读日志。自己拼路径时，把里面的冒号百分号编码：裸的 `:` 会让引擎匹配不到路由，返回 `404`。

## 构建状态

轮询**那个版本**，不是 Environment，而且字段叫 `status`——版本上没有 `state`，照着 `state` 写的循环会永远拿 `undefined` 和 `'ready'` 比。

```ts
const version = env.version!.version!
let v = await zc.getEnvironmentVersion(env.environment_id, version)

while (v.status !== 'ready' && v.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 2000))
  v = await zc.getEnvironmentVersion(env.environment_id, version)
}
if (v.status === 'failed') throw new Error(`${v.failure_stage}: ${v.failure_message}`)
```

一个版本依次经过 `queued`、`submitting`、`building`、`verifying`、`ready`。任何一个阶段都可能以 `failed` 结束，`failure_stage` 会点名是哪一个。Environment 自己的 `status` 是 `active` 或 `archived`——那是生命周期，不是构建进度，构建跑着的整段时间里它都读作 `active`。

Environment 这一行带着两个版本号，它们不是同一个号。`latest_version` 是**创建**出来的最新版本：你刚创建完 Environment 的那一瞬间它就是 `1`，而那个版本还在 `queued`。`latest_ready_version` 是最新一个构建完成的版本，在有构建落地之前它是 `null`。**要 pin 的是 `latest_ready_version`。** pin 了 `latest_version`，agent 的 create 拿到的就是上面那个 `409 environment_not_ready`。

## 相关

- [Agents](/zh/build/agents)——完整的 agent 资源和 `config_version` 语义。
- [工具](/zh/build/tools)——在这个 Environment 构建出的沙箱里，agent 能做什么。
- [能力矩阵](/zh/reference/capabilities)——整套 API 的验证状态。
