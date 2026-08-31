---
title: 每用户一个 agent
description: 为每个用户创建隔离的 agent，并安全地批量更新配置。
source: /en/build/per-user-agents
source_hash: cbb25b2d194f8e1fd18b897c2965eff4a10033af62f9dd500f56c53be0d82ca0
---

# 每用户一个 agent

一种常见的产品形态：你构建了一个 agent，用户账号体系由你自己维护，每个用户都应该得到一份自己的副本——自己的沙箱、自己的文件、自己的记忆。同时你还在持续迭代这个 agent 的行为，每份副本都应该自动跟上变化，而不需要你逐个去改。

这一页讲的就是这个模式。一句话版本：**给每个用户一个自己的 agent，把你要迭代的行为放进一个 `org` scope 的 skill，每个 agent 不钉版本（unpinned）地安装它。** fleet 各自散开；skill 只有一份。发布一个新的 skill 版本，所有 agent 自动更新。

## 为什么是每用户一个 agent，而不是一个 agent 开多个 session

如果只是要按用户隔离*对话*状态，一个 agent、每个会话一个 session 就够了，而且更便宜——见 [Sessions](./sessions.md)。当用户之间不能共享 transcript **之外**的东西时，才需要每用户一个 agent：

- **沙箱。** 一个 agent 只有一个沙箱，它的每个 session 都工作在同一个持久的 `/workspace` 里。一个 session 写的文件，另一个 session 读得到。如果多个用户共享一个 agent，就意味着一个*用户*写的文件，另一个用户的 turn 读得到。
- **模型侧记忆。** 在部署启用了模型记忆工具的情况下，这些记忆的作用域是 agent 级、跨 session 的——而且它们对 API 不可见，你没有办法事后按用户切分。其状态见[能力矩阵](../reference/capabilities.md)。

单个 agent 内部没有按用户的沙箱，也没有办法按终端用户切分 `/workspace`。隔离的边界画在 agent 上，所以按用户隔离就等于按用户建 agent。

代价也是真实的：每个 agent 都是一个要单独开通和启动的沙箱，agent 级配置（persona、模型、tool policy）现在存在 N 份。这一页余下的部分，就是讲怎么让这 N 份副本不变成 N 个维护负担。

## 把 agent 拆成稳定的壳和移动的核

在创建 fleet 之前，先决定 agent 的哪些部分是你预期会变的：

| 部分 | 存放在哪 | 更新整个 fleet |
|---|---|---|
| skill 内容——指令、工作流、参考文件 | registry 里，只有一份，作为 `org` skill | 自动：发布一个版本，结束 |
| persona / `agent.md`、模型、tool policy | 每个 agent 自己的配置 | 手动：每个 agent 一次 `updateAgent` |

放进表格之后，杠杆就很明显了：**你打算迭代的东西都应该放进 skill。** 让每个 agent 的配置保持成一层薄而稳定的壳——一段很少变化的简短 persona，加上 skill 安装关系——把产品的实际行为放进 skill 的正文。一个 persona 每周都在变的 fleet，代价是一套 rollout 脚本；一个 skill 每周都在变的 fleet，代价是一次 `uploadSkillVersion` 调用。

## 更新为什么会自动传播

[Skills](./skills.md) 里的三个事实组合成了这套机制：

1. `org` scope 的 skill 对你组织下的每个 agent **可见**，但只有通过显式安装才会挂到某个 agent 上。scope 给的是可见性，不是生效——你在其他产品上的其他 agent 不受影响。
2. 不带 `versionPin` 的安装**跟随 latest**：当一个新的 ready 版本发布时，平台会自动 bump 每个安装了它的 agent 的 `config_version`。
3. agent 在**下一个 turn** 重新加载配置。进行中的 turn 用旧版本跑完；下一个 turn 用新版本回答。

所以 builder 侧的循环是：发布一个版本，然后停手。不需要逐 agent 的 PUT，不需要重启，不需要重新部署。传播是异步的、由服务端驱动的；要确认某个 agent 已经切换，读 `listAgentSkills(agentId)` 对比 `version`，不要靠假设。

## Onboarding：每个新用户一次调用

用户注册时，你的后端为 TA 创建 agent，skill 直接写在 create 请求里：

```ts
import { createZooworkClient } from '@zoowork-ai/sdk'

const zc = createZooworkClient({ apiKey: process.env.ZOOWORK_API_KEY })

// 用户注册时：
const agent = await zc.createAgent(
  {
    resource: {
      name: `myproduct-${user.id}`,
      labels: { end_user: user.id },
      skills: [{ skill_id: PRODUCT_SKILL_ID }], // 不传 version -> 跟随 latest
      persona: { docs: [{ name: 'agent.md', content: STABLE_PERSONA }] },
    },
  },
  `user-${user.id}`, // idempotency key，按用户保持稳定
)
await yourDb.users.update(user.id, { agent_id: agent.agent_id })

await zc.startAgent(agent.agent_id)
await zc.waitUntilRunning(agent.agent_id)
```

让这个循环靠得住的四个要点：

- **你的数据库是索引。** 创建时就把 `user.id → agent_id` 存下来。`listAgents` 可以按 `labels` 过滤，作为恢复路径可用，但它的范围是你 key 绑定的用户、每页固定 100 条——它不是你的查询表。
- **传一个稳定的 idempotency key**（从你的用户 id 派生），并把你自己存的映射当作事实来源：任何重试或重复注册，先查自己数据库里有没有已存在的 `agent_id`，再决定是否创建。
- **刚创建的 agent 是停止状态。** 不调 `startAgent` + `waitUntilRunning`，第一个 session 调用会得到 `409 agent_not_running`。等待要看 `desired_state`——见 [Agents](./agents.md)。
- **API key 永远不离开你的后端。** 它是组织级凭据，对组织内每个 agent 都有完整写权限；不存在按用户或降权的变体。浏览器和你的后端通信，你的后端和 ZooWork 通信。

Onboarding 之后，对话就是对该用户自己的 agent 的普通 session：`createSession(agentId, …)`、`postEvents`、`streamEvents`。

## 发布一次更新

```ts
await zc.uploadSkillVersion(PRODUCT_SKILL_ID, newZipBytes)
```

整个 rollout 就是这一行。每个不钉版本安装了这个 skill 的 agent 都会跟上新版本；每个用户的下一个 turn 就跑在新行为上。用户什么都不用做、什么也感知不到——这也意味着：**把一个 skill 版本当成一次 deploy 对待，而不是一份草稿。** 所有活跃用户都在 latest 上。

### 先灰度，再全量

`versionPin` 能把同一套机制变成分阶段发布。把 fleet 钉在当前版本，留下 canary agent 不钉，发布，验证，然后给 fleet 解钉：

```ts
// 发布前：把非 canary 的 agent 钉在正在运行的版本上。
await zc.putAgentSkill(agentId, PRODUCT_SKILL_ID, { versionPin: CURRENT_VERSION })

// 发布。只有不钉版本的（canary）agent 会切换。
await zc.uploadSkillVersion(PRODUCT_SKILL_ID, newZipBytes)

// 满意了？给其余的解钉；它们会切到 latest。
await zc.putAgentSkill(agentId, PRODUCT_SKILL_ID, { versionPin: null })
```

注意每次 `putAgentSkill` 都会 bump 该 agent 的 `config_version`，无论有没有实际变化，所以对 N 个 agent 的一轮钉/解钉扫过去就是 N 次配置写入。这就是它的成本；做好预算，不要随手写成循环。

## 给已有的 fleet 加第二个 skill

发布*新版本*会自动到达所有人；安装*新 skill* 不会——安装关系是按 agent 记录的。这是 fleet 模式里唯一需要扫存量的地方，而且通常可以不用急着扫。把「某个用户的 agent 应该有哪些 skill」这份列表维护在你自己的后端，在用户出现时做 reconcile：

```ts
// 给这个用户开 session 之前：
const installed = new Set(
  (await zc.listAgentSkills(agentId))
    .filter((s) => s.scope === 'org')
    .map((s) => s.skill_id),
)
for (const skillId of DESIRED_ORG_SKILLS) {
  if (!installed.has(skillId)) {
    await zc.putAgentSkill(agentId, skillId)
  }
}
```

先 diff 再写——`putAgentSkill` 即使什么都没改也会 bump `config_version`，所以一个盲目 PUT 一切的循环会在每次开 session 时重写每个 agent 的配置。有了 diff，活跃用户在下次出现时收敛，沉默的 agent 不花任何成本。

## 需要记住的事

- **`deleteSkill` 没有在用守卫。** 删掉一个 fleet 还装着的 org skill，意味着每个 agent 都会悄无声息地失去它。先把 skill 从你的 desired 列表里退役、让 reconcile 把它摘掉（`deleteAgentSkill`），再删 registry 里的条目。
- **只有你自己的 skill 能安装。** `global` 目录条目能列出来，但 `putAgentSkill` 会回 404——而且它们本来就已经挂在 agent 上了。见 [Skills 里的陷阱](./skills.md#坑-global-skill-能列出来但装不上)。
- **skill 的 eligibility 是按 agent 的。** 安装之后，在一个真实 agent 上用 `listAgentSkills` 确认 `eligible: true`，不要假设上传成功就等于处处可用。
- **按 turn 的上下文仍然属于 session。** 每用户一个 agent 解决的是身份和隔离；用户刚点了什么、在哪个套餐上，仍然最适合用 session 里的 `system.message` 送进去，而不是重写 N 份 persona。

## 相关页面

- [Skills](./skills.md) —— 上传规则、版本跟随语义、global skill 的陷阱。
- [Agents](./agents.md) —— `config_version`、启动/停止、`desired_state`。
- [Sessions](./sessions.md) —— 当用户只需要各自独立的对话时，更便宜的模式。
