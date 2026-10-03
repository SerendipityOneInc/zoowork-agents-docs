---
title: Skills
description: 使用 Project API key 打包、上传、发布版本并挂载 Skill，了解 registry 权限和 SDK 兼容要求。
source: /en/build/skills
source_hash: 9f3137112120f1e8c21a8af288147599969baa4bc833547fe42f2341c8b43b8e
---

# Skills

Skill 是一个 `SKILL.md` 文件及其配套文件，用来教 Agent 执行任务。
模型在 description 与任务匹配时读取 Skill。Skill 提供指令，
不会添加可调用的工具，也不会授予工具权限。

Skill 挂载到 Agent。同一个 Agent 的所有 Sessions 使用同一组已挂载 Skills，
没有按 Session 的 Skill override。

## API 可用范围 {#api-availability}

使用在 [ZooWork Platform](https://platform.zoowork.ai) 创建的 Platform API key。
这些 key 可以查看已挂载的 Skills，并管理可见 Skill 的安装关系。在支持 Project key
Skill registry 的服务版本上，还可以列出 registry、上传 ZIP、发布版本，以及删除写权限范围内的 Skill。

下面的 registry 契约已经过**源码核对，但本文没有完成线上验证**。使用前确认目标部署支持该契约。
旧服务版本会拒绝 Project key 的 registry 请求；SDK 存在某个方法，不代表服务端已支持。
读取权限和写入权限不同：

| Key | 创建、发布版本、删除 |
|---|---|
| 具名 Project key | 同一个 Project、同一个组织的 `project` Skill。 |
| Default Project key | 同组织的 `org` Skill；这些 Skill 在组织内共享。 |

API 根据 key 确定归属。创建时传错 scope，包括 `personal` 或 `global`，返回
`400 service_api.invalid_body`。可见不等于可写：具名 Project key 不能修改 org、global 或
personal registry 内容。对无写权限的 ID 操作返回 `404 service_api.not_found`。
把 Skill 挂载到 Agent 是另一项权限检查。

先使用默认 global Skills。共享产品指令可以放在应用自有 Agent 模板的
[persona 文档](./agents.md#resource-的字段)中，见[每用户一个 Agent](./per-user-agents.md)。
Key 的配置和范围见[鉴权](../get-started/authentication.md)。

示例复用[快速开始](../get-started/quickstart.md)中的 client 和 Agent。
TypeScript 设置 `const agentId = agent.agent_id`；Python 复用 `agent_id`，并在 async function 内调用。
curl 示例复用已配置的
`ZOOWORK_API_KEY`、`ZOOWORK_BASE_URL` 和 `AGENT_ID`。

## 上传自定义 Skill {#upload-a-custom-skill}

每个本地 Skill 单独打包。ZIP 包含非空 `SKILL.md`、YAML frontmatter 中的 `name` 和
`description`，以及引用的脚本和资源。可以把 `SKILL.md` 放在 ZIP 根目录，或者把所有文件
放在一个与 frontmatter name 匹配的顶层目录中：

```text
slide-layout/
  SKILL.md       # frontmatter name: slide-layout
  resources/
```

创建新的 ZIP 文件；对旧 ZIP 增量打包可能保留已经删除的文件：

```bash
zip -r slide-layout.zip slide-layout/
```

Description 写在 `SKILL.md` 中；创建时单独传入的 description 选项不会被转发。
不要打包凭据或无关本地文件。Skill 上传用于注册包。要为某个任务给 Agent 一个文件，请[上传到 `/workspace`](./files.md#send-a-file-to-the-agent)。

Default Project key（大多数新 key 都是这种）必须传 `scope=org`，具名 Project key 必须传
`scope=project`。示例使用 `org`；如果你的 key 属于具名 Project，改成 `project`。
不要指定 `org_id` 或 `project_id`。下面的示例会创建资源，应在授权上传时执行，不要用于探测服务能力。

::: code-group

```ts [TypeScript]
import { readFile } from 'node:fs/promises'

const skill = await client.uploadSkill(await readFile('slide-layout.zip'), {
  scope: 'org', // 具名 Project key 使用 'project'。
  fileName: 'slide-layout.zip',
})
const skillId = skill.skill_id
```

```python [Python]
from pathlib import Path

skill = await client.upload_skill(
    Path("slide-layout.zip").read_bytes(),
    scope="org",  # 具名 Project key 使用 "project"。
    file_name="slide-layout.zip",
)
skill_id = skill["skill_id"]
```

```bash [curl]
curl -sS --fail-with-body "${ZOOWORK_BASE_URL%/}/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -F 'scope=org' \
  -F 'files[]=@slide-layout.zip;type=application/zip'
```

:::

`ZOOWORK_BASE_URL` 包含 `/service/v1`。让 HTTP client 自动生成 multipart boundary。
保存返回的 `skill_id`，然后按[安装与移除](#installing-and-removing)挂载到 Agent。
上传成功不会自动完成挂载。

**TypeScript 兼容性：**TypeScript SDK 从 0.10.2 起，`uploadSkill` 接受 `scope: 'project'`。
使用更早的 SDK 时，Default Project 仍可使用 `scope: 'org'`；具名 Project 请升级 SDK，或使用上面的
curl 请求，不要强制类型转换。Python 的 `scope` 参数是字符串。

## 列出 registry Skills {#list-registry-skills}

`listSkills({ q, page })` / `list_skills(q=..., page=...)` 返回一页数组，HTTP 响应是
`{skills: [...]}`。API 从 key 确定 owner、组织和 Project 选择条件。从第 1 页开始按需继续读取；
第一页没有匹配结果，不代表 Skill 不存在。

```ts
const visible = await client.listSkills({ q: 'slide-layout', page: 1 })
```

可见范围包括 global、同组织的 org、同 Project 的 project，以及属于 key owner 且符合组织条件的
personal Skills。读取范围比写入范围更大；修改前检查记录的 scope 和归属。

Skill 上传的 `Idempotency-Key` 不保证重放得到相同结果。创建结果不确定时，先核对已有记录再重试。
重复创建可能返回 `409 skill_exists`。

## 发布新版本 {#publish-a-version}

保持 frontmatter name 不变，向已有 `skill_id` 发布，不要重复创建根记录。
版本响应使用 `version` 和 `state`，不是 `latest_version` 和 `status`。

::: code-group

```ts [TypeScript]
import { readFile } from 'node:fs/promises'

const version = await client.uploadSkillVersion(
  skillId, await readFile('slide-layout.zip'), { fileName: 'slide-layout.zip' },
)
if (version.state !== 'ready') throw new Error(`Skill version is ${version.state}`)
const assigned = await client.listAgentSkills(agentId)
```

```python [Python]
from pathlib import Path

version = await client.upload_skill_version(
    skill_id, Path("slide-layout.zip").read_bytes(), file_name="slide-layout.zip"
)
if version["state"] != "ready":
    raise RuntimeError(f"Skill version is {version['state']}")
assigned = await client.list_agent_skills(agent_id)
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/skills/$SKILL_ID/versions" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -F 'files[]=@slide-layout.zip;type=application/zip'
```

:::

版本发布不改变 Skill 的归属。未固定版本的可变安装关系会跟随新的 ready 版本，固定版本则保持不变。
检查安装关系，并单独[验证运行时使用](#test-a-skill)；上传成功不代表 Agent 读取过该 Skill。

## 删除 registry Skill {#delete-a-registry-skill}

`deleteSkill(skillId)` / `delete_skill(skill_id)` 发送 `DELETE /skills/{skill_id}`，HTTP 204 时无返回值。
它删除的是 registry Skill，不是某一个 Agent 的安装关系。删除组织共享 Skill 前先检查使用者。
只解除一个 Agent 的挂载时，使用 `deleteAgentSkill` / `delete_agent_skill`。
删除也受 key 的 registry 写权限限制；尝试删除可见但只读的 Skill 仍返回 `404 service_api.not_found`。

## Global Skills 由平台自动挂载 {#global-skills-由平台自动挂载}

新 Agent 默认包含平台的 global Skills。目录可以包含 `docx`、`pptx`、`xlsx`、`pdf`
等文档 Skills；应读取已挂载的集合，不要依赖固定数量。

在 Agent resource 中设置 `include_global_skills: false`，可以关闭 global Skills 的自动挂载，
同时保留显式安装关系。显式 `skills: []` 也会关闭自动挂载，但会把精确 Skill 列表纳入 Agent 的
declared 配置；之后单独修改安装关系的调用可能返回 `409 source_owned_skills`。

## 查看已挂载的 Skills {#inspect-attached-skills}

列出 Agent 上生效的 Skills：

::: code-group

```ts [TypeScript]
const skills = await client.listAgentSkills(agentId)
for (const skill of skills) {
  console.log(skill.skill_id, skill.name, skill.version, skill.eligible)
}
```

```python [Python]
skills = await client.list_agent_skills(agent_id)
for skill in skills:
    print(skill["skill_id"], skill["name"], skill["version"], skill["eligible"])
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

两个 SDK 都返回数组。HTTP 响应包装为 `{skills: [...]}`。
每个条目包含 `skill_id`、name、scope、version 和 eligibility。

## Agent 怎么读取 Skill {#how-the-agent-reads-a-skill}

初始 prompt 包含每个生效 Skill 的名称、description 和 location。
任务匹配时，模型可以读取 `SKILL.md`、引用文件，并按需执行脚本。

Skill 教 Agent 使用已有能力。`read` 可以读取 Skill 文件；
`write`、`edit` 和 `apply_patch` 不能修改 Skill 目录。生成的输出放在 sandbox 的可写目录。
脚本仍然需要允许使用的工具、已安装的软件和网络访问。
Metadata 中的安装步骤不会自动执行。

## 安装与移除 {#installing-and-removing}

使用 key 和 Agent 都可见的已有 `skill_id`。这个操作修改安装关系，
不会创建或上传 Skill。使用上传响应、可见 registry 或已有挂载条目中的 ID。
先上传一次，再把同一个 Skill 挂载给需要它的 Agents。

将这个 ID 赋给 TypeScript 的 `skillId`、Python 的 `skill_id`，或 curl 的 `SKILL_ID`。

固定安装版本时，选择该 Skill 的一个 ready 版本。
把下面的 `1` 替换成需要使用的版本：

::: code-group

```ts [TypeScript]
const receipt = await client.putAgentSkill(agentId, skillId, {
  enabled: true,
  versionPin: 1,
})
console.log(receipt.config_version, receipt.warnings)
```

```python [Python]
receipt = await client.put_agent_skill(
    agent_id, skill_id, enabled=True, version_pin=1
)
print(receipt.get("config_version"), receipt.get("warnings"))
```

```bash [curl]
curl -sS --fail-with-body --request PUT \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"version_pin":1}'
```

:::

| 设置 | TypeScript | Python / HTTP | 行为 |
|---|---|---|---|
| 启用安装关系 | `enabled` | `enabled` | SDK 默认 `true`；HTTP 必须传 boolean。`false` 表示禁用。 |
| 固定 ready 版本 | `versionPin` | `version_pin` | 版本号表示固定该版本；省略或 `null` 表示跟随最新 ready 版本。 |

新的 ready 版本可用时，未固定版本的可变安装关系会异步跟随。
Agent 在 turn 边界重新加载配置；进行中的 turn 可能使用旧版本结束。
读取已挂载列表，确认实际生效的版本。

移除安装关系：

::: code-group

```ts [TypeScript]
await client.deleteAgentSkill(agentId, skillId)
```

```python [Python]
await client.delete_agent_skill(agent_id, skill_id)
```

```bash [curl]
curl -sS --fail-with-body --request DELETE \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills/$SKILL_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

移除 `org`、`project` 或 `personal` 安装关系，会从 Agent 上解除该 Skill。
移除 global 安装关系会恢复 Agent 的默认 global-Skill 策略，
不会删除平台目录里的条目。

每次成功写入或移除安装关系都会增加 `config_version`，即使内容没有变化。
检查响应中的 warnings。超时后先读取已挂载列表、核对结果，再决定是否重试。
移除后也重新读取列表。

## 查看 Skill 详情 {#inspect-skill-details}

使用 verbose 结果，包含被禁用、被遮蔽或不 eligible 的条目：

::: code-group

```ts [TypeScript]
const entries = await client.listAgentSkills(agentId, { verbose: true })
console.log(entries)
```

```python [Python]
entries = await client.list_agent_skills(agent_id, verbose=True)
print(entries)
```

```bash [curl]
curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/agents/$AGENT_ID/skills" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'verbose=true'
```

:::

条目可能包含 `description`、`location`、`basePath`、`contentHash`、`promptVersion`，
以及带 `path`、`size`、`sha256` 的文件清单。
这些描述解析后的配置，不是对当前 sandbox 文件系统的检查。

`scope` 描述可见范围：

| Scope | 可见范围 |
|---|---|
| `global` | 平台管理的目录。 |
| `org` | 在组织内共享。 |
| `project` | 限于所属组织和 Project。 |
| `personal` | 属于 key 的 owner，且不属于组织，或属于 key 的组织。 |

安装访问同时检查 key 和 Agent。知道 Skill ID 不表示有权访问它。

### 诊断有效集合 {#diagnose-the-effective-set}

默认列表包含生效且在 prompt 中可见的集合。Verbose 结果可能包含 `excluded`，
说明条目为什么缺失。`eligible` 描述 requirements 检查，不表示文件已经投递或模型已经使用。

Prompt 最多包含 64 个 Skills，按名称稳定排序。额外条目标记为 `excluded: 'truncated'`。
Session-scope sandbox 排除 personal-scope 的 Skill location；
verbose 结果可能显示 `excluded: 'mount-scope'`。

Binary requirement 可能带有 `eligibility: 'unverified'`，这不表示所需命令已经安装。
已提供的软件见[云沙箱参考](./cloud-sandbox-reference.md)。
Sandbox 无法提供的能力，可以通过
[应用执行的工具](./tools.md#应用执行的自定义工具)提供。

## 处理安装错误 {#handle-assignment-errors}

不存在或不可访问的 Skill ID 返回 `404`。重试前检查 key 范围和 Skill 可见性。
Registry 写操作还必须符合 [API 可用范围](#api-availability)中的 key 写权限。

安装调用返回 `409 source_owned_skills` 时，精确 Skill 列表属于 Agent 的 declared 配置。
应由管理 Agent 的应用修改这份配置，不要继续重试单独修改安装关系的调用。
精确列表中的版本不会自动跟随 registry 更新。

## 测试 Skill {#test-a-skill}

使用新的 Sessions，分别测试应该使用 Skill 的任务、不相关任务，以及和其他已挂载 Skills 重叠的任务。
按预期事实和格式检查答案或输出，并记录结果对应的 Skill 版本、Agent 配置版本和模型。

条目已挂载或 `eligible: true`，不表示模型读取过该 Skill。
事件流没有专门的 Skill-selection 事件。
工具读取记录和最终答案可以帮助检查它是否被使用。

## 相关 {#related}

- [每用户一个 Agent](./per-user-agents.md)：共享应用自有的配置模板。
- [Agents](./agents.md)：配置版本与更新行为。
- [工具](./tools.md)：可调用的能力与权限策略。
