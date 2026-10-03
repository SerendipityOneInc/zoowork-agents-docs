---
description: Configure the async Python SDK, manage its client lifetime, and use common Agent, Session, and event methods.
---

# Python SDK

The `zoowork` package is an async Python client for the public ZooWork API. Use Python 3.10 or later. Request and response fields retain their API spelling; Python method names and keyword arguments use `snake_case`.

This reference applies to Python SDK **0.5.0+**.

```bash
python -m pip install zoowork
```

For a complete task and cleanup, follow the [Quickstart](../get-started/quickstart.md).

## Create and close a client

Follow [Authentication](../get-started/authentication.md) to get an API key, add funds, and set `ZOOWORK_API_KEY`. The client reads the key from this variable.

```python
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        models = await client.list_models()
        print(models)

asyncio.run(main())
```

`create_zoowork_client(api_key=None, *, base_url=None, timeout=30.0, transport=None)` returns a `ZooworkClient`. A missing key raises `ValueError`. The client owns an `httpx.AsyncClient`; use `async with` or call `await client.aclose()`.

## Configuration

Pass `api_key` explicitly or set `ZOOWORK_API_KEY`. The client sends the key as a Bearer credential on each request, including event streams.

The default base URL is `https://clawapi.ecap.gsmo.ai/service/v1`. Normal use requires no URL configuration. To target a different deployment, pass `base_url` or set `ZOOWORK_BASE_URL`; the explicit argument takes precedence. The override must include `/service/v1`.

`transport` accepts an `httpx` async transport, which can be used for offline application tests.

## Core methods

| Method | Purpose |
|---|---|
| `await client.list_models()` | Read selectable model aliases. |
| `await client.create_agent(resource, idempotency_key=...)` | Create an Agent from the resource mapping; save `agent_id`. |
| `await client.get_agent(agent_id)` | Read the Agent projection and desired state. |
| `await client.start_agent(agent_id)` | Start the Agent before creating Sessions. |
| `await client.stop_agent(agent_id)` | Request that the Agent stop; reconcile warnings or failures. |
| `await client.delete_agent(agent_id)` | Delete the Agent after saving results and cleanup. |
| `await client.create_session(agent_id, session, idempotency_key=...)` | Create a conversation; save `session_id`. |
| `await client.get_session(agent_id, session_id, history=True, limit=...)` | Read recent transcript rows when requested. |
| `await client.post_events(agent_id, session_id, events)` | Send accepted input event types. |
| `async for event in client.stream_events(agent_id, session_id, cursor=...)` | Read saved events; keep the resume cursor after processing. |

Returned resource records are mappings, for example `agent["agent_id"]`; they are not TypeScript objects with attribute access. Input mappings keep fields such as `initial_events` and `idempotency_key` unchanged. The Python `idempotency_key` method argument sends the HTTP header on supported create methods; a per-event key still belongs inside the event itself.

## Handle errors

```python
from zoowork import ZooworkError

try:
    session = await client.create_session(agent_id, {})
except ZooworkError as error:
    if error.status == 401:
        raise RuntimeError("Check the API key and its scope") from error
    raise
```

`ZooworkError` provides `status`, `type`, and message text. It may also provide `content_type`, `body_snippet`, `cf_ray`, `request_id`, and `retryable`. Branch on `type` when present and retain a status fallback. A diagnostic `request_id` is optional; the public API does not guarantee an Engine request-ID header on every response. Transport failures can raise `httpx` errors instead of `ZooworkError`.

The SDK does not automatically retry business operations. Follow [Errors and retries](./errors.md) for idempotency and read-before-retry rules.

## Webhook receiving helpers

`zoowork` exports synchronous `verify_webhook_signature` and `unwrap_webhook` helpers. They receive keyword arguments `headers`, `raw_body`, and optional `secret`, `now`, `tolerance_seconds`, and `max_body_bytes`. Preserve the original body bytes. `now` and signed timestamps use Unix **seconds**; the default tolerance is 300 seconds and the body limit is 16 KiB.

`verify_webhook_signature(...)` returns `(event_id, timestamp)`. `unwrap_webhook(...)` returns a `WebhookEvent` with the verified base envelope and its data mapping. Unknown event types and data fields are retained, but arbitrary unknown top-level fields are not. Validate event-specific data yourself; the helper does not assert that body `id` equals `webhook-id`. Verification failures raise `WebhookSignatureError`.

Omitted `secret` reads `ZOOWORK_WEBHOOK_SECRET`; explicit secrets can be a string or a sequence for rotation. These helpers do not register endpoints or send events. Follow [Webhooks](../build/webhooks.md) for the full receiver and management flow.

## More workflows

- [Tools](../build/tools.md): application-executed calls and tool results.
- [Sessions](../build/sessions.md) and [Events](../build/events.md): continuation, cancellation, saved history, and streaming.
- [Files and artifacts](../build/files.md): Agent file creation and published output retrieval.
- [Schedules](../build/schedules.md): recurring tasks and supported Outcome evaluation.
- [Package guide](https://github.com/SerendipityOneInc/zoowork-sdk-python): additional package interfaces.

## Developer API methods

- `get_agent_database(agent_id: str)`
- `get_agent_database_rows(agent_id: str, table_name: str, *, limit: int | None=None, offset: int | None=None)`
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

Responses preserve API spelling and unknown fields. Paging objects retain `next_cursor` and `has_more`; existing list methods still return lists.
