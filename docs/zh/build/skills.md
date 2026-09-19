---
title: Skills
description: 打包、上传、绑定、检查、更新和移除 agent 的 skill。
source: /en/build/skills
source_hash: de85e3b16b147952108bd89087a06ed27770a3db35379ec62cf4c2b85d6895ea
---

# Skills

skill 是挂在 agent 上的一份打包能力：一个 `SKILL.md` 加上它的配套文件，存在 registry 里，并同步进 agent 的沙箱。模型在它判断这个 skill 相关时去读它。skill 不是工具，也不是你去调用的代码。挂上一个 skill 改变的是 agent 知道怎么做什么；它不会多出一个由你驱动的 API。

skill 挂在 **agent** 这一层。没有 session 级的 skill 列表，也没有按 session 的覆盖。

## 查看已挂载的 Skills

上手不需要安装任何东西。一个刚创建出来的 agent 返回时，整个 global 目录已经挂上了。

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

const skills = await zc.listAgentSkills(agentId)
console.log(skills.length)
for (const s of skills) {
  console.log(`${s.name} v${s.version} [${s.scope}] eligible=${s.eligible}`)
}
```

global 目录可以包含 `docx`、`pptx`、`xlsx`、`pdf` 等文档 Skills。目录会随平台更新，因此应在运行时读取，不要依赖固定数量。

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

返回的行可能带有类型定义之外的字段：`description`、`location`（`/skills/<name>/SKILL.md`）、`basePath`（`/opt/zooclaw/skills/<scope>/<name>/<version>`）、`contentHash` 和 `promptVersion`。它们通过索引签名可达，也是确认一个 skill 已经落盘的直接方式。

`scope` 表示这个条目由谁管理：

| `scope` | 来自哪里 | 管理方式 |
|---|---|---|
| `global` | 平台目录。默认挂在每一个 Agent 上。 | 由平台管理。 |
| `org` | 由你的组织上传。 | 通过 Skills API 管理。 |
| `personal` | 由单个用户上传。 | 通过 Skills API 管理。 |
| `pack` | 由 pack 注入。 | 随 pack 一起管理。 |

`eligible` 报告解析出来的 skill 对这个 agent 是不是真的可用。一个条目可以已经挂上，却仍然不 eligible。

## Global Skills 由平台自动挂载

默认情况下，每个新 Agent 都可以直接使用 global Skills，不需要额外执行安装步骤。
创建不需要这些 Skills 的 Agent 时，在 Agent resource 里设置 `include_global_skills: false`，
或者显式传入 `skills: []`。`include_global_skills: false` 不会删除你显式安装的 Skills，
而且这个 opt-out 在后续 update 和 rerender 后仍然保留。

`putAgentSkill()`
和 `deleteAgentSkill()` 只用于 `org` 或 `personal` scope：

```ts
const catalog = await zc.listSkills()
const customSkills = catalog.filter(
  (skill) => skill.scope === 'org' || skill.scope === 'personal',
)
```

如果把 global skill id 传给 `putAgentSkill()`，API 会返回 `404`。这表示 scope 不适用于该操作，
无需重试。跨租户 skill id 也使用相同状态码，因此应匹配状态码，不要匹配报错文本。

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

对 global 条目执行 DELETE 会恢复平台默认值，而不是移除该 Skill。`org` 和 `personal` Skills 则会从 Agent 上移除。

安装 skill 后，使用 `listAgentSkills()` 检查它是否返回 `eligible: true`。删除后也重新读取列表确认结果；不要只根据返回的 `config_version` 判断安装状态。

## 找到 skill id

`listSkills()` 返回你这个 key 能看到的目录：global 条目，加上你自己组织上传的东西。

```ts
const all = await zc.listSkills()
const mine = await zc.listSkills({ scope: 'org' })
const found = await zc.listSkills({ q: 'market', page: 1 })
```

选项只有 `scope`、`q`、`page`。`q` 按 name 匹配；`page` 从 1 开始，页大小固定 100。

一行是一个 `SkillRecord`——`skill_id`、`scope`、`name`、`description`、`latest_version`、`status`、`ownership`。有两个形状要有心理准备：`org` scope 的 skill，`ownership.owner_uid` 回来是 **null**（它属于组织，不属于某个人）；`latest_version` 从 multipart 创建那条路回来是**字符串** `"1"`，而别的地方写成数字——请松散比较，或者 `Number()` 一下。

## 用 `description` 描述触发条件

Agent 根据 frontmatter 里的 `description` 判断何时加载 Skill。这里应写明适用场景，并包含用户可能说出的关键词。详细指令和参考资料放在正文中。

```yaml
# 太宽泛：只描述这份内容是什么
description: 我们办公室咖啡吧的资料。

# 更合适：描述什么时候使用
description: 用户询问办公室咖啡菜单、咖啡价格，或者想点一杯咖啡时使用——包括提到拿铁、
  espresso、美式的时候。
```

一个 Skill 即使已经挂载并显示 `eligible: true`，也不表示每个回合都会选中它。如果选择范围过宽或过窄，先调整 description。

## 上传你自己的 skill

一个 skill 是一个 zip，里面含单个顶层目录（或者根目录直接放着 `SKILL.md`）。`SKILL.md` 必须是非空的 UTF-8，frontmatter 里带 `name` 和 `description`。`name` 必须匹配 `^[a-z0-9-]{1,64}$`。解压后总大小上限 50 MB，路径里不能出现 `..`、绝对路径或反斜杠，加密的 zip 会被拒绝。服务端在接收时把归档解开。

::: info 保持目录名与 Skill 名称一致
`coffee-order/SKILL.md` 声明 `name: coffee-order`。名称不一致时 API 返回 400，并在错误中列出两个名称。比较时不区分大小写，也不区分下划线，因此目录 `Coffee_Order/` 仍然匹配 `name: coffee-order`。这个规范化只适用于目录名；frontmatter 里的 `name` 仍须匹配 `^[a-z0-9-]{1,64}$`。

条目可以是 **stored（不压缩）**，也可以是 deflate，所以一个最小的 zip 写入器就够了；发布一个小 skill 不需要压缩库。
:::

```ts
import { readFile } from 'node:fs/promises'

const zip = await readFile('coffee-order.zip')
const skill = await zc.uploadSkill(zip, { scope: 'org' })
// { skill_id: 'skl_…', scope: 'org', name: 'coffee-order', latest_version: '1', … }

await zc.putAgentSkill(agentId, skill.skill_id)
```

`scope` 必须是 `org` 或 `personal`；公共网关以 `400` 拒绝其他值。一次调用同时创建 skill 记录**和**版本 1。创建时的 description 来自 ZIP 的 frontmatter，网关不会转发 `uploadSkill` options 中的 `description`。

`uploadSkill` 是 create-only，同 scope、同 name 再次创建会返回 `409`，不是 upsert。超时后先用 `listSkills` 核对结果。版本上传按相同内容去重；不要把 SDK 接受 `idempotencyKey` 理解为这两种上传都保证 HTTP 请求头幂等或 exactly-once。

要给已有 skill 发版本，用 `uploadSkillVersion(skillId, zip)`。它返回 `SkillVersionRecord`：`skill_id`、`version`（string 或 number）、`state`，不是带 `latest_version` 和 `status` 的根记录。`description` option 在版本上传时可以覆盖 frontmatter；frontmatter 的 `name` 必须与目标 skill 一致。

未 pin 版本的 Agent 会跟随新版本，registry 会 bump 它们的 `config_version`；不需要再调一次 `putAgentSkill()`。

调用 `deleteSkill(skillId)` 前，应先从仍在使用它的 Agent 上移除该 Skill。删除会立即对这些 Agent 生效。

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

## Skill 生命周期

- **Agent 级配置。** Skills 属于 Agent，同一个 Agent 的所有 Sessions 使用同一组已挂载 Skills。
- **由模型选择。** 模型根据 description 为每个回合选择相关 Skills。
- **查看文件清单。** `listAgentSkills` 返回每个挂载项的文件清单，包括 `files[]` 中的 `path`、`size` 和 `sha256`。

## 相关

- [每用户一个 agent](./per-user-agents.md)——把一个 org skill 分发到一批按用户划分的 agent 上，含灰度钉版与 reconcile。
- [Agents](./agents.md)——`config_version` 的语义，以及为什么每一次 skill 写入都会 bump 它。
- [工具](./tools.md)——内置工具集，那是另一套机制。
