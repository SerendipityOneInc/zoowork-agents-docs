---
title: Python SDK 参考
description: 查询公共 API 的 Python SDK client 方法、签名、导出类型、event 与 webhook helper，以及错误类。
source: /en/reference/python-sdk
source_hash: 3c7bc0fed026b9a353c7baeb08993565c7bd47cac96121b23033b4bb48a85f60
---

# Python SDK 参考

`zoowork` package 导出的 client 方法、类型和 helper。

本参考适用于 Python SDK **0.9.0+**。

本页是参考手册。按任务组织的说明请从 [Agents](../build/agents.md)、
[Sessions](../build/sessions.md) 或[快速开始](../get-started/quickstart.md)读起。

## 安装 {#install}

```bash
python -m pip install zoowork
```

package 名是 [PyPI](https://pypi.org/project/zoowork/) 上的 `zoowork`。它要求 **Python 3.11 或更高版本**，package metadata 列出 Python 3.11、3.12、3.13 和 3.14。唯一的运行时依赖是 `httpx`（`>=0.27,<1`）。package 自带类型标注（`py.typed`），webhook 验签只用标准库。

已安装的版本可以从 `zoowork.__version__` 读取。已安装的 package 里还有 `zoowork/CHANGELOG.md`，列出截至当前版本每个 release 新增的内容。

### 异步用法 {#async-usage}

client 是异步的。在 coroutine 里调用它的方法，再用 `asyncio.run()` 运行这个 coroutine：

```python
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        models = await client.list_models()
        print(len(models))

asyncio.run(main())
```

client 的每个方法都是需要 `await` 的 coroutine，只有两个例外：`stream_events()` 和 `iter_agents()` 是 async generator，用 `async for` 消费，不加 `await`。除 `parse_sse()` 外的 event helper 和全部 webhook helper 都是普通的同步函数。

client 持有一个 `httpx.AsyncClient`。请在同一个 event loop 里创建、使用和关闭它。

### 提供 `httpx` transport {#httpx-transport}

`transport` 接受任意 `httpx.AsyncBaseTransport`，会传给 client 内部的 `httpx.AsyncClient`。所有请求都经过它，包括 event stream。离线测试时可以用它返回预设响应：

```python
import httpx
from zoowork import create_zoowork_client

def handler(request: httpx.Request) -> httpx.Response:
    assert request.url.path == "/service/v1/models"
    return httpx.Response(200, json=[{"model": "test-model", "selectable": True}])

async with create_zoowork_client(
    "test-key",
    base_url="https://api.test/service/v1",
    transport=httpx.MockTransport(handler),
) as client:
    print(await client.list_models())  # [{'model': 'test-model', 'selectable': True}]
```

需要加 tracing 时，继承 `httpx.AsyncBaseTransport`，把每个请求转给内部的 `httpx.AsyncHTTPTransport()`，并在自己的 `aclose()` 里关闭这个内部 transport。关闭 client 时会关闭它的 transport。

## 创建 client {#create-the-client}

```python
def create_zoowork_client(
    api_key: str | None = None,
    *,
    base_url: str | None = None,
    timeout: float | httpx.Timeout = 30.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ZooworkClient
```

返回 `ZooworkClient`，等同于不传 `service_token` 调用构造函数：

```python
class ZooworkClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        service_token: str | None = None,
        timeout: float | httpx.Timeout = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None
```

构造时不发请求。缺少 API key 会在构造时抛 `ValueError`；key 错误时构造照常成功，第一次调用返回 `401`。创建一个 client 并复用它，因为它持有 `httpx` connection pool。

在 [ZooWork Platform](https://platform.zoowork.ai) 获取 API key 并充值，设置步骤见 [Authentication](../get-started/authentication.md)。key 决定组织和 Project，但不能代替应用自身的终端用户授权：你仍需认证终端用户，并对每次 Agent 和 Session 访问做授权。

### 配置

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `api_key` | `str \| None` | `None` | ZooWork Platform 中的 API key。解析顺序：这个参数，然后是 `ZOOWORK_API_KEY`。两者都没有时抛 `ValueError`。 |
| `base_url` | `str \| None` | `None` | API 地址，**包含 `/service/v1`**。解析顺序：这个参数，然后是 `ZOOWORK_BASE_URL`，最后是 `DEFAULT_BASE_URL`（`https://clawapi.ecap.gsmo.ai/service/v1`）。只有调用其他 deployment 时才需要设置。末尾的斜杠会被去掉，`/models` 等路径直接拼接在后面。 |
| `timeout` | `float \| httpx.Timeout` | `30.0` | 传给 `httpx`。传数字时同时作用于 connect、read、write 和 pool 等待。 |
| `transport` | `httpx.AsyncBaseTransport \| None` | `None` | 见[提供 `httpx` transport](#httpx-transport)。 |
| `service_token` | `str \| None` | `None` | 仅 `ZooworkClient` 有。另一种 bearer credential；与 `api_key` 同时传入会抛 `ValueError`。公共 API 请求使用 `api_key`。 |

client 在每个请求中以 `Authorization: Bearer <key>` 发送 credential，包括 event stream。key 只放在服务端，通过自己的后端调用 ZooWork。

read timeout 也作用于 `stream_events()`：超过这个时长没有收到任何字节时，`httpx` 抛 `httpx.ReadTimeout`。这时从最后保存的 cursor 重连，做法见 [`stream_events()`](#stream-events)。

### 关闭 client {#close-the-client}

```python
async def aclose() -> None
```

`async with create_zoowork_client() as client:` 返回 client，并在退出时关闭它。不用 `async with` 时，用完后调用 `await client.aclose()`。关闭后不要再使用这个 client。

## 方法 {#methods}

`ZooworkClient` 的方法按本节的方式分组。API 中嵌套在 Agent 下的资源，包括 Session、event、approval、schedule、`wake` 和 `exec`，第一个参数都是 `agent_id`。Skill registry、usage、balance 和 Environment 是顶层资源，不带 `agent_id`。

本页的签名省略 `self`。`*` 之后的参数只能用关键字传。除非方法另有说明，返回值都是 API 响应本身，类型为 `dict`（`JsonObject`，即 `dict[str, Any]`），保留 API 的字段拼写和未知字段。用 `agent["agent_id"]` 或 `agent.get("status")` 读取字段，不要用属性访问。请求 mapping 原样发送，所以 `initial_events`、`userTimezone` 这类 key 保持 API 拼写。

SDK 从不重试请求。非 2xx 响应抛 [`ZooworkError`](#errors)。带 `idempotency_key` 参数的方法把它作为 `Idempotency-Key` header 发送；key 为空或省略时不发这个 header。

**模型**

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_models()` | `list[JsonObject]` | 列出 key 可用的模型目录。只选择 `selectable` 不为 `False` 的行。 |

**Agents**

| 方法 | 返回 | 作用 |
|---|---|---|
| `create_agent(resource, *, ownership=None, idempotency_key=None)` | `JsonObject` | 创建 Agent。返回的是**扁平的创建回执**，不是读取 projection。新 Agent 处于停止状态。 |
| `list_agents(*, labels=None, page=None)` | [`AgentPage`](#agentpage) | 读取 key 的组织、Project 和 owner 范围内的一页 Agent。对这一页 `async for` 会继续读取后续页。 |
| `iter_agents(*, labels=None, page=None)` | `AsyncIterator[JsonObject]` | 跨页逐个返回所有匹配的 Agent。 |
| `get_agent(agent_id)` | `JsonObject` | 读取 Agent。返回 **projection**：配置在 `declared` 下，版本在 `status.config_version`。 |
| `update_agent(agent_id, sections)` | `JsonObject` | PUT 指定的 declared section，按 section 合并。 |
| `delete_agent(agent_id)` | `None` | 软删除 Agent，不会停止它。 |
| `start_agent(agent_id)` | `dict[str, list[str]]` | 把 `desired_state` 设为 `running`。任何 Session 调用前都需要先执行。 |
| `stop_agent(agent_id)` | `dict[str, list[str]]` | 把 `desired_state` 设为 `stopped`。 |
| `wait_until_running(agent_id, *, timeout=30.0, interval=0.5)` | `JsonObject` | 轮询 `status.desired_state`，读到 `running` 后返回该 projection。 |
| `list_agent_skills(agent_id, *, verbose=False)` | `list[JsonObject]` | 列出解析到 Agent 上的 Skill。 |
| `put_agent_skill(agent_id, skill_id, *, enabled=True, version_pin=None)` | `JsonObject` | 为 key 可见的 Skill 创建或更新 assignment。 |
| `delete_agent_skill(agent_id, skill_id)` | `None` | 删除显式的 Skill assignment。 |

**Channels**

Platform key 不能调用 Agent channel 路由，这些方法返回 `404 service_api.not_found`。要接入聊天应用，请在自己的后端授权其用户，再通过 [Session API](../build/sessions.md) 转发消息。见 [Channels](../build/channels.md) 和 [Channel 方法](#channel-methods)。

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_channels(agent_id)` | `list[JsonObject]` | 列出 channel 绑定。 |
| `add_channel(agent_id, channel)` | `JsonObject` | 提交 channel 绑定配置。 |
| `update_channel(agent_id, platform, update=None)` | `JsonObject` | 提交对 channel 绑定的修改。 |
| `remove_channel(agent_id, platform, *, account="default")` | `None` | 请求移除一个 platform/account 绑定。 |
| `start_channel_setup(agent_id, platform, setup=None)` | `JsonObject` | 发起一次引导式 setup 请求。 |
| `poll_channel_setup(agent_id, platform, session_id)` | `JsonObject` | 读取一次 setup 请求的状态。 |
| `cancel_channel_setup(agent_id, platform, session_id)` | `None` | 取消 setup 请求。 |
| `wait_for_channel_setup(agent_id, platform, session_id, *, timeout=600.0, on_poll=None)` | `JsonObject` | 轮询 setup 请求，直到进入终态或超时。 |
| `start_feishu_setup` / `poll_feishu_setup` / `cancel_feishu_setup` / `wait_for_feishu_setup` | 同上 | 上面四个引导式 setup 方法的飞书快捷版本，不需要 `platform` 参数。 |

**Skill registry**

在支持 Project key registry 的部署上，具名 Project key 创建和修改自己的 `project` Skill；Default Project key 创建和修改组织共享的 `org` Skill。列表也会包含可见但只读的记录。部署核验和完整流程见 [Skills](../build/skills.md)。

| 方法 | 返回 | 作用 |
|---|---|---|
| `upload_skill(upload, *, scope, file_name="skill.zip", description=None, idempotency_key=None)` | `JsonObject` | 提交 ZIP，创建 registry Skill 及其第一个版本。 |
| `upload_skill_version(skill_id, upload, *, file_name="skill.zip", description=None, idempotency_key=None)` | `JsonObject` | 提交 ZIP，作为 registry Skill 的新版本。 |
| `list_skills(*, scope=None, q=None, page=None)` | `list[JsonObject]` | 读取一页目录。 |
| `delete_skill(skill_id)` | `None` | 删除 registry Skill。 |

**Sessions 和 events**

| 方法 | 返回 | 作用 |
|---|---|---|
| `create_session(agent_id, session=None, *, idempotency_key=None)` | `JsonObject` | 创建 Session。要求 Agent 正在运行，否则返回 `409 agent_not_running`。 |
| `get_session(agent_id, session_id, *, history=False, limit=None)` | `JsonObject` | 读取 Session，可选附带落盘的 transcript。 |
| `list_sessions(agent_id, *, page=None)` | `list[JsonObject]` | 旧版数字分页通道的一页，最新的在前。 |
| `list_session_page(agent_id, *, cursor="sls1:0", ...)` | [`SessionListPage`](#sessionlistpage) | 带过滤的 cursor 通道的一页。 |
| `archive_session(agent_id, session_id)` | `JsonObject` | 写入 `archived_at`；之后的写操作返回 `409 session_archived`。 |
| `delete_session(agent_id, session_id)` | `None` | 软删除 Session，先取消进行中的 run。 |
| `post_events(agent_id, session_id, events)` | `list[JsonObject]` | 向 Session 写入 user 或 system event，每个 event 返回一项结果。 |
| `list_events(agent_id, session_id, *, cursor=None, types=None, limit=None)` | `list[SessionEvent]` | 读取统一 event log 的一页，包含你自己发送的 input。 |
| `list_events_page(agent_id, session_id, *, cursor=None, types=None, limit=None)` | `tuple[list[SessionEvent], bool \| None, str \| None]` | 同一页，额外返回 `has_more` 和 `next_cursor`。 |
| `list_all_events(agent_id, session_id, *, cursor=None, types=None, page_size=500)` | `list[SessionEvent]` | 沿服务端 cursor 读取全部持久化 event。 |
| `stream_events(agent_id, session_id, *, cursor=None)` | `AsyncIterator[SessionEvent]` | 通过 SSE 流式读取持久化 event，可用 `cursor` 续传。 |

**应用执行的 custom tool**

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_custom_tool_calls(agent_id, *, status=None, session_id=None)` | `list[CustomToolCallRecord]` | 找回待处理的应用执行调用。status 过滤只接受 `"pending"`。 |
| `resolve_custom_tool_call(agent_id, call_id, *, content, is_error=None, resolved_by=None)` | `CustomToolCallRecord` | 为一个待处理调用提交 1–16 个结果块。 |
| `get_custom_tool_call(agent_id, call_id)` | `CustomToolCallRecord` | 读取一个调用，待处理或已终结都可以。 |
| `list_custom_tool_call_page(agent_id, *, status=None, session_id=None, cursor=None, limit=50)` | `JsonObject` | 一页 cursor 结果，保留 `next_cursor` 和 `has_more`。 |

**Approvals**

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_approvals(agent_id, *, status=None, session_id=None)` | `list[JsonObject]` | 列出等待决定的 tool call。 |
| `resolve_approval(agent_id, approval_id, *, decision, resolved_by=None)` | `JsonObject` | 为一个 approval 提交决定。 |
| `get_approval(agent_id, approval_id)` | `JsonObject` | 读取一个 approval，待处理或已终结都可以。 |
| `list_approval_page(agent_id, *, status=None, session_id=None, cursor=None, limit=50)` | `JsonObject` | 一页 cursor 结果，保留 `next_cursor` 和 `has_more`。 |

**System prompt**

| 方法 | 返回 | 作用 |
|---|---|---|
| `get_system_prompt(agent_id)` | `JsonObject` | 声明的 system prompt pin，以及当前生效的渲染模板。 |
| `preview_system_prompt(agent_id, preview)` | `JsonObject` | 根据你提供的运行时信息组装出确切的 prompt，不影响任何 Session。 |
| `upgrade_system_prompt(agent_id, upgrade)` | `JsonObject` | 移动 pin，由 `expected_config_version` 保护。 |

**Artifacts**

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_artifacts(agent_id, *, page=None, limit=None, session_id=None, source_path=None, created_before=None)` | `JsonObject` | 一页 Artifact，`artifacts` 始终是 list。 |
| `get_artifact(agent_id, artifact_id)` | `JsonObject` | 一条 Artifact 记录。 |
| `download_artifact(agent_id, artifact_id)` | `JsonObject` | 返回 `ready` 状态 Artifact 的访问 URL。 |
| `delete_artifact(agent_id, artifact_id)` | `JsonObject` | 删除一个 Artifact，并返回该记录。 |

**自动化：schedules 和 wake**

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_schedules(agent_id)` | `list[JsonObject]` | Agent 的 schedule 列表。 |
| `create_schedule(agent_id, schedule, *, idempotency_key=None)` | `JsonObject` | 创建 schedule，返回回执。 |
| `get_schedule(agent_id, schedule_id)` | `JsonObject` | 读取一个 schedule。 |
| `update_schedule(agent_id, schedule_id, update)` | `JsonObject` | 去掉六个只读字段后替换定义。 |
| `delete_schedule(agent_id, schedule_id)` | `None` | 删除 schedule。 |
| `trigger_schedule(agent_id, schedule_id)` | `JsonObject` | 请求已启用的 schedule 额外触发一次。 |
| `list_schedule_runs(agent_id, schedule_id, *, limit=None)` | `list[JsonObject]` | 历次触发记录，最新的在前。 |
| `wake(agent_id, wake)` | `JsonObject` | 向 Agent 的 heartbeat 队列推送一条提醒。 |

**Exec 和文件**

| 方法 | 返回 | 作用 |
|---|---|---|
| `exec(agent_id, args)` | `JsonObject` | 在 Agent sandbox 中运行一个 argv list，cwd 为 `/workspace`。 |
| `upload_file(agent_id, path, content)` | `JsonObject` | 把 `bytes` 或文本复制到 sandbox，返回 `path`、`size` 和 `sha256`。 |

**Usage、余额和 run 输出**

| 方法 | 返回 | 作用 |
|---|---|---|
| `get_usage(*, range=None, ...)` | `JsonObject` | 读取 key 范围内的用量。 |
| `get_balance()` | `JsonObject` | 读取所有 Project 共享的组织余额。 |
| `get_run_output(agent_id, session_id, run_id, *, cursor=None, limit=None)` | `JsonObject` | 读取一次 run 的输出。 |

**Agent webhooks**

13 个方法用于为一个 Agent 注册、更新、测试和恢复 webhook endpoint。见 [Webhook 管理方法](#webhook-management-methods)。

**Environments**

Platform key 不能调用根路径 `/environments` 路由，这些方法返回 `404 service_api.not_found`。Agent 无需创建 Environment，直接使用托管的默认 sandbox。见 [Environments](../build/environments.md) 和 [Environment 方法](#environment-methods)。

| 方法 | 返回 | 作用 |
|---|---|---|
| `list_environments(*, page=None)` | `list[JsonObject]` | 列出 Environment 记录。 |
| `get_environment(environment_id)` | `JsonObject` | 读取一条 Environment 记录。 |
| `create_environment(resource, ownership, *, idempotency_key=None)` | `JsonObject` | 提交 Environment 定义及其 ownership。 |
| `archive_environment(environment_id)` | `JsonObject` | 请求归档 Environment。 |
| `create_environment_version(environment_id, config, *, idempotency_key=None)` | `JsonObject` | 提交新的配置版本。 |
| `get_environment_version(environment_id, version, *, resource_class=None)` | `JsonObject` | 读取一个版本。 |

::: warning 已废弃的 workspace 文件方法
`get_workspace_file`、`write_workspace_file` 和 `get_workspace_file_content` 仍可调用，但托管服务没有开启 workspace Files 路由，这些调用会以 HTTP 501 或 502 失败。发送文件请用 [`upload_file()`](#upload-file)；获取结果时，让 Agent 发布 Artifact 再下载。见[文件与产物](../build/files.md)。

package 中的数据库 viewer 方法在 production 不可用，本页不列出。请在 Session 中使用 Agent 的 `agent_db` 工具，见 [Agent Database](../build/data-storage.md)。
:::

下面的代码片段都运行在某个 `async` 函数内，并假设已经有：

```python
from zoowork import create_zoowork_client

client = create_zoowork_client()  # reads ZOOWORK_API_KEY; close with await client.aclose()
```

`agent_id`、`session_id` 等变量代表你的应用保存的 ID。

---

### `list_models()` {#list-models}

```python
async def list_models() -> list[JsonObject]
```

没有参数。以 list 返回运行时模型目录。SDK 同时接受裸 list 和 `{"models": [...]}` 两种响应结构，始终返回 list。

```python
models = await client.list_models()
selectable = [m for m in models if m.get("selectable", True)]
default = next((m for m in selectable if "model" in m.get("default_for", [])), None)
print(len(selectable), default and default["model"])  # order is not a preference
```

```json
[
  {
    "model": "litellm/gpt-5.6-terra",
    "display_name": "GPT-5.6 Terra",
    "family": "openai",
    "api": "openai-responses",
    "lifecycle_status": "active",
    "selectable": true,
    "revision": 3,
    "default_for": ["model"]
  }
]
```

把 `model` 的值原样填入 `resource["model"]["primary"]`。不要硬编码 alias 背后的底层 provider 模型名。只选择 `selectable` 不为 `False` 的行。新选择被关闭后，生命周期中的行可能仍对已有 Agent 可见；选择这样的行会返回 `409 model_not_selectable`。有 `expired_fallback_to` 时，它给出替代模型。

一行可能带有 `thinking: {"default": <level>, "levels": [<level>, ...]}`。`levels` 按升序列出该模型按原名生效的 [`ThinkingLevel`](#thinkinglevel) 值，其他档位会解析到最接近的已列出档位。`default` 是 Agent 未设置时平台使用的档位。旧服务端不返回这个字段，所以用 `model.get("thinking")` 读取。

---

### `create_agent()` {#create-agent}

```python
async def create_agent(
    resource: Mapping[str, Any],
    *,
    ownership: Mapping[str, str] | None = None,
    idempotency_key: str | None = None,
) -> JsonObject
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `resource` | `Mapping[str, Any]` | Agent 配置，`name` 必填。SDK 会去掉 `warm` 和 `onboarding` 两个 key，并始终发送 `onboarding: false`。 |
| `ownership` | `Mapping[str, str] \| None` | 创建 Agent 时省略。公共 gateway 根据 key 推导 ownership。 |
| `idempotency_key` | `str \| None` | 作为 `Idempotency-Key` header 发送。 |

常用的 `resource` key 有 `name`、`model`（`primary`，以及可选的 `thinking`）、`userTimezone`、`include_global_skills`、`skills`、`labels`、`tool_policy`、`mcp`、`custom_tools`、`system_prompt` 和 `outcome`。逐字段说明见 [Agents](../build/agents.md)。

返回**创建回执**：一个扁平 mapping，包含 `agent_id`、顶层的 `config_version`、`ownership` 和 `resolved_skills`，没有 `declared`，也没有 `status`。

```python
created = await client.create_agent(
    {"name": "research-agent", "model": {"primary": "litellm/gpt-5.6-terra"}},
    idempotency_key="provision-research-agent-1",
)
print(created["agent_id"], created["config_version"])  # "agt_...", 1
```

新 Agent 处于**停止**状态：先调用 `create_session()` 而没有 `start_agent()` 会返回 `409 agent_not_running`。回执中的 `config_version` 很快就会过时，请从 `get_agent()` 读取当前版本。idempotency key 应从你系统中稳定的值推导，见[错误与重试](./errors.md)。

省略 `model` 时，会 pin 到创建时生效的平台默认模型。默认值可能变化，所以需要确定性的初始化时，先调用 `list_models()` 并显式设置 `primary`。`include_global_skills` 默认为 `True`；设为 `False`，或显式发送空的 `skills` list，可以关闭自动挂载的全局 Skill。`userTimezone` 是具名的 IANA 时区，用于 prompt 和消息中的时间上下文，不决定 schedule 的时区。

---

### `list_agents()` 和 `iter_agents()` {#list-agents}

```python
async def list_agents(
    *,
    labels: Mapping[str, str] | None = None,
    page: int | None = None,
) -> AgentPage

async def iter_agents(
    *,
    labels: Mapping[str, str] | None = None,
    page: int | None = None,
) -> AsyncIterator[JsonObject]
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `labels` | `Mapping[str, str] \| None` | 按声明的 label 过滤；每一项以 `label.<key>=<value>` 发送。 |
| `page` | `int \| None` | 从 1 开始的页码。传 0、负数或 `bool` 会在请求前抛 `ValueError`。 |

`list_agents()` 返回一个 [`AgentPage`](#agentpage)。对它 `async for` 会先返回本页的行，再用相同的过滤条件读取后续每一页。不需要第一页的元数据时，用 `iter_agents()` 效果相同。

```python
page = await client.list_agents(labels={"app": "support"})
print(page.data, page.total, page.next_page)
if page.has_next_page():
    following = await page.get_next_page()
    print(following.data)

async for agent in client.iter_agents(labels={"app": "support"}):
    print(agent["agent_id"])
```

页码从 1 开始，每页固定 100 条；没有 `limit` 参数，也没有字符串 cursor。响应缺少有效的 `agents`、`page`、`page_size` 和 `total`，或者返回的 `page` 与请求的页不一致时，SDK 抛 `ValueError`。中途退出循环后不会再发请求。并发的新增或删除会让页内容移动，遍历结果不是快照。见[列出你的 Agent](../build/agents.md#列出你的-agent)。

---

### `get_agent()` {#get-agent}

```python
async def get_agent(agent_id: str) -> JsonObject
```

返回**读取 projection**，结构和创建回执不同：配置在 `declared` 下，版本在 `status.config_version`，没有顶层的 `config_version`，也没有顶层的 `name`。

```python
agent = await client.get_agent(agent_id)
print(agent["declared"]["name"])              # "research-agent"
print(agent["status"]["desired_state"])       # "running"
print(agent["status"]["config_version"])      # 3
```

| | 创建回执（`create_agent`） | 读取 projection（`get_agent`、`update_agent`） |
|---|---|---|
| 版本 | `config_version`（顶层） | `status.config_version` |
| 名称 | 不存在 | `declared.name` |
| 生命周期状态 | 不存在 | `status.desired_state` |
| `declared` | 没有 | 有 |
| `status` | 没有 | 有 |

写一个同时兼容两种结构的读取函数：

```python
def config_version(agent: dict) -> int | None:
    return (agent.get("status") or {}).get("config_version") or agent.get("config_version")
```

判断 API 是否就绪要看 `status.desired_state`，不要看 `status.actual_state`。只有可选字段 `agent_desired_state`（Agent 自身的运行状态）和 `computer_desired_state`（承载它的 Computer）都是 `"running"` 时，`desired_state` 才是 `"running"`。`actual_state` 由 `desired_state` 推导而来（`active`、`stopped` 或 `deleting`），不反映渠道健康，也永远不会是 `running`。`status.channels` 是兼容字段，其中的计数始终为 `0`。

未知、已软删除或超出范围的 Agent ID 返回 404。公共 Agent 路由使用 `service_api.not_found`；判断时同时匹配状态码和 type。见[错误](./errors.md)。

---

### `update_agent()` {#update-agent}

```python
async def update_agent(agent_id: str, sections: Mapping[str, Any]) -> JsonObject
```

PUT 你指定的 declared section，返回读取 projection。

**省略的 section 保持不变。** mapping 类型的 section 做一层浅合并；list 和标量整体替换。`tool_policy` 和 `system_prompt` 是例外：每次 PUT 只要包含它们，就会整体替换。见 [Tools](../build/tools.md)。

```python
updated = await client.update_agent(agent_id, {"labels": {"tier": "paid"}})
print(updated["declared"]["labels"])  # other existing label keys are preserved
```

**配置写入会增加 `config_version`，即使值没有变化；只改 ownership 的写入不会。** 在 `sections` 中加入正整数 `expected_config_version`，可以在写入时原子地检查版本。版本不一致时抛 `ZooworkError`，status 为 `409`，type 为 `active_config_changed`，配置不会改变。重试前请重新读取并重新计算要做的修改。这个前置条件不会存进 `declared`。省略它则是 last-write-wins 更新。见[更新示例](../build/agents.md#只更新自己读取的版本)。

`model.thinking` 单独合并，所以不需要 `primary`：

```python
from zoowork import ThinkingLevel

level: ThinkingLevel = "high"
await client.update_agent(agent_id, {"model": {"thinking": level}})
await client.update_agent(agent_id, {"model": {"thinking": None}})  # clear; follow the default
```

`None` 序列化为 JSON `null`，会清除声明的档位；省略这个 key 则保留原值。见 [Agent thinking](../build/agents.md#设置-thinking-档位)。请求体中的 `skills`、`credentials` 和未知字段返回 `400`。

---

### `delete_agent()` {#delete-agent}

```python
async def delete_agent(agent_id: str) -> None
```

软删除 Agent，第一次返回 `204` 时得到 `None`。通过公共 API 重复删除会返回 404。404 也会用来隐藏无权访问的资源，所以只有确认该 Agent 属于未变更的 key 范围时，才能把 404 视为清理完成，见[可以安全重试的条件](./errors.md#什么可以安全重试)。

它**不会**停止 Agent、取消正在运行的 workflow、删除 schedule 或释放 sandbox。先停止，再删除。见 [Agents](../build/agents.md)。

---

### `start_agent()` 和 `wait_until_running()` {#start-agent}

```python
async def start_agent(agent_id: str) -> dict[str, list[str]]

async def wait_until_running(
    agent_id: str,
    *,
    timeout: float = 30.0,
    interval: float = 0.5,
) -> JsonObject
```

`start_agent()` 把 `desired_state` 设为 `running`，这是 `create_session()` 和 `post_events()` 的前提。它返回 `{"warnings": [...]}`，响应中没有 warning 时 list 为空。HTTP 失败仍然会抛异常，不要把失败的调用当作只有 warning 的成功。

然后用 `wait_until_running()` 等待 `status.desired_state == "running"`：

```python
result = await client.start_agent(agent_id)
print(result["warnings"])  # [] or informational messages
agent = await client.wait_until_running(agent_id)
print(agent["status"]["desired_state"])  # "running"
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `timeout` | `float` | `30.0` | 最多等待的秒数，包括正在进行的请求。 |
| `interval` | `float` | `0.5` | 两次轮询之间的秒数。 |

它轮询 `get_agent()`，返回第一个 `status.desired_state` 为 `running` 的 projection。超时时抛 `ZooworkError`，status 为 `408`，type 为 `"timeout"`，`retryable` 为 `False`。**这个错误是本地生成的**，服务端从不发送。`get_agent()` 抛出的错误（比如 404）会原样向上抛。

---

### `stop_agent()` {#stop-agent}

```python
async def stop_agent(agent_id: str) -> dict[str, list[str]]
```

把 `desired_state` 设为 `stopped`，返回值和 `start_agent()` 一样是 `{"warnings": [...]}`。停止后，对该 Agent 调用 `create_session()` 会返回 `409 agent_not_running`。

停止请求可能在 desired state 已经改变之后才失败。重试前先重新读取 Agent；仅凭 `desired_state: "stopped"` 不能证明清理已经完成。

---

### `list_agent_skills()` {#list-agent-skills}

```python
async def list_agent_skills(agent_id: str, *, verbose: bool = False) -> list[JsonObject]
```

返回解析到 Agent 上的 Skill，取自响应中的 `skills` list。`verbose=True` 会发送 `?verbose=true`，额外返回不满足条件和被排除的条目。

```python
for skill in await client.list_agent_skills(agent_id):
    print(skill["skill_id"], skill.get("name"), skill.get("version"), skill.get("eligible"))
```

除非 `include_global_skills` 为 `False`，否则默认包含全局 Skill。一行中的 `scope` 表示可见性，不表示能否编辑 registry 内容。请保留未知的 scope 值。

---

### `put_agent_skill()` {#put-agent-skill}

```python
async def put_agent_skill(
    agent_id: str,
    skill_id: str,
    *,
    enabled: bool = True,
    version_pin: int | None = None,
) -> JsonObject
```

发送 `{"enabled": enabled, "version_pin": version_pin}`；`None` 以 `null` 发送，表示不 pin 版本。响应可能包含 `config_version` 和 `warnings`。

```python
receipt = await client.put_agent_skill(agent_id, skill_id, enabled=True, version_pin=1)
print(receipt.get("config_version"), receipt.get("warnings"))
```

Skill 必须对 key 可见：全局 Skill、同一组织的组织 Skill、同一组织且同一具名 Project 的 Project Skill，或 key 所有者拥有的个人 Skill。未知或无权访问的 ID 返回 404。修改后调用 `list_agent_skills()` 确认解析出的版本和是否满足条件。

---

### `delete_agent_skill()` {#delete-agent-skill}

```python
async def delete_agent_skill(agent_id: str, skill_id: str) -> None
```

删除显式的 assignment。可见性规则与 `put_agent_skill()` 相同。删除全局 Skill 的 assignment 会恢复它的默认行为，不会把它从全局目录中移除。要排除它，请使用 `enabled=False` 的 assignment。

---

### Channel 方法 {#channel-methods}

```python
async def list_channels(agent_id: str) -> list[JsonObject]
async def add_channel(agent_id: str, channel: Mapping[str, Any]) -> JsonObject
async def update_channel(
    agent_id: str, platform: str, update: Mapping[str, Any] | None = None
) -> JsonObject
async def remove_channel(agent_id: str, platform: str, *, account: str = "default") -> None
async def start_channel_setup(
    agent_id: str, platform: str, setup: Mapping[str, Any] | None = None
) -> JsonObject
async def poll_channel_setup(agent_id: str, platform: str, session_id: str) -> JsonObject
async def cancel_channel_setup(agent_id: str, platform: str, session_id: str) -> None
async def wait_for_channel_setup(
    agent_id: str,
    platform: str,
    session_id: str,
    *,
    timeout: float = 600.0,
    on_poll: Callable[[JsonObject], None] | None = None,
) -> JsonObject
async def start_feishu_setup(agent_id: str, setup: Mapping[str, Any] | None = None) -> JsonObject
async def poll_feishu_setup(agent_id: str, session_id: str) -> JsonObject
async def cancel_feishu_setup(agent_id: str, session_id: str) -> None
async def wait_for_feishu_setup(
    agent_id: str,
    session_id: str,
    *,
    timeout: float = 600.0,
    on_poll: Callable[[JsonObject], None] | None = None,
) -> JsonObject
```

使用 Platform key 时，以上每个方法都返回 `404 service_api.not_found`，见 [Channels](../build/channels.md)。这里列出签名，是因为 package 中存在这些方法。`wait_for_channel_setup()` 反复调用 `poll_channel_setup()`，直到 `status` 为 `success`、`expired`、`denied` 或 `error`；两次轮询之间等待响应中的 `poll_interval` 秒（默认 5 秒，最少 0.25 秒），每次结果都传给 `on_poll`，超过 `timeout` 秒后抛 `ZooworkError` `408` / `"timeout"`。飞书方法以 `platform="feishu"` 调用对应的 channel 方法。

---

### System prompt 方法 {#system-prompt-methods}

```python
async def get_system_prompt(agent_id: str) -> JsonObject
async def preview_system_prompt(agent_id: str, preview: Mapping[str, Any]) -> JsonObject
async def upgrade_system_prompt(agent_id: str, upgrade: Mapping[str, Any]) -> JsonObject
```

`get_system_prompt()` 返回声明的 system prompt pin 和当前生效的渲染模板。新建的 Agent 会 pin 到当前生效的平台版本；`declaration: None` 表示较早的 Agent，仍使用旧行为。

`preview_system_prompt()` 根据你提供的运行时信息组装出确切的 prompt，不影响任何 Session。`preview` 中有六个必填字段，缺少任何一个都会返回指出该字段的 `400`：`config_version`（必须是 Agent 当前版本，否则返回 `409 config_version_changed`）、`now_ms`、`session_id`、`model_display`、`workspace_dir` 和 `tool_names`。`channel`、`chat_type`、`session_key` 和 `subagent` 可选。

`upgrade_system_prompt()` 移动 pin。`expected_config_version` 必填；值过时会返回 `409 config_version_changed`，此时重新读取再升级。省略 `template_version` 表示选择当前生效的平台版本。响应包含新的 `config_version`。

---

### `upload_skill()` {#upload-skill}

```python
Upload = bytes | bytearray | memoryview | str | Path

async def upload_skill(
    upload: Upload,
    *,
    scope: str,
    file_name: str = "skill.zip",
    description: str | None = None,
    idempotency_key: str | None = None,
) -> JsonObject
```

用 multipart 请求注册 ZIP Skill 及其第一个版本。ZIP 放在 `files[]` 字段中，文件名为 `file_name`，类型为 `application/zip`；`scope` 作为表单字段发送。

**`str` 或 `Path` 会被当作文件路径由 SDK 读取**，而不是 ZIP 内容。内容已在内存中时，传 `bytes`、`bytearray` 或 `memoryview`。

```python
from pathlib import Path

skill = await client.upload_skill(
    Path("slide-layout.zip"),
    scope="org",  # Use "project" for a named Project key.
    file_name="slide-layout.zip",
)
skill_id = skill["skill_id"]
```

在支持 Project registry 的部署上，具名 Project key 使用 `scope="project"`，Default Project key 使用 `scope="org"`。ownership 由 key 决定。其他 Platform scope 返回 `400 service_api.invalid_body`。名称和描述写在 `SKILL.md` 中；创建时的 `description` 参数会被丢弃。`Idempotency-Key` header 不保证重放结果：结果不确定时，先核对（比如用 `list_skills()`）再重试。见 [Skills](../build/skills.md)。

---

### `upload_skill_version()` {#upload-skill-version}

```python
async def upload_skill_version(
    skill_id: str,
    upload: Upload,
    *,
    file_name: str = "skill.zip",
    description: str | None = None,
    idempotency_key: str | None = None,
) -> JsonObject
```

以已有的 Skill 名称发布一个 ZIP，返回包含 `skill_id`、`version` 和 `state` 的版本记录。不要从中读取创建记录的 `latest_version` 或 `status`。`upload` 的规则与 `upload_skill()` 相同。

```python
version = await client.upload_skill_version(skill_id, Path("slide-layout.zip").read_bytes())
if version["state"] != "ready":
    raise RuntimeError(f"Skill version is {version['state']}")
```

具名 Project key 写入自己的 `project` Skill；Default Project key 写入所属组织的 `org` Skill。可见的全局 Skill 和个人 Skill，以及具名 Project 可见的 `org` Skill，在 registry 中是只读的，写入返回 `404 service_api.not_found`。发布新版本不会转移 ownership。未 pin 版本的 assignment 会跟随新版本，已 pin 的不会。

---

### `list_skills()` {#list-skills}

```python
async def list_skills(
    *, scope: str | None = None, q: str | None = None, page: int | None = None
) -> list[JsonObject]
```

读取一页目录，返回其中的 `skills` list。`q` 按名称过滤，`page` 从 1 开始；一页不是完整目录。Platform key 能看到全局 Skill、同组织的 `org` Skill、同 Project 的 `project` Skill，以及 key 所有者拥有的符合条件的个人 Skill。ownership 选择条件来自 key。可见不代表有 registry 写权限。

---

### `delete_skill()` {#delete-skill}

```python
async def delete_skill(skill_id: str) -> None
```

删除 registry Skill（`204`），而不是从某个 Agent 上卸下，后者由 `delete_agent_skill()` 完成。Platform key 可以删除自己具名 Project 的 `project` Skill；Default Project key 可以删除所属组织的 `org` Skill。其他 ID，包括可见的只读 Skill，返回 `404 service_api.not_found`。删除前先检查共享的使用方。

---

### `create_session()` {#create-session}

```python
async def create_session(
    agent_id: str,
    session: Mapping[str, Any] | None = None,
    *,
    idempotency_key: str | None = None,
) -> JsonObject
```

| `session` key | 说明 |
|---|---|
| `initial_events` | 只接受 `user.message`，最多 50 条。提供后立即开始第一个 turn。 |
| `metadata` | 任意 JSON，与 Session 一起保存，由 `get_session()` 返回。服务端不解释它，之后也不能追加。 |
| `runtime_mode` | `"active"` 在创建时 pin 当前生效的配置。省略时，后续每个 turn 再解析生效配置。 |
| `idle_compaction` | `True`、`False` 或 `None`；SDK 原样保留 `False`、`None` 和省略。 |

`session=None` 时发送空请求体。

```python
session = await client.create_session(
    agent_id,
    {
        "initial_events": [{"type": "user.message", "content": "Summarize this brief."}],
        "metadata": {"source": "my-app"},
    },
    idempotency_key=f"chat-{incoming_message_id}",
)
print(session["session_id"])   # "0123456789abcdef0123456789abcdef"
print(session["session_key"])  # "api:0123456789abcdef0123456789abcdef"
print(session["status"])       # "running"
```

`session_id` 是不透明的值，不要要求它带资源前缀；`api:` 属于 `session_key`。创建回执中 `status` 为 `"running"`，没有 `run_status`。需要最新 run 状态时，从之后的 `get_session()` 或 `list_sessions()` 的行中读取 `run_status`。

Agent 必须正在运行。对已停止的 Agent 调用会抛 `ZooworkError`，status 为 `409`，type 为 `agent_not_running`。idempotency key 应从你系统中稳定的值推导，不要在调用时临时生成。

---

### `get_session()` {#get-session}

```python
async def get_session(
    agent_id: str,
    session_id: str,
    *,
    history: bool = False,
    limit: int | None = None,
) -> JsonObject
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `history` | `bool` | 只在为 `True` 时发送 `?history=true`。会在 `history` 下附带落盘的 transcript。 |
| `limit` | `int \| None` | 最近 transcript 行数。服务端默认 100，最大 500。只在 `history=True` 时有意义。 |

```python
from zoowork import message_text

s = await client.get_session(agent_id, session_id, history=True, limit=20)
print(s.get("run_status"))  # "succeeded" - latest run state
for row in s.get("history", []):
    if row["entry_type"] == "message":
        print(row["seq"], message_text(row["entry"]["message"]))
```

`history` 中的行是**落盘的 transcript，不是 event log**。每行有 `seq`、`entry_type`、`entry`，可能还有 `created_at`，按 `seq` 升序排列。`entry_type == "message"` 时，对话文本在 `entry["message"]` 下；其他 entry type 跳过即可。

不同响应中的字段不同：`create_session()` 返回 `status: "running"`，没有 `run_status`；`get_session()` 返回 `status: None` 和 `run_status`；`list_sessions()` 的行带 `run_status`，没有 `status`。`run_status` 可能为 `None`，`pending_approvals` 是可选的计数。你创建的 Session 的 `session_key` 是 `api:<session_id>`；这类 Session 的 `channel` 为 `api`，由 schedule 触发的 Session 为 `cron`。

`isolation` 在创建时记录，之后不会改变；用 `create_session()` 创建的 Session 记录为 `"shared"`，共享 Agent 的 `/workspace`。创建回执和列表 row 都带这个字段；如果 Session 从某个已记录的配置版本获取 Skills，还会带 `skill_config_version`。只有 `get_session()` 返回 `queue`：`selected_mode` 有值时 `effective_mode` 取它，否则取 Agent 配置中的 `default_mode`。见[读取 Session](../build/session-operations.md#read-a-session)。

---

### `list_sessions()` 和 `list_session_page()` {#list-sessions}

```python
async def list_sessions(agent_id: str, *, page: int | None = None) -> list[JsonObject]

async def list_session_page(
    agent_id: str,
    *,
    cursor: str = "sls1:0",
    limit: int | None = None,
    exclude_channels: Sequence[str] | None = None,
    include_surfaces: Sequence[str] | None = None,
    runtime_modes: Sequence[Literal["active", "preview", "authoring", "evaluation"]]
    | None = None,
    include_archived: bool = False,
    include_deleted: bool = False,
) -> SessionListPage
```

`list_sessions()` 读取旧版数字分页通道：按 `updated_at` 从新到旧，每页 50 条，`page` 从 1 开始。每行带 `run_status`，没有 `status`。

`list_session_page()` 读取带过滤的 cursor 通道，返回 [`SessionListPage`](#sessionlistpage)。它总会发送 `cursor`，起始值为 `"sls1:0"`，所以不会误入旧版通道。`limit` 为 1–100。list 类型的过滤条件用逗号拼接，`include_archived` 总是以 `true` 或 `false` 发送。

```python
page = await client.list_session_page(agent_id, limit=50, exclude_channels=["cron"])
while True:
    for row in page.sessions:
        print(row["session_id"], row.get("run_status"))
    if page.next_cursor is None:
        break
    page = await client.list_session_page(
        agent_id, cursor=page.next_cursor, limit=50, exclude_channels=["cron"]
    )
```

cursor 是不透明的值，绑定 Agent 和完整的过滤条件。续读时保持所有过滤条件不变。`include_deleted=True` 会加入删除 tombstone，这些行带 `deleted`，page 的 `includes_deleted` 为 `True`；tombstone 不是可读取的 Session。`next_cursor` 不是字符串或 `None`，或者 `includes_deleted` 不是布尔值时，SDK 抛 `TypeError`。

---

### `archive_session()` 和 `delete_session()` {#archive-session}

```python
async def archive_session(agent_id: str, session_id: str) -> JsonObject
async def delete_session(agent_id: str, session_id: str) -> None
```

`archive_session()` 写入 `archived_at`，返回的响应中 `archived` 被转换为 `bool`。之后写操作返回 `409 session_archived`，读取照常可用。请先中断进行中的 run。

`delete_session()` 软删除 Session（`204`），会先取消进行中的 run。transcript 和 event 会保留，供审计使用。

---

### `post_events()` {#post-events}

```python
async def post_events(
    agent_id: str, session_id: str, events: Sequence[Mapping[str, Any]]
) -> list[JsonObject]
```

向已有 Session 写入 event。响应为 `202`；SDK 返回其中的 `events` list，每个 event 一项，list 不存在时返回 `[]`。被接受的 event 会以完整 event 对象返回，内容与历史中一致，带有 `seq`；未被接受的仍是 `{"id", "type", "accepted": False}` 回执。

写入路径接受 `PUBLIC_INPUT_EVENT_TYPES` 中的五种类型：`user.message`、`user.interrupt`、`user.tool_confirmation`、`user.custom_tool_result` 和 `system.message`。`user.custom_tool_result` 是 `resolve_custom_tool_call()` 的 event 形式替代。

```python
receipts = await client.post_events(agent_id, session_id, [
    {
        "type": "user.message",
        "content": "What is my display name?",
        "idempotency_key": f"msg-{incoming_message_id}",
    },
])
if receipts[0].get("accepted") is not True:
    raise RuntimeError("Message was not accepted")
```

`accepted` 表示 event 已进入队列，不表示 turn 已完成。turn 以 `run.finished` 结束。给每个 event 在 event 自身中设置稳定的 `idempotency_key`，超时后重试 `post_events()` 就不会重复投递。

**对进行中的 run 发送 `user.interrupt` 会中止它**：响应中 `accepted` 为 `True`，run 以 `run.finished` 结束，其 `payload["status"]` 为 `aborted`。没有进行中的 run 时，`user.interrupt` 返回 `accepted: False`。**这是空操作，不是错误。**

**`system.message` 在下一个 turn 才到达模型**，作为带外信息，正文放在 `text` 而不是 `content` 中。API Session 中的 user message，`actor` 为 `{"ref": "<id>"}`；身份相关限制见 [Events](../build/events.md#user-message)。

---

### `list_events()`、`list_events_page()` 和 `list_all_events()` {#list-events}

```python
async def list_events(
    agent_id: str,
    session_id: str,
    *,
    cursor: str | None = None,
    types: Sequence[str] | None = None,
    limit: int | None = None,
) -> list[SessionEvent]

async def list_events_page(
    agent_id: str,
    session_id: str,
    *,
    cursor: str | None = None,
    types: Sequence[str] | None = None,
    limit: int | None = None,
) -> tuple[list[SessionEvent], bool | None, str | None]

async def list_all_events(
    agent_id: str,
    session_id: str,
    *,
    cursor: str | None = None,
    types: Sequence[str] | None = None,
    page_size: int = 500,
) -> list[SessionEvent]
```

每个方法还有一个已废弃的 overload，用 `after: int | None` 代替 `cursor`。

| 参数 | 类型 | 说明 |
|---|---|---|
| `cursor` | `str \| None` | 从这个位置之后开始：某一页的 `next_cursor` 或流式 event 的 `cursor`。列表返回的 event 不带逐条 cursor。 |
| `after` | `int \| None` | 已废弃的 overload。会选择只含 engine event 的通道，这个通道的编号与统一的 `seq` 不同，也不包含你发送的 input，所以绝不要传 `event.seq`。类型检查器会标出传了它的调用。 |
| `types` | `Sequence[str] \| None` | 服务端过滤，用逗号拼接到 `?types=`。只接受词表中的类型。 |
| `limit` | `int \| None` | 服务端默认 100，最大 500。 |
| `page_size` | `int` | 仅 `list_all_events()`。每次请求的 `limit`，限制在 1–500 之间。 |

每一项都经过 `normalize_event()` 处理，所以 REST 和 SSE 得到的是同样的 [`SessionEvent`](#sessionevent)。

::: warning 每次调用只返回一页
`list_events()` 只返回一页，并丢掉分页字段。`list_events_page()` 是同一个调用，返回 `(events, has_more, next_cursor)`：

```python
events, has_more, next_cursor = await client.list_events_page(agent_id, session_id, limit=100)
```

手动翻页时把 `next_cursor` 作为 `cursor` 传回；否则使用 `list_all_events()`。
:::

`list_all_events()` 沿 `next_cursor` 读取，直到 `has_more` 为 false；服务端不支持 cursor 分页时，回退为沿 `after` 通道读取：

```python
replies = await client.list_all_events(agent_id, session_id, types=["agent.assistant"])
later = await client.list_all_events(agent_id, session_id, cursor=saved_cursor)
```

返回的 event 按 `seq` 升序排列。从 `cursor` 开始的读取不会回退到 `after`。同时传 `cursor` 和 `after` 会在发请求前抛 `TypeError`。cursor 没有前进时，读取停止且不重复追加；回退读取时，位置之前（含）的 event 会被丢弃，所以边界 event 不会返回两次。

---

### `stream_events()` {#stream-events}

```python
async def stream_events(
    agent_id: str, session_id: str, *, cursor: str | None = None
) -> AsyncIterator[SessionEvent]
```

还有一个已废弃的 overload，用 `after: int | None` 代替 `cursor`。它续传的是只含 engine event 的通道，编号与统一的 `seq` 不同。

这是 [`SessionEvent`](#sessionevent) 的 async generator，用 `async for` 消费。已有 Session 要传入它保存的 cursor，只有新 Session 的第一个 turn 才省略。不传 cursor 时，旧的回答和 `run.finished` 会从头重放。见[两轮对话示例](../build/events.md#streaming-a-turn)和[缺少 cursor 时的恢复限制](../build/events.md#existing-session-without-a-saved-cursor)。

```python
import asyncio
from contextlib import aclosing
from zoowork import assistant_text, is_run_finished, run_outcome

async def read_reply(saved_cursor: str | None = None):
    text, cursor = "", saved_cursor
    async with aclosing(client.stream_events(agent_id, session_id, cursor=saved_cursor)) as stream:
        async for event in stream:
            text += assistant_text(event)
            cursor = event.cursor or cursor  # Persist after processing, with the Session ID.
            if is_run_finished(event):
                return text, cursor, run_outcome(event)
    raise RuntimeError("Read ended before run.finished; reconnect from the saved cursor")

text, cursor, outcome = await asyncio.wait_for(read_reply(saved_cursor), timeout=120)
```

需要了解的四个行为：

- **stream 以 Session 为范围，turn 结束时不会关闭。** 用 `is_run_finished()` 自己退出循环。`contextlib.aclosing` 会在离开循环时立即关闭 HTTP stream。
- **连接空闲时服务端会关闭 stream。** 用 `stream_events(agent_id, session_id, cursor=last_cursor)` 重连，`last_cursor` 取自每个 event 的 `cursor`。续传由服务端完成，两次连接之间的内容不会丢失。SDK 不会自动重连，见[重连循环](../build/events.md#一个扛得住断线的重连循环)。
- **`chat.delta` 预览帧会被跳过。** 它们以 SSE `event_delta` 帧的形式在独立的非持久化通道上到达，SDK 会丢弃它们，也会丢弃 data 不是 JSON 对象的帧。你只会看到持久化 event。
- **边界 event 会去重。** generator 会丢弃非负 `seq` 不大于上一次已返回 event 的 event，所以重连时重放的边界 event 不会出现两次。`seq == -1` 的 event 没有可用序号，会直接放行。

打开 stream 时的非 2xx 响应抛出与其他调用相同的 `ZooworkError`。连接断开或 read timeout 则抛 `httpx` 异常。

---

### `list_custom_tool_calls()` 和 `resolve_custom_tool_call()` {#custom-tool-calls}

```python
async def list_custom_tool_calls(
    agent_id: str,
    *,
    status: Literal["pending"] | None = None,
    session_id: str | None = None,
) -> list[CustomToolCallRecord]

async def resolve_custom_tool_call(
    agent_id: str,
    call_id: str,
    *,
    content: Sequence[CustomToolResultContent],
    is_error: bool | None = None,
    resolved_by: str | None = None,
) -> CustomToolCallRecord
```

在 `resource["custom_tools"]` 中用 [`CustomToolDeclaration`](#custom-tool-types) mapping 声明应用执行的工具。[`custom_tool_use(event)`](#event-helpers) 返回一个 requested 调用时，在你的应用中执行它并返回结果：

```python
from zoowork import custom_tool_use

call = custom_tool_use(event)
if call is not None and call.phase == "requested":
    await client.resolve_custom_tool_call(
        agent_id,
        call.call_id,
        content=[{"type": "json", "value": {"price": 42}}],
        resolved_by="pricing-service",
    )
```

`content` 包含 1–16 个文本、JSON 或 base64 图片块。`is_error` 和 `resolved_by` 只在不为 `None` 时发送。`202` 响应中 `signaled: True` 表示投递已被接受；在 run 消费之前，记录可能仍是 pending。`signaled: False` 表示该调用已经完成、超时或被取消。

`list_custom_tool_calls(agent_id, status="pending")` 用于重启后找回待处理的工作。status 过滤只接受 `"pending"`。run 等待期间，`run_status` 为 `awaiting_approval`；查看 `pending_custom_tool_calls` 可以和普通 approval 区分。也可以改为向所属 Session 发送 `user.custom_tool_result` event。见 [Tools](../build/tools.md#应用执行的自定义工具)。

---

### `get_custom_tool_call()` 和 `list_custom_tool_call_page()` {#custom-tool-call-pages}

```python
async def get_custom_tool_call(agent_id: str, call_id: str) -> CustomToolCallRecord

async def list_custom_tool_call_page(
    agent_id: str,
    *,
    status: Literal["pending"] | None = None,
    session_id: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> JsonObject
```

`get_custom_tool_call()` 读取一个调用，已终结的和待处理的都可以。`list_custom_tool_call_page()` 原样返回一页 cursor 结果，保留 `next_cursor` 和 `has_more`；续读时用相同的过滤条件，把 `next_cursor` 作为 `cursor` 传回。

---

### `list_approvals()` 和 `resolve_approval()` {#approvals}

```python
async def list_approvals(
    agent_id: str, *, status: str | None = None, session_id: str | None = None
) -> list[JsonObject]

async def resolve_approval(
    agent_id: str,
    approval_id: str,
    *,
    decision: str,
    resolved_by: str | None = None,
) -> JsonObject
```

`list_approvals()` 列出等待决定的 tool call，返回响应中的 `approvals` list。`status` 只能省略或为 `"pending"`，所以不会返回已解决的记录。这个 REST 资源与 `user.tool_confirmation` event 路径是分开的。

`resolve_approval()` 发送 `{"decision": decision}`，设置了 `resolved_by` 时再加上 `resolvedBy`。记录中有 `allowed_decisions` 时，从中选择一个决定。

```python
approvals = await client.list_approvals(agent_id, status="pending")
for approval in approvals:
    allowed = approval.get("allowed_decisions")
    print(approval["approval_id"], approval.get("arguments_preview"), allowed)
```

`202` 回执中即使 `signaled` 为 `True`，记录也可能仍是 `pending`；继续读取 event 来了解执行进度。approval 记录可能包含 `requested_at`、`arguments_preview`、`allowed_decisions`、`timeout_at`、`resolved_by`、`resolved_at`、`signaled` 和 `decision`。见 [Permission policies](../build/permissions.md)。

---

### `get_approval()` 和 `list_approval_page()` {#approval-pages}

```python
async def get_approval(agent_id: str, approval_id: str) -> JsonObject

async def list_approval_page(
    agent_id: str,
    *,
    status: Literal["pending"] | None = None,
    session_id: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> JsonObject
```

`get_approval()` 读取一个 approval，已终结的和待处理的都可以。`list_approval_page()` 原样返回一页 cursor 结果，保留 `next_cursor` 和 `has_more`。

---

### Artifact 方法 {#artifacts}

```python
async def list_artifacts(
    agent_id: str,
    *,
    page: int | None = None,
    limit: int | None = None,
    session_id: str | None = None,
    source_path: str | None = None,
    created_before: str | None = None,
) -> JsonObject
async def get_artifact(agent_id: str, artifact_id: str) -> JsonObject
async def download_artifact(agent_id: str, artifact_id: str) -> JsonObject
async def delete_artifact(agent_id: str, artifact_id: str) -> JsonObject
```

Artifact 由 Agent 自己的 `artifact_publish` 工具发布，这些方法管理它产出的内容。对一个 Agent 的第一次 Artifact 调用会多一次 `get_agent()` 来读取 ownership，之后缓存在 client 中。Agent 的 projection 中没有 ownership 时，会抛 `ZooworkError`，status 为 `500`，type 为 `ownership_unavailable`。这个错误是本地生成的，所以没有服务端响应能解释它。

| 方法 | 说明 |
|---|---|
| `list_artifacts` | 返回 `{"artifacts": [...], "page", "has_more"}`；`artifacts` 始终是 list。`limit` 默认 50，最大 100。 |
| `get_artifact` | 一条记录。`status` 为 `pending`、`ready`、`failed` 或 `deleted`；只有 `ready` 的记录有可用的 `url`。别人的 ID 和不存在的 ID 都返回 404。 |
| `download_artifact` | 为 `ready` 的 Artifact 返回 `artifact_id` 和 `url`。把这个 URL 当作 bearer capability 对待。从未完成的记录返回 `409 artifact_not_ready`。 |
| `delete_artifact` | 删除一个 Artifact，返回 engine 处理后的记录。 |

```python
import httpx

page = await client.list_artifacts(agent_id, session_id=session_id, limit=50)
ready = next((a for a in page["artifacts"] if a.get("status") == "ready"), None)
if ready is not None:
    link = await client.download_artifact(agent_id, ready["artifact_id"])
    async with httpx.AsyncClient(follow_redirects=True) as http:
        response = await http.get(link["url"])
        response.raise_for_status()
        data = response.content
```

删除后，之前已签发的对象存储 URL 不保证立即失效。见[文件与产物](../build/files.md)。

---

### `create_schedule()` {#create-schedule}

```python
async def create_schedule(
    agent_id: str,
    schedule: Mapping[str, Any],
    *,
    idempotency_key: str | None = None,
) -> JsonObject
```

创建 schedule。`201` 回执包含公共的 `schedule_id` 和已废弃的兼容字段 `schedule_name`，不包含完整定义。schedule 在 `stop_agent()` 和 `delete_agent()` 之后仍然保留定义，Agent 没有运行期间它的触发会以 `runtime_stopped` 原因跳过，需要你自己删除。

`schedule` 需要三个 key。`schedule_id` 由你选择，需匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`；用同一个 ID 但*不同*的定义重新创建会返回 `409`。`schedule` 是触发节奏。`payload` 是要执行的工作，示例使用 `kind: "agentTurn"`。管理接口的解析器也接受 `systemEvent` 和 `command`，它们的执行方式和调用方限制不同，请按 [Schedules](../build/schedules.md) 使用。

```python
await client.create_schedule(agent_id, {
    "schedule_id": "daily-digest",
    "schedule": {"kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai"},
    "payload": {"kind": "agentTurn", "message": "Summarise yesterday.", "thinking": "low"},
    "sessionTarget": "isolated",
})
```

可选 key 有 `sessionTarget`、`delivery`、`enabled`、`deleteAfterRun` 和 `jobKind`。省略 `sessionTarget` 或传 `"isolated"` 时，每次触发使用新的 Session；传 `session:<id>` 则指向这个 Agent 的某个已有 Session。它在创建后**不可修改**。间隔节奏写成 `{"kind": "every", "everyMs": 60000, "anchorMs": 0}`。

`agentTurn` payload 可以设置 `thinking`（一个 [`ThinkingLevel`](#thinkinglevel)），覆盖该任务各个 turn 的 Agent 档位；对其他 payload kind 无效。见 [Schedule 覆盖](../build/schedules.md#override-the-thinking-level)。

---

### `update_schedule()` {#update-schedule}

```python
async def update_schedule(
    agent_id: str, schedule_id: str, update: Mapping[str, Any]
) -> JsonObject
```

替换 schedule 定义。修改节奏要发送 `schedule`，不要发送读取时返回的 `scheduleSpec`。发送前，SDK 会去掉六个 key：`sessionTarget`、`scheduleSpec`、`execution`、`originMetadata`、`contextSnapshot` 和 `creatorPrincipalRef`。前两个是读取结构；后四个由服务端推导，发送会返回 `400`。因此，基于 `get_schedule()` 读取、修改、再写回的流程可以正常工作。

`payload.thinking`（仅 `agentTurn`）有三种状态。省略它，或发送空字符串、只含空白的字符串，会保留已存的值；发送 `None` 会清除它，让任务重新跟随 Agent 的档位；发送一个档位则设置它。服务端会对新值去除首尾空白并转为小写，并把旧写法 `xhigh`、`minimal` 和 `adaptive` 规范为 `max`、`low` 和 `medium`。

```python
await client.update_schedule(agent_id, "daily-digest", {
    "payload": {"kind": "agentTurn", "message": "Summarise yesterday.", "thinking": None},
})
```

和 `delete_schedule()` 一样，它没有跨超时的幂等保证：超时后先列出 schedule 核对，不要直接再发一次写入。

---

### 其他 schedule 方法和 `wake()` {#schedules}

```python
async def list_schedules(agent_id: str) -> list[JsonObject]
async def get_schedule(agent_id: str, schedule_id: str) -> JsonObject
async def delete_schedule(agent_id: str, schedule_id: str) -> None
async def trigger_schedule(agent_id: str, schedule_id: str) -> JsonObject
async def list_schedule_runs(
    agent_id: str, schedule_id: str, *, limit: int | None = None
) -> list[JsonObject]
async def wake(agent_id: str, wake: Mapping[str, Any]) -> JsonObject
```

| 方法 | 说明 |
|---|---|
| `list_schedules` | 响应中的 `schedules` list。行内同时有调度器自己的 describe 结构和 camelCase projection，读取时要做好兼容。 |
| `get_schedule` | 以 camelCase 读取词汇返回一个 schedule。后续操作使用公共的 `schedule_id`；节奏在 `scheduleSpec.cronExpressions[0]`，执行目标在 `execution.kind`。较旧的 projection 可能带 `name` 和完整限定的 `scheduleId`，把它们当作兼容字段。不要把读取 projection 作为创建输入发回。 |
| `delete_schedule` | 删除 schedule。不要盲目重试，先列出核对。 |
| `trigger_schedule` | 请求额外触发一次；返回的回执中 `triggered` 被转换为 `bool`。已禁用的 schedule 即使回执显示 `triggered: True` 也会被跳过，回执也不是 run 结果。 |
| `list_schedule_runs` | 响应中的 `runs` list，最新的在前。`limit` 默认 20，最大 100。行有两种结构，按 `source` 区分。`session_id` 可能不存在。 |
| `wake` | `mode` 为 `"next-heartbeat"`（默认）时只写入待处理记录；`"now"` 还会启动 heartbeat schedule，没有启用 heartbeat 时返回 `409`。`deliverToUser: False` 让提醒只用于 Agent 内部。返回 `mode`、`queued` 和 `triggered`；`triggered` 只在 `now` 模式下有意义。 |

---

### `exec()` {#exec}

```python
async def exec(agent_id: str, args: Sequence[str]) -> JsonObject
```

在 Agent 的 sandbox 中把 `args` 作为 argv list 运行（不是 shell 字符串），cwd 固定为 `/workspace`。**非零退出码仍然是 HTTP 200**：调用正常返回，所以要检查 `exit_code`。

```python
result = await client.exec(agent_id, ["ls", "-la", "/workspace"])
if result["exit_code"] != 0:
    raise RuntimeError(result.get("stderr"))
print(result["stdout"])
```

它要求 agent-scope sandbox 和已渲染的配置：session-scope Agent 返回 `409 exec_requires_agent_scope`，未渲染的返回 `409 exec_config_not_ready`。命令 300 秒后超时，`stdout` 和 `stderr` 各自在 200,000 个字符处截断。这两个限制都不会以错误形式报告。

---

### `upload_file()` {#upload-file}

```python
async def upload_file(agent_id: str, path: str, content: bytes | str) -> JsonObject
```

把文件复制到 Agent 的 sandbox，让 Agent 可以按路径读取。`path` 可以是绝对路径，也可以是相对 `/workspace` 的路径；父目录会自动创建。`str` 以 UTF-8 文本写入。

```python
from pathlib import Path

file = await client.upload_file(agent_id, "input/report.pdf", Path("report.pdf").read_bytes())
print(file["path"], file["size"], file["sha256"])  # /workspace/input/report.pdf ...
```

内容以约 72 KB 的 base64 分块通过 `exec()` 传输，先写入目标旁边的临时文件，在 sandbox 内校验 SHA-256 后才移动到目标位置，所以上传失败时 `path` 处不会留下任何文件。它适合几 MB 以内的文件，前提条件与 `exec()` 相同。返回 `{"path", "size", "sha256"}`。`path` 为空时抛 `ValueError`，调用失败时抛 `ZooworkError`，sandbox 命令以非零退出或校验和不一致时抛 `RuntimeError`。见[文件](../build/files.md#send-a-file-to-the-agent)。

---

### `get_usage()` {#get-usage}

```python
async def get_usage(
    *,
    range: Literal["24h", "7d", "30d"] | None = None,
    timezone: str | None = None,
    group_by: Literal["session", "api_key"] | None = None,
    view: Literal["groups", "records", "both"] | None = None,
    session_id: str | None = None,
    api_key_id: str | None = None,
    root_session_id: str | None = None,
    attribution: Literal["exact", "shared", "non_api", "unattributed"] | None = None,
    page: int | None = None,
    per_page: int | None = None,
    as_of: str | None = None,
    snapshot: str | None = None,
    cursor: str | None = None,
) -> JsonObject
```

每个参数作为同名的 query parameter 发送，值为 `None` 的会省略。用量结果限定在当前 key 的范围内。

```python
usage = await client.get_usage(range="7d", group_by="session", view="both", per_page=50)
```

续查时，把过滤条件和返回的 `snapshot`、`cursor` 一起保留。参数无效时可能返回 `400 usage.invalid_query`，也可能返回没有业务 error type 的 `422`；修正参数，不要原样重试。可接受的值和默认值见 [Usage](./usage.md#查询参数)。

---

### `get_balance()` {#get-balance}

```python
async def get_balance() -> JsonObject
```

读取所有 Project 共享的组织余额。需要 Platform key；组织内任何 Platform key 都可以读取。

```python
balance = await client.get_balance()
print(balance["available_amount"], balance["currency"])  # "11.34" "usd"
```

`available_amount` 是保留两位小数的美元字符串，不是 credits：已结算的充值减去当前账期已上报的消耗，与 Platform Billing 页面显示的一致。它不会低于 `"0.00"`。见 [Usage](./usage.md#read-the-organization-balance)。

---

### `get_run_output()` {#get-run-output}

```python
async def get_run_output(
    agent_id: str,
    session_id: str,
    run_id: str,
    *,
    cursor: str | None = None,
    limit: int | None = None,
) -> JsonObject
```

读取 Session 中一次 run 的输出，原样返回响应。把返回的 cursor 作为 `cursor` 传回即可继续读取。

---

### Webhook 管理方法 {#webhook-management-methods}

```python
async def list_agent_webhooks(
    agent_id: str, *, cursor: str | None = None, limit: int | None = None
) -> JsonObject
async def create_agent_webhook(
    agent_id: str, input: Mapping[str, Any], *, idempotency_key: str
) -> JsonObject
async def get_agent_webhook(agent_id: str, webhook_id: str) -> JsonObject
async def update_agent_webhook(
    agent_id: str, webhook_id: str, input: Mapping[str, Any]
) -> JsonObject
async def delete_agent_webhook(agent_id: str, webhook_id: str) -> None
async def rotate_agent_webhook_secret(
    agent_id: str, webhook_id: str, input: Mapping[str, Any], *, idempotency_key: str
) -> JsonObject
async def test_agent_webhook(agent_id: str, webhook_id: str, *, idempotency_key: str) -> JsonObject
async def get_agent_webhook_event(agent_id: str, event_id: str) -> JsonObject
async def list_agent_webhook_deliveries(
    agent_id: str,
    webhook_id: str,
    *,
    cursor: str | None = None,
    limit: int | None = None,
    status: Literal["pending", "in_flight", "succeeded", "dead", "cancelled"] | None = None,
    event_type: str | None = None,
    event_id: str | None = None,
    session_id: str | None = None,
    run_id: str | None = None,
    schedule_id: str | None = None,
) -> JsonObject
async def get_agent_webhook_delivery(
    agent_id: str, webhook_id: str, delivery_id: str
) -> JsonObject
async def redeliver_agent_webhook_delivery(
    agent_id: str, webhook_id: str, delivery_id: str, *, idempotency_key: str
) -> JsonObject
async def redeliver_agent_webhook_deliveries(
    agent_id: str, webhook_id: str, input: Mapping[str, Any], *, idempotency_key: str
) -> JsonObject
```

创建、轮换 secret、测试和重新投递都需要稳定的 `idempotency_key`。响应保留 API 字段名；列表响应保留 `next_cursor` 和 `has_more`。

```python
created = await client.create_agent_webhook(
    agent_id,
    {"url": "https://receiver.example/webhook", "event_types": ["run.finished"]},
    idempotency_key="register-hook-v1",
)
# Save created["signing_secret"] securely when present; an idempotent replay may return None.
webhook_id = created["endpoint"]["id"]
await client.test_agent_webhook(agent_id, webhook_id, idempotency_key="test-hook-v1")
deliveries = await client.list_agent_webhook_deliveries(
    agent_id, webhook_id, event_type="webhook.test"
)
```

| 方法 | 说明 |
|---|---|
| `list_agent_webhooks` | endpoint 行在 `webhooks` 中。 |
| `update_agent_webhook` / `delete_agent_webhook` | 分别以 `POST .../update` 和 `POST .../delete` 发送。 |
| `rotate_agent_webhook_secret` | `input` 为 `{"revoke_previous_after": 86400}` 时保留旧 secret 24 小时，为 `0` 时立即吊销。 |
| `test_agent_webhook` | `202` 回执只确认已进入队列，不代表已投递或业务已处理。 |
| `get_agent_webhook_event` | 在授权范围内读取一个 event；它不挂在某个 endpoint 下。 |
| `list_agent_webhook_deliveries` | 过滤投递记录；测试或重新投递的结果要在这里查询。 |
| `redeliver_agent_webhook_delivery` / `redeliver_agent_webhook_deliveries` | 把已有 event 再投递一次；不会重新运行 Agent。 |

完整的 receiver 和管理流程见 [Webhooks](../build/webhooks.md)。

---

### Environment 方法 {#environment-methods}

```python
async def list_environments(*, page: int | None = None) -> list[JsonObject]
async def get_environment(environment_id: str) -> JsonObject
async def create_environment(
    resource: Mapping[str, Any],
    ownership: Mapping[str, str],
    *,
    idempotency_key: str | None = None,
) -> JsonObject
async def archive_environment(environment_id: str) -> JsonObject
async def create_environment_version(
    environment_id: str,
    config: Mapping[str, Any],
    *,
    idempotency_key: str | None = None,
) -> JsonObject
async def get_environment_version(
    environment_id: str,
    version: int,
    *,
    resource_class: str | None = None,
) -> JsonObject
```

使用 Platform key 时，以上每个方法都返回 `404 service_api.not_found`。`create_environment()` 带 `ownership` 参数，不代表 Environment 管理可用。请使用托管的默认 sandbox，见 [Environments](../build/environments.md)。

## 类型 {#types}

请求和响应记录都是普通的 `dict`，保留 API 的字段拼写。API 处于 Developer Preview 阶段，同一版本内可能新增字段：遇到不认识的字段直接忽略，不要因此报错。package 导出下面这些类型，用于类型标注，以及 SDK 自己构造的值。

### `JsonObject` {#jsonobject}

```python
JsonObject = dict[str, Any]
```

大多数 client 方法的返回类型。

### `ThinkingLevel` {#thinkinglevel}

```python
ThinkingLevel = Literal["off", "low", "medium", "high", "max"]
```

thinking 档位，按升序排列。模型会把它的 `thinking.levels` 中没有列出的档位解析到最接近的已列出档位，距离相同时取较高的一个，所以在不能关闭 thinking 的模型上，`"off"` 会变成它的最低档位。请求字段是 Agent 上的 `model.thinking` 和 `agentTurn` schedule 上的 `payload.thinking`；传 `None` 可以清除二者。

### `AgentPage` {#agentpage}

```python
@dataclass(frozen=True, slots=True)
class AgentPage:
    data: list[JsonObject]
    page: int
    page_size: int
    total: int
    next_page: int | None

    def has_next_page(self) -> bool: ...
    async def get_next_page(self) -> AgentPage: ...
    async def iter_pages(self) -> AsyncIterator[AgentPage]: ...
    def __aiter__(self) -> AsyncIterator[JsonObject]: ...
```

由 `list_agents()` 返回。`data` 只包含本页。`page`、`page_size` 和 `total` 来自 API；`next_page` 由 SDK 推算，最后一页为 `None`。`get_next_page()` 保留 label 过滤条件，没有下一页时抛 `RuntimeError`。`iter_pages()` 依次返回本页和之后的每一页。`async for agent in page` 返回从本页开始的所有 Agent。

### `SessionListPage` {#sessionlistpage}

```python
@dataclass(frozen=True, slots=True)
class SessionListPage:
    sessions: list[JsonObject]
    next_cursor: str | None
    includes_deleted: bool = False
```

由 `list_session_page()` 返回。到最后一页时 `next_cursor` 为 `None`。请求时传了 `include_deleted=True`，`includes_deleted` 就为 `True`。

### `SessionEvent` {#sessionevent}

```python
@dataclass(frozen=True, slots=True)
class SessionEvent:
    seq: int
    event_type: str
    payload: dict[str, Any]
    run_id: str | None = None
    turn: int | None = None
    created_at: str | None = None
    id: str | None = None
    processed_at: str | None = None
    cursor: str | None = None
```

| 字段 | 说明 |
|---|---|
| `seq` | 决定 event 顺序的持久化序号，不是续传位置。已废弃的 `after` 通道编号方式不同，所以绝不要把 `seq` 当作 `after` 传入。`-1` 表示没有提供可用的序号。 |
| `cursor` | 不透明的续传 token，只出现在 `stream_events()` 返回的 event 上。原样作为 `cursor=` 传入，不要从 `seq` 推导。列表从该页的 `next_cursor` 续读。 |
| `event_type` | `SESSION_EVENT_TYPES` 中的一种，或原样透传的未知字符串。wire 上没有类型时为 `""`。 |
| `payload` | event 正文，结构随类型而变，请用 [event helper](#event-helpers) 读取。 |
| `run_id` | 该 event 所属的 run。 |
| `turn` | Session 内的 turn 编号。 |
| `created_at` | ISO 时间戳。 |
| `id` | event ID（如果有）。 |
| `processed_at` | 处理时间戳，wire 上带 `processed_at` 时才有。 |

无论 event 以哪种 wire 结构到达，字段都是 snake_case；`normalize_event()` 同时读取统一的 snake_case 和旧版 camelCase 拼写。见 [Events](../build/events.md)。

### `ToolCall` {#toolcall}

```python
@dataclass(frozen=True, slots=True)
class ToolCall:
    phase: str
    tool_name: str
    tool_call_id: str
    args: dict[str, Any] | None = None
    is_error: bool | None = None
    result_preview: str | None = None
```

`agent.tool` event 的解码结果，由 `tool_call()` 返回。`phase` 为 `start`、`end` 或 `blocked`。一次 tool call 会产生一组共享 `tool_call_id` 的 event：`start` 带 `args`，`end` 带 `is_error` 和 `result_preview`，`blocked` 是执行前的终止阻断，之后不会再有 `end`。阻断原因包括策略拒绝、approval 被拒绝/超时/取消，或被中断；有 `event.payload["deniedReason"]` 时读取它。等待 approval 使用 phase 为 `requested` 的 `agent.approval`，不是 `blocked`。按 `tool_call_id` 配对 event；多个调用并发时，它们在流中**并不相邻**。tool 出错不一定导致 run 失败，请检查最终的 run 状态。见 [Events](../build/events.md)。

### `CustomToolUse` {#customtooluse}

```python
@dataclass(frozen=True, slots=True)
class CustomToolUse:
    phase: str
    call_id: str
    tool_call_id: str | None = None
    name: str | None = None
    input: dict[str, Any] | None = None
    timeout_at: str | None = None
    outcome: str | None = None
    is_error: bool | None = None
    resolved_by: str | None = None
    resolution_channel: str | None = None
```

`agent.custom_tool_use` event 的解码结果，由 `custom_tool_use()` 返回。`phase` 为 `requested` 或 `resolved`。`call_id` 是传给 `resolve_custom_tool_call()` 的 ID。已解决的调用中，`outcome` 为 `completed`、`timeout` 或 `cancelled`。

### Custom tool 类型 {#custom-tool-types}

```python
class CustomToolDeclaration(TypedDict, total=False):
    name: str               # required
    description: str        # required
    input_schema: JsonObject  # required
    timeoutMs: int

class CustomToolCallRecord(TypedDict, total=False):
    call_id: str            # required
    session_id: str         # required
    tool_call_id: str       # required
    name: str               # required
    input: JsonObject       # required
    status: Literal["pending", "completed", "timeout", "cancelled"]  # required
    requested_at: str       # required
    run_id: str
    resolution_channel: str
    timeout_at: str
    resolved_by: str
    resolved_at: str
    is_error: bool
    signaled: bool
```

`CustomToolDeclaration` 是 `resource["custom_tools"]` 中的一项，最多接受 32 个声明。`input_schema` 必须是顶层带 `type: object` 的 JSON Schema 对象。`timeoutMs` 默认 600,000 ms，最大 86,400,000 ms。

`CustomToolCallRecord` 是一个待处理调用或一份解决回执。

```python
CustomToolResultContent = (
    CustomToolTextContent
    | CustomToolJsonContent
    | CustomToolImageContent
    | CustomToolInlineImageContent
)
```

| 类型 | 字段 |
|---|---|
| `CustomToolTextContent` | `type: Literal["text"]`、`text: str` |
| `CustomToolJsonContent` | `type: Literal["json"]`、`value: Any` |
| `CustomToolImageContent` | `type: Literal["image"]`、`source: CustomToolImageSource` |
| `CustomToolImageSource` | `type: Literal["base64"]`、`media_type`、`data: str`（base64） |
| `CustomToolInlineImageContent` | `type: Literal["image"]`、`data: str`（base64）、`mime_type` |

`media_type` 和 `mime_type` 的取值为 `"image/png"`、`"image/jpeg"`、`"image/gif"` 或 `"image/webp"`。一个结果包含 1–16 个块。

### `ZooworkClient` {#zooworkclient}

`ZooworkClient` 作为 class 导出，可以用来标注你自己的 helper：

```python
from zoowork import ZooworkClient

async def reply(client: ZooworkClient, agent_id: str, text: str) -> None: ...
```

## 错误 {#errors}

### `ZooworkError` {#zooworkerror}

```python
class ZooworkError(Exception):
    def __init__(
        self,
        status: int,
        message: str,
        error_type: str | None = None,
        *,
        content_type: str | None = None,
        body_snippet: str | None = None,
        cf_ray: str | None = None,
        request_id: str | None = None,
        retryable: bool | None = None,
    ) -> None
```

每个 client 方法遇到非 2xx 响应时都会抛出它。

| 属性 | 类型 | 说明 |
|---|---|---|
| `status` | `int` | HTTP 状态码，始终存在。 |
| `type` | `str \| None` | 机器可读的错误码：取响应体中的 `error.type`，没有时取顶层的 `code`。**有它时按它分支**，同时保留按状态码的兜底。 |
| `content_type` | `str \| None` | 响应的 `Content-Type`。 |
| `body_snippet` | `str \| None` | 响应体的前 600 个字符。 |
| `cf_ray` | `str \| None` | 响应 header `cf-ray`。 |
| `request_id` | `str \| None` | 响应体中的 `error.request_id` 或 `request_id`（如果有）。公共 API 不保证每个响应都有。 |
| `retryable` | `bool` | status 为 408、429、502、503 和 504 时为 `True`，SDK 显式设置的情况除外。 |

`str(error)` 是错误消息：取响应体中的 `error.message`、`message` 或 `detail`；响应体中都没有时，为 `HTTP <status>` 加上 content type 和 `cf-ray`。消息文本给人和日志看，不要解析它。

```python
from zoowork import ZooworkError

try:
    session = await client.create_session(
        agent_id,
        {"initial_events": [{"type": "user.message", "content": "hi"}]},
        idempotency_key=f"chat-{incoming_message_id}",
    )
except ZooworkError as error:
    if error.status == 409 and error.type == "agent_not_running":
        await client.start_agent(agent_id)
        await client.wait_until_running(agent_id)
    elif error.status == 401:
        raise RuntimeError("Check the API key and its scope") from error
    else:
        print(error.status, error.type, error.request_id, error)
        raise
```

**可重试的错误。** `retryable` 只反映状态码。它表示服务端稍后可能成功，不表示重复这个操作是安全的。读操作可以带 backoff 重试；写操作请按[什么可以安全重试](./errors.md#什么可以安全重试)中逐个操作的规则处理：

```python
import asyncio
from zoowork import ZooworkError

async def get_agent_with_retry(agent_id: str, attempts: int = 4) -> dict:
    for attempt in range(attempts):
        try:
            return await client.get_agent(agent_id)
        except ZooworkError as error:
            if not error.retryable or attempt == attempts - 1:
                raise
            await asyncio.sleep(min(2 ** attempt, 15))
    raise AssertionError("unreachable")
```

**SDK 本地生成的错误。** 有些 `ZooworkError` 并非来自服务端：

| 来源 | `status` / `type` | `retryable` |
|---|---|---|
| `wait_until_running()`、`wait_for_channel_setup()` 超时 | `408` / `"timeout"` | `False` |
| Artifact 方法无法读取 Agent 的 ownership | `500` / `"ownership_unavailable"` | `False` |
| 成功响应不是 JSON | 响应的状态码 / `None` | 取决于状态码 |
| webhook 验签失败 | `400` / [`WebhookSignatureError`](#webhook-helpers) 的 code | `False` |

**其他异常。** 传输层失败（比如连接被拒绝或超时）抛的是 `httpx` 异常（`httpx.TransportError` 及其子类，包括 `httpx.TimeoutException`），不是 `ZooworkError`。响应结构无法使用时抛 `TypeError` 或 `ValueError`。配置错误在构造时抛 `ValueError`。SDK 不会替你重试任何操作。值得分支处理的错误类型见[错误与重试](./errors.md)。

## 事件辅助函数 {#event-helpers}

作用于 `SessionEvent` 的纯函数，都不访问网络。

| Helper | 签名 | 返回 |
|---|---|---|
| `is_run_finished` | `(event: SessionEvent) -> bool` | `run.finished` 时为 `True`。 |
| `run_outcome` | `(event: SessionEvent) -> str \| None` | `run.finished` 时为 `"succeeded"`、`"failed"` 或 `"aborted"`；其他为 `None`。 |
| `assistant_text` | `(event: SessionEvent) -> str` | `agent.assistant` 的助手文本；其他类型为 `""`。 |
| `thinking_text` | `(event: SessionEvent) -> str` | `agent.thinking` 的推理文本；其他类型为 `""`。 |
| `tool_call` | `(event: SessionEvent) -> ToolCall \| None` | `agent.tool` 的解码结果；其他为 `None`。 |
| `custom_tool_use` | `(event: SessionEvent) -> CustomToolUse \| None` | `agent.custom_tool_use` 的应用执行工具解码结果；其他为 `None`。 |
| `message_text` | `(message: object) -> str` | 一条 `{"role", "content"}` 消息的文本。 |
| `normalize_event` | `(raw: object, sse_id: str \| None = None) -> SessionEvent` | 把任一种 wire 结构读成 `SessionEvent`。 |

文本 helper 对不匹配的类型返回 `""`，所以可以无条件累加。见 [Events](../build/events.md)。

### `message_text(message)` {#message-text}

助手文本位于 `payload["message"]["content"]`，`content` 通常是一个块列表，其中**只有 `{"type": "text", "text": ...}` 块带文本**。`message_text()` 会把这些块拼接起来。纯字符串原样返回，写入侧的 `user.message` content 就是这样返回的。其他值返回 `""`。因此它既适合处理 event，也适合处理 transcript 行：

```python
from zoowork import message_text

s = await client.get_session(agent_id, session_id, history=True)
for row in s.get("history", []):
    if row["entry_type"] == "message":
        print(message_text(row["entry"]["message"]))
```

`assistant_text(event)` 就是加了 event 类型判断的 `message_text(event.payload.get("message"))`。

### `normalize_event(raw, sse_id=None)` {#normalize-event}

```python
def normalize_event(raw: object, sse_id: str | None = None) -> SessionEvent
```

接受统一的 snake_case 和旧版 camelCase 两种 event 结构，遇到意外输入不会抛异常：不是 mapping 的值会变成 `event_type` 和 `payload` 都为空的 event。`sse_id` 是 SSE 的 `id:` 行，除非它是纯整数，否则作为 event 的 `cursor` 保留。正文中没有 `seq` 时，纯整数 ID，或 `pse1:<seq>` cursor 中的数字，会被用作 `seq`。SDK 在 list 方法和 `stream_events()` 中会替你调用它；只有自己解析 wire 时才需要直接调用。未知 event 类型原样透传。

### `SESSION_EVENT_TYPES` 和 `PUBLIC_INPUT_EVENT_TYPES` {#event-type-constants}

```python
SESSION_EVENT_TYPES = (
    "run.started", "run.finished",
    "chat.delta", "chat.final", "chat.aborted", "chat.error",
    "agent.lifecycle", "agent.assistant", "agent.thinking", "agent.tool", "agent.item",
    "agent.plan", "agent.approval", "agent.custom_tool_use", "agent.command_output",
    "agent.patch", "agent.compaction", "agent.error",
    "attachment.created", "message.outbound",
)

PUBLIC_INPUT_EVENT_TYPES = (
    "user.message", "user.interrupt", "user.tool_confirmation",
    "user.custom_tool_result", "system.message",
)
```

`SESSION_EVENT_TYPES` 是读取侧的词表，共 20 种类型。`SessionEvent.event_type` 是普通的 `str`，所以较新服务端的未知类型也能到达你这里。`PUBLIC_INPUT_EVENT_TYPES` 列出 `post_events()` 接受的五种类型。

```python
from zoowork import SESSION_EVENT_TYPES

if event.event_type not in SESSION_EVENT_TYPES:
    print("unknown event type", event.event_type)
```

`run.finished` 表示一个 turn 结束，`payload["status"]` 为 `succeeded`、`failed` 或 `aborted`。`chat.delta` 不会从 `stream_events()` 到达你这里，这些帧会被跳过。

## `parse_sse()` {#parse-sse}

```python
async def parse_sse(lines: AsyncIterable[str]) -> AsyncIterator[SSEMessage]

@dataclass(frozen=True, slots=True)
class SSEMessage:
    event: str
    data: Any
    id: str | None = None
```

SSE 行解析器，为高级用法导出。`stream_events()` 已经在用它，日常使用不需要它。它接受解码后的文本行（比如 `httpx` 的 `response.aiter_lines()`），每一帧产出一个 `SSEMessage`。`event` 是 SSE event 名，默认为 `message`。`id` 是 `id:` 行：在统一 stream 上是不透明的续传 cursor，不是 `seq`。`data` 是解析后的 JSON 正文，不是 JSON 时为原始字符串。注释行会被忽略。

自己调用 stream 端点时可以用它，比如查看 `stream_events()` 跳过的 `event_delta` 预览帧：

```python
import os
import httpx
from zoowork import DEFAULT_BASE_URL, normalize_event, parse_sse

url = f"{DEFAULT_BASE_URL}/agents/{agent_id}/sessions/{session_id}/events/stream"
headers = {"Authorization": f"Bearer {os.environ['ZOOWORK_API_KEY']}", "Accept": "text/event-stream"}
async with httpx.AsyncClient(timeout=None) as http, http.stream("GET", url, headers=headers) as res:
    async for message in parse_sse(res.aiter_lines()):
        if message.event == "event_delta":
            continue
        print(normalize_event(message.data, message.id))
```

丢掉 `id:` 行会让续传 cursor 停在原处，所以解析器会保留它。

## Webhook helpers {#webhook-helpers}

接收用的 helper 负责验证和解析收到的投递。它们是同步函数，只用标准库，不注册 endpoint，也不发送 event；这些操作请用 [webhook 管理方法](#webhook-management-methods)和 [Webhooks](../build/webhooks.md)。

```python
def verify_webhook_signature(
    *,
    headers: WebhookHeaders,
    raw_body: RawBody,
    secret: str | Sequence[str] | None = None,
    now: float | None = None,
    tolerance_seconds: int = WEBHOOK_TOLERANCE_SECONDS,
    max_body_bytes: int = WEBHOOK_DEFAULT_MAX_BODY_BYTES,
) -> tuple[str, int]

def unwrap_webhook(
    *,
    headers: WebhookHeaders,
    raw_body: RawBody,
    secret: str | Sequence[str] | None = None,
    now: float | None = None,
    tolerance_seconds: int = WEBHOOK_TOLERANCE_SECONDS,
    max_body_bytes: int = WEBHOOK_DEFAULT_MAX_BODY_BYTES,
) -> WebhookEvent

RawBody = bytes | bytearray | memoryview | str
WebhookHeaders = Mapping[str, str | Sequence[str] | None] | WebhookHeaderSource
```

| 参数 | 说明 |
|---|---|
| `headers` | 一个 mapping（按大小写不敏感的方式查找），或任何带 `get(name)` 方法的对象，比如框架提供的大小写不敏感 headers。多值条目只有在恰好包含一个值时才接受。 |
| `raw_body` | 收到的原始正文。验签前不要解析或重新序列化 JSON。 |
| `secret` | 一个 `whsec_` secret，或轮换期间所有有效 secret 组成的 sequence。省略时读取 `ZOOWORK_WEBHOOK_SECRET`，其中可以放多个 secret，用空白或逗号分隔。 |
| `now` | 当前时间，Unix **秒**，用于测试。默认取系统时钟。 |
| `tolerance_seconds` | `now` 与签名时间戳之间允许的差距。默认 300。 |
| `max_body_bytes` | 正文大小上限，在检查 header 之前检查。默认 16 KiB。 |

`verify_webhook_signature()` 返回 `(event_id, timestamp)`，即已验证的 `webhook-id` 和签名中的 Unix 秒时间戳。检查按开销从低到高进行，任何一步失败都拒绝：secret 解码、正文大小、三个 header 及其格式、时间窗口，最后用常量时间比较每个 `v1` 签名与每个 secret。其他版本的签名条目会被跳过。

`unwrap_webhook()` 先验签，所以未验证的字节不会进入 JSON 解析器，然后返回 [`WebhookEvent`](#webhookevent)。它只严格校验 envelope 外层：`object` 必须是 `"event"`；`id`、`type` 和 `created_at` 必须是字符串；`schema_version` 必须是整数值（`1` 或 `1.0`，不能是 `1.5`）；`data` 必须是对象。未知的 event 类型和 `data` 字段会保留，任意未知的顶层字段不会保留。event 专属的数据需要你自己校验。它不检查正文中的 `id` 是否等于 `webhook-id`。

```python
from zoowork import WEBHOOK_ID_HEADER, WebhookSignatureError, unwrap_webhook

def handle_delivery(headers, raw_body: bytes) -> int:
    """`headers`: your framework's case-insensitive request headers."""
    try:
        event = unwrap_webhook(headers=headers, raw_body=raw_body)
    except WebhookSignatureError as error:
        print("webhook rejected:", error.code)
        return 400
    if event.id != headers.get(WEBHOOK_ID_HEADER):
        return 400
    enqueue_once(event.id, event)  # your durable, de-duplicating queue
    return 204
```

按已验证的投递 ID 去重，确认收到之后再做业务处理。见[先验签，再确认](../build/webhooks.md#verify-before-acknowledging)。

### `WebhookSignatureError` {#webhooksignatureerror}

```python
class WebhookSignatureError(ZooworkError):
    code: WebhookSignatureErrorCode

WebhookSignatureErrorCode = Literal[
    "invalid_secret", "body_too_large", "missing_header", "invalid_header",
    "timestamp_out_of_window", "signature_mismatch", "invalid_payload",
]
```

所有验签失败都会抛出它。它是 `ZooworkError`，`status` 为 400，`type` 等于 `code`，`retryable` 为 `False`，所以一个 `except ZooworkError` 就能覆盖整个 SDK。按 `code` 匹配，不要匹配消息文本。消息只说明哪项检查失败，最多带一个 header 名，不包含 secret、签名或正文字节，可以安全地写入日志。

### `WebhookEvent` {#webhookevent}

```python
@dataclass(frozen=True, slots=True)
class WebhookEvent:
    object: str
    id: str
    type: str
    schema_version: int
    created_at: str
    data: Mapping[str, Any]
```

一个已验证的 envelope，字段名与 API 一致。即使 `type` 不在 `WEBHOOK_EVENT_TYPES` 中，也会保留服务端发来的字符串，因为 event 类型是在服务端新增的。见[处理事件](../build/webhooks.md#event-envelope)。

### 其他 webhook helper 和常量 {#other-webhook-helpers-and-constants}

| 名称 | 值或签名 | 说明 |
|---|---|---|
| `decode_webhook_secret` | `(secret: str) -> bytes` | 返回 `whsec_` secret 背后的 32 字节 HMAC key；格式不对时抛 `invalid_secret`。 |
| `is_known_webhook_event_type` | `(value: str) -> bool` | 当前 SDK 版本是否认识这个 event 类型。这是解析器的词表，不保证某个部署可用。 |
| `session_id`、`run_id`、`agent_id`、`schedule_id` | `(event: WebhookEvent) -> str \| None` | 从 `event.data` 读取对应的字符串字段，没有时返回 `None`。`schedule_id` 是 schedule 方法使用的公共 ID；heartbeat 触发时为 `"heartbeat"`。 |
| `WEBHOOK_EVENT_TYPES` | 21 个字符串组成的 tuple | `run.started`、`run.finished`、`run.yielded`、`approval.requested`、`approval.resolved`、`custom_tool.requested`、`custom_tool.resolved`、`outcome.evaluated`、`session.created`、`session.archived`、`session.deleted`、`schedule.dispatched`、`schedule.dispatch_failed`、`schedule.skipped`、`schedule.finished`、`webhook.test`、`schedule.created`、`schedule.updated`、`schedule.paused`、`schedule.resumed`、`schedule.deleted`。 |
| `WebhookEventType` | `Literal[...]` | 同样 21 个名称的类型形式。 |
| `WEBHOOK_ID_HEADER` | `"webhook-id"` | |
| `WEBHOOK_TIMESTAMP_HEADER` | `"webhook-timestamp"` | |
| `WEBHOOK_SIGNATURE_HEADER` | `"webhook-signature"` | |
| `WEBHOOK_SIGNATURE_VERSION` | `"v1"` | |
| `WEBHOOK_SECRET_PREFIX` | `"whsec_"` | |
| `WEBHOOK_SECRET_BYTES` | `32` | 解码后的 secret 长度。 |
| `WEBHOOK_SECRET_ENV_VAR` | `"ZOOWORK_WEBHOOK_SECRET"` | |
| `WEBHOOK_TOLERANCE_SECONDS` | `300` | |
| `WEBHOOK_DEFAULT_MAX_BODY_BYTES` | `16384` | |
| `WebhookHeaders` | 类型别名 | 见上面的参数表。 |

`session_id`、`run_id`、`agent_id` 和 `schedule_id` 与常见的变量名相同。导入模块可以避免混淆，比如 `import zoowork` 后调用 `zoowork.run_id(event)`。

wire 格式是标准的 [Standard Webhooks](https://www.standardwebhooks.com/)，这些 helper 与 `standardwebhooks` package 字节级兼容。

## 完整导出清单 {#complete-export-list}

```python
from zoowork import (
    __version__,
    DEFAULT_BASE_URL,
    create_zoowork_client,
    ZooworkClient,
    ZooworkError,
    JsonObject,
    ThinkingLevel,
    AgentPage,
    SessionListPage,
    CustomToolDeclaration,
    CustomToolCallRecord,
    CustomToolResultContent,
    CustomToolTextContent,
    CustomToolJsonContent,
    CustomToolImageContent,
    CustomToolImageSource,
    CustomToolInlineImageContent,
    SessionEvent,
    ToolCall,
    CustomToolUse,
    SESSION_EVENT_TYPES,
    PUBLIC_INPUT_EVENT_TYPES,
    normalize_event,
    is_run_finished,
    run_outcome,
    message_text,
    assistant_text,
    thinking_text,
    tool_call,
    custom_tool_use,
    SSEMessage,
    parse_sse,
    WEBHOOK_EVENT_TYPES,
    WebhookEventType,
    WebhookEvent,
    WebhookHeaders,
    WebhookSignatureError,
    WebhookSignatureErrorCode,
    verify_webhook_signature,
    unwrap_webhook,
    decode_webhook_secret,
    is_known_webhook_event_type,
    session_id,
    run_id,
    agent_id,
    schedule_id,
    WEBHOOK_ID_HEADER,
    WEBHOOK_TIMESTAMP_HEADER,
    WEBHOOK_SIGNATURE_HEADER,
    WEBHOOK_SIGNATURE_VERSION,
    WEBHOOK_SECRET_PREFIX,
    WEBHOOK_SECRET_BYTES,
    WEBHOOK_SECRET_ENV_VAR,
    WEBHOOK_TOLERANCE_SECONDS,
    WEBHOOK_DEFAULT_MAX_BODY_BYTES,
)
```

这些就是 `zoowork.__all__` 中的全部名称。`DEFAULT_BASE_URL` 是公共 gateway 的地址，可被 `ZOOWORK_BASE_URL` 和 `base_url` 参数覆盖；导出它是为了方便比较，或手动拼 URL。`__version__` 是已安装的 package 版本。

Session metadata 在调用 `create_session()` 时设置；`PATCH /agents/{id}/sessions/{sid}` 返回 `405`。

## 下一步 {#next}

- [错误与重试](./errors.md)：值得分支处理的错误类型，以及安全重试规则。
- [Agents](../build/agents.md)：创建、启动、更新，以及两种响应结构。
- [Sessions](../build/sessions.md) 与 [Events](../build/events.md)：驱动一个 turn、续传 stream、读取 transcript。
- [Tools](../build/tools.md)：应用执行的调用及 tool result。
- [文件与产物](../build/files.md)：输入文件上传和已发布输出的获取。
- [Schedules](../build/schedules.md)：周期任务及受支持的 Outcome evaluation。
- [Webhooks](../build/webhooks.md)：注册 receiver 并验证投递。
- [TypeScript SDK 参考](./typescript-sdk.md)：用 TypeScript 调用同一套 API。
