---
title: Skills
source: /en/build/skills
source_hash: 50d01b7e1e88247ffee3fc08165280122e1f82a4720d73276353bf8127118291
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
  [k: string]: unknown
}
```

实测回来的行比类型里写的多——还有 `description`、`location`（`/skills/<name>/SKILL.md`）、`basePath`（`/opt/zooclaw/skills/<scope>/<name>/<version>`）、`contentHash` 和 `promptVersion`。它们通过索引签名可达，也是确认一个 skill 真的落盘了最省事的办法。

`scope` 是决定你能拿这个条目做什么的字段，先读它：

| `scope` | 来自哪里 | 能不能用 API key 安装或移除？ |
|---|---|---|
| `global` | 平台目录。默认挂在每一个 agent 上。 | 不能。见下面的坑。 |
| `org` | 你自己组织上传的。 | 可以——已验证。 |
| `personal` | 挂在某一个用户名下上传的。 | 可以，未验证。 |
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

安装一个 `org` skill 是**端到端已验证**的：该 skill 从 `listAgentSkills` 回来时 `eligible: true`，并在下一个回合按它自己的内容作答。`deleteAgentSkill` 是**可用但未验证**；请用 `listAgentSkills` 检查结果，不要相信返回的 `config_version`。

## 找到 skill id

`listSkills()` 返回你这个 key 能看到的目录：global 条目，加上你自己组织上传的东西。

```ts
const all = await zc.listSkills()
const mine = await zc.listSkills({ scope: 'org' })
const found = await zc.listSkills({ q: 'market', page: 1 })
```

选项只有 `scope`、`q`、`page`。`q` 按 name 匹配；`page` 从 1 开始，页大小固定 100。

一行是一个 `SkillRecord`——`skill_id`、`scope`、`name`、`description`、`latest_version`、`status`、`ownership`。有两个形状要有心理准备：`org` scope 的 skill，`ownership.owner_uid` 回来是 **null**（它属于组织，不属于某个人）；`latest_version` 从 multipart 创建那条路回来是**字符串** `"1"`，而别的地方写成数字——请松散比较，或者 `Number()` 一下。

## 写一个真的会触发的 skill

::: danger `description` 是触发面，正文是载荷
agent 判断要不要加载你的 skill，读的**只有 frontmatter 里的 `description`**。正文是之后才读的，而且只有在 description 胜出时才读。一个描述「这个 skill 是什么」的 description 永远不会触发，正文写得再好也没用。

```yaml
# 永不触发——它在描述这个东西是什么
description: 我们办公室咖啡吧的资料。

# 会触发——它在描述什么场合该用
description: 用户询问办公室咖啡菜单、咖啡价格，或者想点一杯咖啡时使用——包括提到拿铁、
  espresso、美式的时候。
```

这是这套 API 里**唯一一个每一步都返回成功**的失败。一个 skill 可以上传成功、安装成功、在列表里 `eligible: true`，然后一次都没触发，因为触发词写在正文里，而 description 只写了这东西是什么。只改 description、其他一个字没动，下一个回合就触发了。

当一个 skill「什么也没做」时，先查 description，再查别的。
:::

把 description 写成**什么时候用它**，并且把用户真的会说出口的词放进去。agent 该知道、该做的一切放正文。

## 上传你自己的 skill

一个 skill 是一个 zip，里面含单个顶层目录（或者根目录直接放着 `SKILL.md`）。`SKILL.md` 必须是非空的 UTF-8，frontmatter 里带 `name` 和 `description`。`name` 必须匹配 `^[a-z0-9-]{1,64}$`。解压后总大小上限 50 MB，路径里不能出现 `..`、绝对路径或反斜杠，加密的 zip 会被拒绝。服务端在接收时把归档解开。

::: warning zip 的顶层目录名必须等于 frontmatter 里的 `name`
`coffee-order/SKILL.md` 声明 `name: coffee-order`。不一致会以 400 拒绝，报错里把两个名字都打出来，所以这是摩擦不是陷阱——但它是你手工打包 skill 时第一个会失败的地方。两者比较时不区分大小写、也不区分下划线，所以目录 `Coffee_Order/` 仍然匹配 `name: coffee-order`。这份宽松只针对目录名：frontmatter 里的 `name` 本身仍然必须匹配 `^[a-z0-9-]{1,64}$`。

条目可以是 **stored（不压缩）**，也可以是 deflate，所以一个最小的 zip 写入器就够了；发布一个小 skill 不需要压缩库。
:::

```ts
import { readFile } from 'node:fs/promises'

const zip = await readFile('coffee-order.zip')
const skill = await zc.uploadSkill(zip, { scope: 'org' })
// { skill_id: 'skl_…', scope: 'org', name: 'coffee-order', latest_version: '1', … }

await zc.putAgentSkill(agentId, skill.skill_id)
```

`scope` 必须是 `org` 或 `personal`；这条路由拒绝 `global` 和 `pack`。一次调用同时创建 skill 记录**和**版本 1。

`uploadSkill` 是 create-only。要给一个已存在的 skill 发新版本，用 `uploadSkillVersion(skillId, zip)`——frontmatter 的 `name` 必须和目标 skill 一致。未 pin 版本的 agent 会自己跟随新版本：registry 会 bump 它们的 `config_version`，你**不需要**再调一次 `putAgentSkill`。

`deleteSkill(skillId)` 没有在用保护。持有该 skill 的 agent 就是直接失去它。

## 怎么证明 skill 真的跑了

事件流里没有任何一条说「选中了这个 skill」。`listAgentSkills` 告诉你的是它**挂上了**，不是它**跑了**：

```json
{ "skill_id": "skl_…", "name": "coffee-order", "scope": "org", "version": "1",
  "eligible": true, "location": "/skills/coffee-order/SKILL.md",
  "basePath": "/opt/zooclaw/skills/org/coffee-order/1" }
```

`eligible: true` 加一个真实的 `basePath`，意思是已安装、已落盘。模型有没有加载它，只能从答案里看出来。

所以要像测一个事实那样测它，而不是像测一个函数：**在 skill 里放一点模型不可能自己产出的东西**——一个精确的内部价格、一个产品代号、一条强制的回复格式——然后在安装前后各问一次应该会用到它的问题。

这个前后对比就是完整的验证方式。没挂 skill 时问办公室咖啡价格，agent 会信心十足地编出市场价；挂上之后，它按你的文件作答，连只有那个文件里才有的细节都对。[`skill-lab` quickstart](https://github.com/SerendipityOneInc/zoowork-quickstarts) 跑的正是这个对比，而且每个问题都开新 session，这样第二个答案来自 skill，而不是来自 agent 记得第一次说过什么。

## 这里没有的东西

- **没有 session 级 skill。** skill 属于 agent。session 不能添加、移除或覆盖它们，也没有按 session 的 skill 上限要管理。
- **没有 skill 调用 API。** 你没法让平台去执行一个 skill。由模型决定。
- **没法通过 agent 把 skill 内容读回来。** `listAgentSkills` 给你的是文件清单（`files[]`，带 `path`、`size`、`sha256`），不是文件内容。

## 相关

- [Agents](/zh/build/agents)——`config_version` 的语义，以及为什么每一次 skill 写入都会 bump 它。
- [工具](/zh/build/tools)——内置工具集，那是另一套机制。
- [能力矩阵](/zh/reference/capabilities)——各个面当前的验证状态。
