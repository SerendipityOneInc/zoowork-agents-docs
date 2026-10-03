---
description: 配置async Python SDK，管理client生命周期，并使用Agent、Session和event核心方法。
source: /en/reference/python-sdk
source_hash: 4ffb3616698049ef9ce2c2c2bbf19f6530997f6cd4c24be6e7ea8c6546b77e7f
---

# Python SDK

`zoowork` 是 ZooWork 公共 API 的 async Python client，要求 Python 3.10+。request 和 response 字段保留 API 拼写；Python 方法名和 keyword argument 使用 `snake_case`。

本参考适用于 Python SDK **0.5.0+**。

```bash
python -m pip install zoowork
```

完整任务及清理流程见[快速开始](../get-started/quickstart.md)。

## 创建和关闭 client

按 [Authentication](../get-started/authentication.md) 获取 API key、充值，并设置 `ZOOWORK_API_KEY`。client 从这个变量读取 key。

```python
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        models = await client.list_models()
        print(models)

asyncio.run(main())
```

`create_zoowork_client(api_key=None, *, base_url=None, timeout=30.0, transport=None)` 返回 `ZooworkClient`。缺少 key 会抛 `ValueError`。client 持有 `httpx.AsyncClient`，使用 `async with`，或调用 `await client.aclose()` 关闭。

## 配置

显式传入 `api_key`，或设置 `ZOOWORK_API_KEY`。client 在每个请求中以 Bearer credential 发送 key，包括 event stream 请求。

默认 base URL 为 `https://clawapi.ecap.gsmo.ai/service/v1`，正常使用无需配置地址。需要调用其他 deployment 时，可以传入 `base_url` 或设置 `ZOOWORK_BASE_URL`；显式参数优先。覆盖的地址必须包含 `/service/v1`。

`transport` 接受 `httpx` async transport，可以用于离线应用测试。

## 核心方法

| 方法 | 用途 |
|---|---|
| `await client.list_models()` | 读取可选择的模型 alias。 |
| `await client.create_agent(resource, idempotency_key=...)` | 从 resource mapping 创建 Agent，保存 `agent_id`。 |
| `await client.get_agent(agent_id)` | 读取 Agent projection 和 desired state。 |
| `await client.start_agent(agent_id)` | 创建 Session 前启动 Agent。 |
| `await client.stop_agent(agent_id)` | 请求停止 Agent；有 warning 或失败时先核对状态。 |
| `await client.delete_agent(agent_id)` | 保存结果并完成清理后删除 Agent。 |
| `await client.create_session(agent_id, session, idempotency_key=...)` | 创建对话，保存 `session_id`。 |
| `await client.get_session(agent_id, session_id, history=True, limit=...)` | 按需读取最近的 transcript rows。 |
| `await client.post_events(agent_id, session_id, events)` | 发送受支持的 input event。 |
| `await client.upload_file(agent_id, path, content)` | 把 `bytes` 或 `str` 复制到 Agent 的 `/workspace`，返回 `path`、`size` 和 `sha256`。见[文件](../build/files.md#send-a-file-to-the-agent)。 |
| `async for event in client.stream_events(agent_id, session_id, cursor=...)` | 读取保存的 events，处理后保留 resume cursor。 |

资源返回为 mapping，例如 `agent["agent_id"]`，不采用 TypeScript object 的属性访问方式。输入 mapping 中的 `initial_events`、`idempotency_key` 等字段保持原样。受支持的 create 方法中，Python 方法参数 `idempotency_key` 对应 HTTP header；逐事件 key 仍写在 event 自身中。

## 处理错误

```python
from zoowork import ZooworkError

try:
    session = await client.create_session(agent_id, {})
except ZooworkError as error:
    if error.status == 401:
        raise RuntimeError("Check the API key and its scope") from error
    raise
```

`ZooworkError` 提供 `status`、`type` 和 message text，还可能包含 `content_type`、`body_snippet`、`cf_ray`、`request_id`、`retryable`。有 `type` 时按它分支，同时保留 status fallback。诊断用的 `request_id` 是可选值，公共 API 不保证每个响应都有 Engine request-ID header。transport 失败可能抛出 `httpx` error，而不是 `ZooworkError`。

SDK 不会自动重试业务操作。幂等和重试前读取核对的规则见[错误与重试](./errors.md)。

## Webhook 接收 helpers

`zoowork` 导出同步的 `verify_webhook_signature` 和 `unwrap_webhook`。keyword arguments 包括 `headers`、`raw_body` 和可选的 `secret`、`now`、`tolerance_seconds`、`max_body_bytes`。保留原始 body bytes。`now` 和签名 timestamp 使用 Unix **秒**；默认 tolerance 为 300 秒，body limit 为 16 KiB。

`verify_webhook_signature(...)` 返回 `(event_id, timestamp)`。`unwrap_webhook(...)` 返回 `WebhookEvent`，包含已校验的基础 envelope 和 data mapping。未知 event type 和 data field 会保留，任意未知顶层字段不会保留。应用仍需验证 event-specific data；helper 不检查 body `id` 是否等于 `webhook-id`。验证失败会抛 `WebhookSignatureError`。

省略 `secret` 时读取 `ZOOWORK_WEBHOOK_SECRET`；显式 secret 可以是 string 或用于轮换的 sequence。这些 helpers 不注册 endpoint，也不发送事件。完整 receiver 和管理流程见 [Webhooks](../build/webhooks.md)。

## Skill registry

在支持 Project key registry 的部署上，`upload_skill(..., scope="project")` 为具名 Project
创建 Skill；Default Project key 使用 `scope="org"`。Scope 参数是字符串。
`list_skills` 读取一页可见目录；`upload_skill_version` 和 `delete_skill` 要求对应 Skill 的写权限。
可见不等于可写。ZIP 打包、挂载、版本响应、错误和部署核验见 [Skills](../build/skills.md)。
SDK 存在方法，不代表线上部署已经支持。

## 更多流程

- [Tools](../build/tools.md)：应用执行的调用及 tool results。
- [Sessions](../build/sessions.md) 与 [Events](../build/events.md)：继续对话、取消、保存历史及 streaming。
- [文件与产物](../build/files.md)：输入文件上传、Agent 文件创建和已发布输出的获取。
- [Schedules](../build/schedules.md)：周期任务及受支持的 Outcome evaluation。
- [PyPI package](https://pypi.org/project/zoowork/)：安装与发布文件。

## Developer API 方法

已安装 package 中的数据库 viewer 方法在 production 当前不可用。可用的工具流程见 [Agent Database](../build/data-storage.md)。

- `get_usage(*, range: Literal['24h', '7d', '30d'] | None=None, timezone: str | None=None, group_by: Literal['session', 'api_key'] | None=None, view: Literal['groups', 'records', 'both'] | None=None, session_id: str | None=None, api_key_id: str | None=None, root_session_id: str | None=None, attribution: Literal['exact', 'shared', 'non_api', 'unattributed'] | None=None, page: int | None=None, per_page: int | None=None, as_of: str | None=None, snapshot: str | None=None, cursor: str | None=None)`
- `get_run_output(agent_id: str, session_id: str, run_id: str, *, cursor: str | None=None, limit: int | None=None)`
- `get_approval(agent_id: str, approval_id: str)`
- `get_custom_tool_call(agent_id: str, call_id: str)`
- `list_approval_page(agent_id: str, *, status: Literal['pending'] | None=None, session_id: str | None=None, cursor: str | None=None, limit: int=50)`
- `list_custom_tool_call_page(agent_id: str, *, status: Literal['pending'] | None=None, session_id: str | None=None, cursor: str | None=None, limit: int=50)`
- `list_agent_webhooks(agent_id: str, *, cursor: str | None=None, limit: int | None=None)`
- `create_agent_webhook(agent_id: str, input: Mapping[str, Any], *, idempotency_key: str)`
- `get_agent_webhook(agent_id: str, webhook_id: str)`
- `update_agent_webhook(agent_id: str, webhook_id: str, input: Mapping[str, Any])`
- `delete_agent_webhook(agent_id: str, webhook_id: str)`
- `rotate_agent_webhook_secret(agent_id: str, webhook_id: str, input: Mapping[str, Any], *, idempotency_key: str)`
- `test_agent_webhook(agent_id: str, webhook_id: str, *, idempotency_key: str)`
- `get_agent_webhook_event(agent_id: str, event_id: str)`
- `list_agent_webhook_deliveries(agent_id: str, webhook_id: str, *, cursor: str | None=None, limit: int | None=None, status: Literal['pending', 'in_flight', 'succeeded', 'dead', 'cancelled'] | None=None, event_type: str | None=None, event_id: str | None=None, session_id: str | None=None, run_id: str | None=None, schedule_id: str | None=None)`
- `get_agent_webhook_delivery(agent_id: str, webhook_id: str, delivery_id: str)`
- `redeliver_agent_webhook_delivery(agent_id: str, webhook_id: str, delivery_id: str, *, idempotency_key: str)`
- `redeliver_agent_webhook_deliveries(agent_id: str, webhook_id: str, input: Mapping[str, Any], *, idempotency_key: str)`

响应保留 API 字段名和未知字段。分页对象保留 `next_cursor` 和 `has_more`，现有 list 方法仍返回 list。
