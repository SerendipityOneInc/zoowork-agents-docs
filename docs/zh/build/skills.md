---
title: Skills
source: /en/build/skills
source_hash: 4bc7f4d31618e06e3d5c1822580d5c7d5b6b78096290d254bf057f6db7f5764c
---

# Skills

skill 是挂在 agent 上的一份打包能力：一个 `SKILL.md` 加上它的配套文件，存在 registry 里，并同步进 agent 的沙箱。模型在它判断这个 skill 相关时去读它。skill 不是工具，也不是你去调用的代码。挂上一个 skill 改变的是 agent 知道怎么做什么；它不会多出一个由你驱动的 API。

skill 挂在 **agent** 这一层。没有 session 级的 skill 列表，也没有按 session 的覆盖。

## 新建的 agent 已经带着 skill

上手不需要安装任何东西。一个刚创建出来的 agent 返回时，整个 global 目录已经挂上了。

```ts
import { createZooclawClient } from '@zooclaw-agents/sdk'

const zc = createZooclawClient({ apiKey: process.env.ZOOCLAW_API_KEY })

const skills = await zc.listAgentSkills(agentId)
console.log(skills.length)
for (const s of skills) {
  console.log(`${s.name} v${s.version} [${s.scope}] eligible=${s.eligible}`)
}
```

在我们对一套真实部署的实测里，一个几秒前刚建出来的空 agent 返回了 21 条，每一条都是 `scope: 'global'`，其中包括 `docx`、`pptx`、`xlsx`、`pdf` 这类文档 skill。具体目录由部署决定，所以去读它，不要假定这个数字。

传 `{ verbose: true }` 可以把被遮蔽的和不可用的条目也带上：

```ts
const all = await zc.listAgentSkills(agentId, { verbose: true })
```

### 一个条目长什么样

`listAgentSkills` 返回 `AgentSkill[]`：

```ts
interface AgentSkill {
  skill_id?: string
  name?: string
  version?: number | string
  scope?: 'global' | 'org' | 'personal' | 'pack' | string
  eligible?: boolean
  files?: { path: string; size?: number; sha256?: string }[]
}
```

`scope` 是决定你能拿这个条目做什么的字段，先读它：

| `scope` | 来自哪里 | 能不能用 API key 安装或移除？ |
|---|---|---|
| `global` | 平台目录。默认挂在每一个 agent 上。 | 不能。见下面的坑。 |
| `org` | 你自己组织上传的。 | 原则上可以。 |
| `personal` | 挂在某一个用户名下上传的。 | 原则上可以。 |
| `pack` | 由组装好的 pack 注入。 | 不能通过这套 API。 |

`eligible` 报告解析出来的 skill 对这个 agent 是不是真的可用。一个条目可以已经挂上，却仍然不 eligible。

## 坑：global skill 能列出来，但装不上

::: danger 用 API key 安装 global skill 返回 404
```ts
try {
  await zc.putAgentSkill(agentId, 'skl_some_global_skill')
} catch (e) {
  // ZooclawError, status 404
}
```

这不是 skill id 写错了，也不是一个你能靠配置绕开的权限 bug。你的 API key 背后的安装端点只接受你自己组织所拥有的 skill：`org` 和 `personal` scope。一条 `global` 目录条目在每一次列表里都可见，而在安装时回 404。

损失比看上去小：**global skill 本来就已经挂上了** 。被拒绝的不是这个能力，是对它的控制权。不要写一个「把目录里发现的 global skill 装上去」的开通步骤，也不要重试这个 404。
:::

匹配状态码，不要匹配报错文本：

```ts
import { ZooclawError } from '@zooclaw-agents/sdk'

try {
  await zc.putAgentSkill(agentId, skillId)
} catch (e) {
  if (e instanceof ZooclawError && e.status === 404) {
    // Either the skill is global, or it belongs to another tenant.
    // Cross-tenant ids are hidden as 404 rather than 403.
  }
  throw e
}
```

## 安装与移除

```ts
// Attach, following the latest published version.
const { config_version, warnings } = await zc.putAgentSkill(agentId, skillId)

// Attach, pinned to version 1.
await zc.putAgentSkill(agentId, skillId, { versionPin: 1 })

// Attach but disabled.
await zc.putAgentSkill(agentId, skillId, { enabled: false })

// Remove the installation row.
await zc.deleteAgentSkill(agentId, skillId)
```

签名，来自 SDK client：

```ts
putAgentSkill(
  agentId: string,
  skillId: string,
  opts?: { enabled?: boolean; versionPin?: number | null },
): Promise<{ config_version?: number; warnings?: string[] }>

deleteAgentSkill(agentId: string, skillId: string): Promise<void>
```

`enabled` 默认是 `true`，`versionPin` 默认是 `null`。null 的 pin 表示跟随 latest：新的 ready 版本发布时，平台 bump agent 的 `config_version`，下一个回合就解析到新版本，不需要再 PUT 一次。

两个调用成功时都会 bump `config_version`，每一次都会，即使什么都没改。**两者都不是无副作用的重放。** 网络超时之后，先调 `listAgentSkills` 对账，再重试。

移除一条 `global` 条目并不会把它摘下来。按平台文档描述的行为，对一个 global skill 发 DELETE，删掉的是你的覆盖、恢复的是默认值；只有 `org` 和 `personal` skill 会被真正卸载。

::: warning 尚未验证
我们的实测只对 `global` skill 试过 `putAgentSkill`，也就是上面那个 404。我们**没有** 观察到 `org` 或 `personal` skill 安装成功，`deleteAgentSkill` 也从来没有对一套真实部署跑过。

路由是存在的，SDK 也调对了。在依赖它之前请自己验证行为，并用 `listAgentSkills` 检查结果，不要相信返回的 `config_version`。
:::

## 找到 skill id

SDK 没有目录相关的方法。registry 的列表就是对同一个 base URL、用同一个 bearer 发一次普通 `fetch`：

```ts
const base = process.env.ZOOCLAW_BASE_URL!
const res = await fetch(
  `${base}/skills?owner_uid=${encodeURIComponent(ownerUid)}&org_id=${encodeURIComponent(orgId)}`,
  { headers: { Authorization: `Bearer ${process.env.ZOOCLAW_API_KEY}` } },
)
const { skills } = await res.json() as {
  skills: { skill_id: string; name: string; scope: string }[]
}
```

这条路由要求两个选择器都传。结果是可见的 global 目录，并上匹配这两个锚点的内容，所以传占位符照样返回 200 和那些 global 条目。要看到你自己组织上传的 skill，你必须传它创建时真实的 `org_id` 或 `owner_uid`。

## 上传你自己的 skill

一个 skill 是一个 zip，里面含单个顶层目录（或者根目录直接放着 `SKILL.md`）。`SKILL.md` 必须是非空的 UTF-8，frontmatter 里带 `name` 和 `description`。`name` 必须匹配 `^[a-z0-9-]{1,64}$`。解压后总大小上限 50 MiB，路径里不能出现 `..`、绝对路径或反斜杠，加密的 zip 会被拒绝。服务端在接收时把归档解开。

创建是对同一个 base URL 上的 `/skills` 发一个 multipart POST，scope 和 ownership 锚点跟文件一起传：

```bash
curl -X POST "$ZOOCLAW_BASE_URL/skills" \
  -H "Authorization: Bearer $ZOOCLAW_API_KEY" \
  -F "files[]=@market-research.zip" \
  -F "scope=personal" \
  -F "owner_uid=usr_example"
```

`scope` 必须是 `personal` 或 `org`；这条路由拒绝 `global`。成功时创建一条 skill 记录加版本 1，响应里带 `skill_id` 和 `latest_version: 1`。后续版本发到 `POST /skills/{skill_id}/versions`，用同样的 multipart 表单。

::: warning 尚未验证
上传路由是存在的，平台也有文档，但我们没有跑过。我们不会发布一套自己没执行过的分步流程，也没法告诉你网关在实际中拿 `scope` 和 ownership 这两个表单字段做了什么。

如果你要试：先上传，再用上面的目录列表确认，然后 `putAgentSkill`，再用 `listAgentSkills` 证明确实挂上了。不要因为上一步成功了，就假定这一步也成功了。
:::

## 这里没有的东西

- **没有 session 级 skill。** skill 属于 agent。session 不能添加、移除或覆盖它们，也没有按 session 的 skill 上限要管理。
- **没有 skill 调用 API。** 你没法让平台去执行一个 skill。由模型决定。
- **没法通过 agent 把 skill 内容读回来。** `listAgentSkills` 给你的是文件清单（`files[]`，带 `path`、`size`、`sha256`），不是文件内容。

## 相关

- [Agents](/zh/build/agents)——`config_version` 的语义，以及为什么每一次 skill 写入都会 bump 它。
- [工具](/zh/build/tools)——内置工具集，那是另一套机制。
- [能力矩阵](/zh/reference/capabilities)——各个面当前的验证状态。
