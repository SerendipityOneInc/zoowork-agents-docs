---
description: Look up Python SDK client methods, signatures, exported types, event and webhook helpers, and errors for public API workflows.
---

# Python SDK reference

Client methods, types, and helpers exported by the `zoowork` package.

This reference applies to Python SDK **0.9.0+**.

This page is the reference. For task-shaped guidance start at [Agents](../build/agents.md),
[Sessions](../build/sessions.md), or the [Quickstart](../get-started/quickstart.md).

## Install {#install}

```bash
python -m pip install zoowork
```

The package is `zoowork` on [PyPI](https://pypi.org/project/zoowork/). It requires
**Python 3.11 or later**; the package metadata lists Python 3.11, 3.12, 3.13, and 3.14. Its only
runtime dependency is `httpx` (`>=0.27,<1`). The package ships type hints (`py.typed`), and
webhook verification uses only the standard library.

Read the installed version from `zoowork.__version__`. The installed package also contains
`zoowork/CHANGELOG.md`, which lists what each release up to the installed one added.

### Async usage {#async-usage}

The client is asynchronous. Call its methods from a coroutine and run that coroutine with
`asyncio.run()`:

```python
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        models = await client.list_models()
        print(len(models))

asyncio.run(main())
```

Every client method is a coroutine that you `await`, with two exceptions: `stream_events()` and
`iter_agents()` are async generators that you consume with `async for`, without `await`. The
event helpers, `parse_sse()` aside, and the webhook helpers are ordinary synchronous functions.

The client owns an `httpx.AsyncClient`. Create it, use it, and close it inside the same event
loop.

### Provide an `httpx` transport {#httpx-transport}

`transport` accepts any `httpx.AsyncBaseTransport` and is passed to the client's
`httpx.AsyncClient`. Every request goes through it, including the event stream. Use it to serve
canned responses in offline tests:

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

To add tracing, subclass `httpx.AsyncBaseTransport`, delegate each request to an inner
`httpx.AsyncHTTPTransport()`, and close the inner transport in your `aclose()`. Closing the client
closes its transport.

## Create the client {#create-the-client}

```python
def create_zoowork_client(
    api_key: str | None = None,
    *,
    base_url: str | None = None,
    timeout: float | httpx.Timeout = 30.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ZooworkClient
```

Returns a `ZooworkClient`. It is the same as calling the constructor without `service_token`:

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

Construction makes no request. A missing API key raises `ValueError` at construction; a wrong
key is accepted and the first call fails with `401`. Create one client and reuse it: it holds
an `httpx` connection pool.

Get an API key and add funds in [ZooWork Platform](https://platform.zoowork.ai); see
[Authentication](../get-started/authentication.md) for setup. The key selects an organization
and Project. It does not replace your application's end-user authorization: authenticate end
users and authorize each Agent and Session access.

### Configuration

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `api_key` | `str \| None` | `None` | Your API key from ZooWork Platform. Resolution order: this argument, then `ZOOWORK_API_KEY`. Neither set raises `ValueError`. |
| `base_url` | `str \| None` | `None` | The API base **including `/service/v1`**. Resolution order: this argument, then `ZOOWORK_BASE_URL`, then `DEFAULT_BASE_URL` (`https://clawapi.ecap.gsmo.ai/service/v1`). Set it only to target a different deployment. Trailing slashes are stripped; paths such as `/models` are appended. |
| `timeout` | `float \| httpx.Timeout` | `30.0` | Passed to `httpx`. A number applies to connect, read, write, and pool waits. |
| `transport` | `httpx.AsyncBaseTransport \| None` | `None` | See [Provide an `httpx` transport](#httpx-transport). |
| `service_token` | `str \| None` | `None` | `ZooworkClient` only. A different bearer credential; passing it together with `api_key` raises `ValueError`. Use `api_key` for public API requests. |

The client sends the credential as `Authorization: Bearer <key>` on every request, including
the event stream. Keep the key on your server and call ZooWork through your own backend.

The read timeout also applies to `stream_events()`: when no bytes arrive for that long, `httpx`
raises `httpx.ReadTimeout`. Reconnect from the last saved cursor, as described under
[`stream_events()`](#stream-events).

### Close the client {#close-the-client}

```python
async def aclose() -> None
```

`async with create_zoowork_client() as client:` returns the client and closes it on exit. Without
`async with`, call `await client.aclose()` when you are done. Do not use a client after closing
it.

## Methods {#methods}

`ZooworkClient` groups its methods the way this section does. Everything the API nests under an
Agent - Sessions, events, approvals, schedules, `wake`, `exec` - takes `agent_id` first. The
Skill registry, usage, balance, and Environments are top-level resources and take none.

Signatures on this page omit `self`. Parameters after `*` are keyword-only. Unless a method says
otherwise, it returns the API response as a `dict` (`JsonObject`, which is `dict[str, Any]`) with
the API's field spelling and unknown fields preserved. Read fields with `agent["agent_id"]` or
`agent.get("status")`, not attribute access. Request mappings are sent as given, so keys such as
`initial_events` and `userTimezone` keep their API spelling.

The SDK never retries a request. A non-2xx response raises [`ZooworkError`](#errors). Methods
that take `idempotency_key` send it as the `Idempotency-Key` header; an empty or omitted key
sends no header.

**Models**

| Method | Returns | What it does |
|---|---|---|
| `list_models()` | `list[JsonObject]` | Lists the model catalog available to your key. Select a row whose `selectable` is not `False`. |

**Agents**

| Method | Returns | What it does |
|---|---|---|
| `create_agent(resource, *, ownership=None, idempotency_key=None)` | `JsonObject` | Creates an Agent. Returns the **flat create receipt**, not the read projection. The Agent comes back stopped. |
| `list_agents(*, labels=None, page=None)` | [`AgentPage`](#agentpage) | Reads one page of Agents in the key's organization, Project, and owner scope. `async for` over the page continues through later pages. |
| `iter_agents(*, labels=None, page=None)` | `AsyncIterator[JsonObject]` | Yields every matching Agent across pages. |
| `get_agent(agent_id)` | `JsonObject` | Reads an Agent. Returns the **projection**: configuration under `declared`, version at `status.config_version`. |
| `update_agent(agent_id, sections)` | `JsonObject` | PUTs the named declared sections, merging per section. |
| `delete_agent(agent_id)` | `None` | Soft-deletes the Agent. Does not stop it. |
| `start_agent(agent_id)` | `dict[str, list[str]]` | Sets `desired_state` to `running`. Required before any Session call. |
| `stop_agent(agent_id)` | `dict[str, list[str]]` | Sets `desired_state` to `stopped`. |
| `wait_until_running(agent_id, *, timeout=30.0, interval=0.5)` | `JsonObject` | Polls `status.desired_state` until it reads `running` and returns that projection. |
| `list_agent_skills(agent_id, *, verbose=False)` | `list[JsonObject]` | Lists the Skills resolved onto the Agent. |
| `put_agent_skill(agent_id, skill_id, *, enabled=True, version_pin=None)` | `JsonObject` | Creates or updates an assignment for a Skill visible to the key. |
| `delete_agent_skill(agent_id, skill_id)` | `None` | Deletes an explicit Skill assignment. |

**Channels**

Platform keys cannot call the Agent channel routes; these methods return
`404 service_api.not_found`. To connect a chat application, authorize its users in your backend
and forward their messages through the [Session API](../build/sessions.md). See
[Channels](../build/channels.md) and [Channel methods](#channel-methods).

| Method | Returns | What it does |
|---|---|---|
| `list_channels(agent_id)` | `list[JsonObject]` | Lists channel bindings. |
| `add_channel(agent_id, channel)` | `JsonObject` | Submits channel-binding configuration. |
| `update_channel(agent_id, platform, update=None)` | `JsonObject` | Submits changes to a channel binding. |
| `remove_channel(agent_id, platform, *, account="default")` | `None` | Requests removal of one platform/account binding. |
| `start_channel_setup(agent_id, platform, setup=None)` | `JsonObject` | Starts a guided setup request. |
| `poll_channel_setup(agent_id, platform, session_id)` | `JsonObject` | Reads the status of one setup request. |
| `cancel_channel_setup(agent_id, platform, session_id)` | `None` | Cancels a setup request. |
| `wait_for_channel_setup(agent_id, platform, session_id, *, timeout=600.0, on_poll=None)` | `JsonObject` | Polls the setup request until it reaches a final status or times out. |
| `start_feishu_setup` / `poll_feishu_setup` / `cancel_feishu_setup` / `wait_for_feishu_setup` | as above | Feishu shortcuts for the four guided-setup methods; they take no `platform`. |

**Skill registry**

On deployments with Project-key registry support, named Project keys create and modify their
own `project` Skills; Default Project keys create and modify Organization-shared `org` Skills.
Listing includes visible read-only records as well. See [Skills](../build/skills.md) for
deployment verification and the complete workflow.

| Method | Returns | What it does |
|---|---|---|
| `upload_skill(upload, *, scope, file_name="skill.zip", description=None, idempotency_key=None)` | `JsonObject` | Submits a ZIP to create a registry Skill and its first version. |
| `upload_skill_version(skill_id, upload, *, file_name="skill.zip", description=None, idempotency_key=None)` | `JsonObject` | Submits a ZIP as another version of a registry Skill. |
| `list_skills(*, scope=None, q=None, page=None)` | `list[JsonObject]` | Reads one catalog page. |
| `delete_skill(skill_id)` | `None` | Deletes a registry Skill. |

**Sessions and events**

| Method | Returns | What it does |
|---|---|---|
| `create_session(agent_id, session=None, *, idempotency_key=None)` | `JsonObject` | Opens a Session. Requires a running Agent, else `409 agent_not_running`. |
| `get_session(agent_id, session_id, *, history=False, limit=None)` | `JsonObject` | Reads a Session, optionally with the at-rest transcript. |
| `list_sessions(agent_id, *, page=None)` | `list[JsonObject]` | One page of the legacy numeric-page lane, newest first. |
| `list_session_page(agent_id, *, cursor="sls1:0", ...)` | [`SessionListPage`](#sessionlistpage) | One page of the filtered cursor lane. |
| `archive_session(agent_id, session_id)` | `JsonObject` | Stamps `archived_at`; later writes are `409 session_archived`. |
| `delete_session(agent_id, session_id)` | `None` | Soft-deletes the Session, cancelling an in-flight run first. |
| `post_events(agent_id, session_id, events)` | `list[JsonObject]` | Writes user or system events into a Session and returns one entry per event. |
| `list_events(agent_id, session_id, *, cursor=None, types=None, limit=None)` | `list[SessionEvent]` | Reads one page of the unified event log, your own inputs included. |
| `list_events_page(agent_id, session_id, *, cursor=None, types=None, limit=None)` | `tuple[list[SessionEvent], bool \| None, str \| None]` | The same page with `has_more` and `next_cursor`. |
| `list_all_events(agent_id, session_id, *, cursor=None, types=None, page_size=500)` | `list[SessionEvent]` | Every durable event, following the server's cursor. |
| `stream_events(agent_id, session_id, *, cursor=None)` | `AsyncIterator[SessionEvent]` | Streams durable events over SSE, resumable with `cursor`. |

**Application-executed custom tools**

| Method | Returns | What it does |
|---|---|---|
| `list_custom_tool_calls(agent_id, *, status=None, session_id=None)` | `list[CustomToolCallRecord]` | Recovers pending application-executed calls. Only `"pending"` is accepted as a filter. |
| `resolve_custom_tool_call(agent_id, call_id, *, content, is_error=None, resolved_by=None)` | `CustomToolCallRecord` | Posts 1–16 result blocks for one pending call. |
| `get_custom_tool_call(agent_id, call_id)` | `CustomToolCallRecord` | Reads one call, pending or terminal. |
| `list_custom_tool_call_page(agent_id, *, status=None, session_id=None, cursor=None, limit=50)` | `JsonObject` | One cursor page that keeps `next_cursor` and `has_more`. |

**Approvals**

| Method | Returns | What it does |
|---|---|---|
| `list_approvals(agent_id, *, status=None, session_id=None)` | `list[JsonObject]` | Lists tool calls waiting for a decision. |
| `resolve_approval(agent_id, approval_id, *, decision, resolved_by=None)` | `JsonObject` | Sends a decision for one approval. |
| `get_approval(agent_id, approval_id)` | `JsonObject` | Reads one approval, pending or terminal. |
| `list_approval_page(agent_id, *, status=None, session_id=None, cursor=None, limit=50)` | `JsonObject` | One cursor page that keeps `next_cursor` and `has_more`. |

**System prompt**

| Method | Returns | What it does |
|---|---|---|
| `get_system_prompt(agent_id)` | `JsonObject` | The declared system-prompt pin and the rendered template in effect. |
| `preview_system_prompt(agent_id, preview)` | `JsonObject` | Assembles the exact prompt for runtime facts you supply, without touching a Session. |
| `upgrade_system_prompt(agent_id, upgrade)` | `JsonObject` | Moves the pin, guarded by `expected_config_version`. |

**Artifacts**

| Method | Returns | What it does |
|---|---|---|
| `list_artifacts(agent_id, *, page=None, limit=None, session_id=None, source_path=None, created_before=None)` | `JsonObject` | One page of Artifacts, with `artifacts` always a list. |
| `get_artifact(agent_id, artifact_id)` | `JsonObject` | One Artifact row. |
| `download_artifact(agent_id, artifact_id)` | `JsonObject` | Returns an access URL for a `ready` Artifact. |
| `delete_artifact(agent_id, artifact_id)` | `JsonObject` | Deletes one Artifact and returns the row. |

**Automation: schedules and wake**

| Method | Returns | What it does |
|---|---|---|
| `list_schedules(agent_id)` | `list[JsonObject]` | The Agent's schedules. |
| `create_schedule(agent_id, schedule, *, idempotency_key=None)` | `JsonObject` | Creates a schedule and returns a receipt. |
| `get_schedule(agent_id, schedule_id)` | `JsonObject` | Reads one schedule. |
| `update_schedule(agent_id, schedule_id, update)` | `JsonObject` | Replaces the definition, after removing six read-only fields. |
| `delete_schedule(agent_id, schedule_id)` | `None` | Deletes a schedule. |
| `trigger_schedule(agent_id, schedule_id)` | `JsonObject` | Requests one extra firing of an enabled schedule. |
| `list_schedule_runs(agent_id, schedule_id, *, limit=None)` | `list[JsonObject]` | Past fires, newest first. |
| `wake(agent_id, wake)` | `JsonObject` | Pushes a reminder into the Agent's heartbeat queue. |

**Exec and files**

| Method | Returns | What it does |
|---|---|---|
| `exec(agent_id, args)` | `JsonObject` | Runs an argv list in the Agent's sandbox, with cwd `/workspace`. |
| `upload_file(agent_id, path, content)` | `JsonObject` | Copies `bytes` or text into the sandbox and returns `path`, `size`, and `sha256`. |

**Usage, balance, and run output**

| Method | Returns | What it does |
|---|---|---|
| `get_usage(*, range=None, ...)` | `JsonObject` | Reads usage for the key's scope. |
| `get_balance()` | `JsonObject` | Reads the Organization balance shared by every Project. |
| `get_run_output(agent_id, session_id, run_id, *, cursor=None, limit=None)` | `JsonObject` | Reads the output of one run. |

**Agent webhooks**

Thirteen methods register, update, test, and recover webhook endpoints for one Agent. See
[Webhook management methods](#webhook-management-methods).

**Environments**

Platform keys cannot call the root `/environments` routes; these methods return
`404 service_api.not_found`. Agents use the managed default sandbox without creating an
Environment. See [Environments](../build/environments.md) and
[Environment methods](#environment-methods).

| Method | Returns | What it does |
|---|---|---|
| `list_environments(*, page=None)` | `list[JsonObject]` | Lists Environment records. |
| `get_environment(environment_id)` | `JsonObject` | Reads one Environment record. |
| `create_environment(resource, ownership, *, idempotency_key=None)` | `JsonObject` | Submits an Environment definition and its ownership. |
| `archive_environment(environment_id)` | `JsonObject` | Requests archival of an Environment. |
| `create_environment_version(environment_id, config, *, idempotency_key=None)` | `JsonObject` | Submits another configuration version. |
| `get_environment_version(environment_id, version, *, resource_class=None)` | `JsonObject` | Reads one version. |

::: warning Deprecated workspace file methods
`get_workspace_file`, `write_workspace_file`, and `get_workspace_file_content` remain callable,
but the hosted service does not enable the workspace Files routes, so these calls fail with HTTP
501 or 502. Send a file with [`upload_file()`](#upload-file), and retrieve results by asking the
Agent to publish an Artifact and downloading it. See [Files and artifacts](../build/files.md).

Database viewer methods in the package are unavailable in production and are omitted here.
Use the Agent's `agent_db` tool through a Session; see
[Agent Database](../build/data-storage.md).
:::

All snippets below run inside an `async` function and assume:

```python
from zoowork import create_zoowork_client

client = create_zoowork_client()  # reads ZOOWORK_API_KEY; close with await client.aclose()
```

`agent_id`, `session_id`, and similar names stand for IDs your application saved.

---

### `list_models()` {#list-models}

```python
async def list_models() -> list[JsonObject]
```

No parameters. Returns the runtime model catalog as a list of rows; the SDK accepts both the
bare-list and the `{"models": [...]}` response shapes and always returns a list.

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

Pass a `model` value verbatim as `resource["model"]["primary"]`. Do not hardcode the underlying
provider model name behind the alias. Only select rows whose `selectable` is not `False`.
Lifecycle rows may remain visible for existing Agents after new selection is disabled; selecting
one returns `409 model_not_selectable`. When present, `expired_fallback_to` names its
replacement.

A row may carry `thinking: {"default": <level>, "levels": [<level>, ...]}`. `levels` lists, in
ascending order, the [`ThinkingLevel`](#thinkinglevel) values that take effect as named on that
model; any other level resolves to the nearest listed one. `default` is what the platform
applies when an Agent sets none. Older servers omit it, so read it with `model.get("thinking")`.

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

| Parameter | Type | Notes |
|---|---|---|
| `resource` | `Mapping[str, Any]` | The configuration. `name` is required. The SDK drops `warm` and `onboarding` keys and always sends `onboarding: false`. |
| `ownership` | `Mapping[str, str] \| None` | Omit it when creating an Agent. The public gateway derives ownership from the key. |
| `idempotency_key` | `str \| None` | Sent as the `Idempotency-Key` header. |

Common `resource` keys are `name`, `model` (`primary`, and optionally `thinking`),
`userTimezone`, `include_global_skills`, `skills`, `labels`, `tool_policy`, `mcp`,
`custom_tools`, `system_prompt`, and `outcome`. See [Agents](../build/agents.md) for the
field-by-field notes.

Returns the **create receipt**: a flat mapping with `agent_id`, a top-level `config_version`,
`ownership`, and `resolved_skills`. It carries no `declared` and no `status`.

```python
created = await client.create_agent(
    {"name": "research-agent", "model": {"primary": "litellm/gpt-5.6-terra"}},
    idempotency_key="provision-research-agent-1",
)
print(created["agent_id"], created["config_version"])  # "agt_...", 1
```

The new Agent is **stopped**: `create_session()` before `start_agent()` is
`409 agent_not_running`. The receipt's `config_version` goes stale immediately; read the current
version from `get_agent()`. Derive the idempotency key from something stable in your system; see
[Errors and retries](./errors.md).

Omitting `model` pins the platform default active at creation time. Defaults can change, so call
`list_models()` and set `primary` explicitly when provisioning must be deterministic.
`include_global_skills` defaults to `True`; set it to `False`, or send an explicit empty
`skills` list, to disable automatic global Skills. `userTimezone` is a named IANA timezone for
prompt and message time context; it does not set a schedule's timezone.

---

### `list_agents()` and `iter_agents()` {#list-agents}

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

| Parameter | Type | Notes |
|---|---|---|
| `labels` | `Mapping[str, str] \| None` | Filters on declared labels; each entry is sent as `label.<key>=<value>`. |
| `page` | `int \| None` | 1-based page number. Zero, a negative number, or a `bool` raises `ValueError` before the request. |

`list_agents()` returns one [`AgentPage`](#agentpage). `async for` over that page yields its rows
and then fetches each later page with the same filters. `iter_agents()` does the same when you do
not need the first page's metadata.

```python
page = await client.list_agents(labels={"app": "support"})
print(page.data, page.total, page.next_page)
if page.has_next_page():
    following = await page.get_next_page()
    print(following.data)

async for agent in client.iter_agents(labels={"app": "support"}):
    print(agent["agent_id"])
```

Page numbers start at 1 and page size is fixed at 100; there is no `limit` option or string
cursor. The SDK raises `ValueError` when the response lacks valid `agents`, `page`,
`page_size`, and `total` values, or when `page` differs from the page requested. Breaking out of
iteration stops further requests. Concurrent additions or deletions can shift page contents;
iteration is not a snapshot. See [List your agents](../build/agents.md#list-your-agents).

---

### `get_agent()` {#get-agent}

```python
async def get_agent(agent_id: str) -> JsonObject
```

Returns the **read projection**, which is a different shape from the create receipt: the
configuration is under `declared`, the version is at `status.config_version`, and there is no
top-level `config_version` and no top-level `name`.

```python
agent = await client.get_agent(agent_id)
print(agent["declared"]["name"])              # "research-agent"
print(agent["status"]["desired_state"])       # "running"
print(agent["status"]["config_version"])      # 3
```

| | create receipt (`create_agent`) | read projection (`get_agent`, `update_agent`) |
|---|---|---|
| version | `config_version` (top level) | `status.config_version` |
| name | not present | `declared.name` |
| lifecycle state | not present | `status.desired_state` |
| `declared` | absent | present |
| `status` | absent | present |

Write one accessor that covers both shapes:

```python
def config_version(agent: dict) -> int | None:
    return (agent.get("status") or {}).get("config_version") or agent.get("config_version")
```

Gate API readiness on `status.desired_state`, never on `status.actual_state`. `actual_state` is
a best-effort chat-channel health projection, and `running` is not one of its values.

An unknown, soft-deleted, or out-of-scope Agent ID returns 404. The public Agent route uses
`service_api.not_found`; match the status as well as the type. See [Errors](./errors.md).

---

### `update_agent()` {#update-agent}

```python
async def update_agent(agent_id: str, sections: Mapping[str, Any]) -> JsonObject
```

PUTs the declared sections you name and returns the read projection.

**Sections you omit are preserved.** Mapping sections shallow-merge one level; lists and scalars
replace. `tool_policy` and `system_prompt` are exceptions: every PUT naming one replaces it
wholesale. See [Tools](../build/tools.md).

```python
updated = await client.update_agent(agent_id, {"labels": {"tier": "paid"}})
print(updated["declared"]["labels"])  # other existing label keys are preserved
```

**Configuration writes increment `config_version`, including identical values; ownership-only
writes do not.** Add a positive `expected_config_version` to `sections` to check the version
atomically with the write. A mismatch raises `ZooworkError` with status `409` and type
`active_config_changed` without changing configuration. Re-read and recompute the change before
retrying. The precondition is not stored in `declared`. Omit it for last-write-wins updates. See
the [update example](../build/agents.md#update-only-the-version-you-read).

`model.thinking` merges on its own, so `primary` is not required:

```python
from zoowork import ThinkingLevel

level: ThinkingLevel = "high"
await client.update_agent(agent_id, {"model": {"thinking": level}})
await client.update_agent(agent_id, {"model": {"thinking": None}})  # clear; follow the default
```

`None` serializes to JSON `null` and clears the declared level; omitting the key preserves it.
See [Agent thinking](../build/agents.md#set-the-thinking-level). `skills`, `credentials`, and
unknown fields in the body return `400`.

---

### `delete_agent()` {#delete-agent}

```python
async def delete_agent(agent_id: str) -> None
```

Soft-deletes the Agent and returns `None` on the first `204`. Repeated deletion returns 404
through the public API. A 404 also hides inaccessible resources, so treat it as cleanup complete
only for an Agent you know belonged to the unchanged key scope; see
[safe retry conditions](./errors.md#what-is-safe-to-retry).

It does **not** stop the Agent, cancel running workflows, delete schedules, or release the
sandbox. Stop first, then delete. See [Agents](../build/agents.md).

---

### `start_agent()` and `wait_until_running()` {#start-agent}

```python
async def start_agent(agent_id: str) -> dict[str, list[str]]

async def wait_until_running(
    agent_id: str,
    *,
    timeout: float = 30.0,
    interval: float = 0.5,
) -> JsonObject
```

`start_agent()` sets `desired_state` to `running`, the precondition for `create_session()` and
`post_events()`. It returns `{"warnings": [...]}`; the list is empty when the response has no
warnings. HTTP failures still raise. Do not treat a failed call as a warning-only success.

Then wait for `status.desired_state == "running"` with `wait_until_running()`:

```python
result = await client.start_agent(agent_id)
print(result["warnings"])  # [] or informational messages
agent = await client.wait_until_running(agent_id)
print(agent["status"]["desired_state"])  # "running"
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `timeout` | `float` | `30.0` | Maximum seconds to wait, including the request in flight. |
| `interval` | `float` | `0.5` | Seconds between polls. |

It polls `get_agent()` and returns the first projection whose `status.desired_state` is
`running`. When the time runs out it raises `ZooworkError` with status `408`, type `"timeout"`,
and `retryable` `False`. **That error is created locally**; the server never sends it. Errors
from `get_agent()`, such as a 404, propagate unchanged.

---

### `stop_agent()` {#stop-agent}

```python
async def stop_agent(agent_id: str) -> dict[str, list[str]]
```

Sets `desired_state` to `stopped`, with the same `{"warnings": [...]}` result as
`start_agent()`. After a stop, `create_session()` on that Agent returns `409 agent_not_running`.

A stop request can fail after the desired state changes. Read the Agent again before retrying;
`desired_state: "stopped"` alone does not prove cleanup completed.

---

### `list_agent_skills()` {#list-agent-skills}

```python
async def list_agent_skills(agent_id: str, *, verbose: bool = False) -> list[JsonObject]
```

Returns the Skills resolved onto the Agent, taken from the response's `skills` list. `verbose=True`
sends `?verbose=true`, which also returns ineligible and excluded entries.

```python
for skill in await client.list_agent_skills(agent_id):
    print(skill["skill_id"], skill.get("name"), skill.get("version"), skill.get("eligible"))
```

Global Skills are included by default unless `include_global_skills` is `False`. A row's
`scope` describes visibility, not permission to edit registry content. Preserve unknown scope
values.

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

Sends `{"enabled": enabled, "version_pin": version_pin}`; `None` is sent as `null`, which leaves
the assignment unpinned. The response can carry `config_version` and `warnings`.

```python
receipt = await client.put_agent_skill(agent_id, skill_id, enabled=True, version_pin=1)
print(receipt.get("config_version"), receipt.get("warnings"))
```

The Skill must be visible to the key: global Skills, organization Skills in the same
organization, Project Skills in the same organization and named Project, or personal Skills
owned by the key's owner. An unknown or inaccessible ID returns 404. Call `list_agent_skills()`
afterwards to confirm the resolved version and eligibility.

---

### `delete_agent_skill()` {#delete-agent-skill}

```python
async def delete_agent_skill(agent_id: str, skill_id: str) -> None
```

Deletes the explicit assignment. Subject to the same visibility rule as `put_agent_skill()`.
Deleting a global Skill's assignment restores its default behavior; it does not remove the Skill
from the global catalog. To exclude it, use an assignment with `enabled=False`.

---

### Channel methods {#channel-methods}

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

With a Platform key every one of these returns `404 service_api.not_found`; see
[Channels](../build/channels.md). The contracts are listed because the methods exist in the
package. `wait_for_channel_setup()` calls `poll_channel_setup()` until `status` is `success`,
`expired`, `denied`, or `error`, waits the response's `poll_interval` seconds (default 5, at
least 0.25) between polls, calls `on_poll` with each result, and raises `ZooworkError` `408` /
`"timeout"` after `timeout` seconds. The Feishu methods call the channel methods with
`platform="feishu"`.

---

### System prompt methods {#system-prompt-methods}

```python
async def get_system_prompt(agent_id: str) -> JsonObject
async def preview_system_prompt(agent_id: str, preview: Mapping[str, Any]) -> JsonObject
async def upgrade_system_prompt(agent_id: str, upgrade: Mapping[str, Any]) -> JsonObject
```

`get_system_prompt()` returns the system-prompt pin as declared and the rendered template in
effect. A fresh Agent is pinned to the active platform version; `declaration: None` marks an
older Agent still on legacy behavior.

`preview_system_prompt()` assembles the exact prompt for runtime facts you supply, without
touching any Session. Six `preview` fields are required, and omitting one is a `400` naming it:
`config_version` (the Agent's current one, else `409 config_version_changed`), `now_ms`,
`session_id`, `model_display`, `workspace_dir`, and `tool_names`. `channel`, `chat_type`,
`session_key`, and `subagent` are optional.

`upgrade_system_prompt()` moves the pin. `expected_config_version` is required; a stale value is
`409 config_version_changed`, so read fresh and upgrade again. Omit `template_version` to select
the currently active platform version. The response carries the new `config_version`.

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

Registers a ZIP Skill and its first version with a multipart request. The ZIP goes in the
`files[]` field as `application/zip` under `file_name`, with `scope` as a form field.

**A `str` or `Path` is a file path that the SDK reads**, not ZIP content. Pass `bytes`,
`bytearray`, or `memoryview` for content already in memory.

```python
from pathlib import Path

skill = await client.upload_skill(
    Path("slide-layout.zip"),
    scope="org",  # Use "project" for a named Project key.
    file_name="slide-layout.zip",
)
skill_id = skill["skill_id"]
```

With Project registry deployment support, named Project keys use `scope="project"` and Default
Project keys use `scope="org"`. The key determines ownership. Other Platform scopes return
`400 service_api.invalid_body`. Put the name and description in `SKILL.md`; the create-time
`description` option is dropped. The `Idempotency-Key` header is not a replay guarantee:
reconcile an uncertain result, for example with `list_skills()`, before retrying. See
[Skills](../build/skills.md).

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

Publishes a ZIP with the existing Skill name and returns a version record with `skill_id`,
`version`, and `state`. Do not read the create record's `latest_version` or `status` from it.
`upload` follows the same rules as in `upload_skill()`.

```python
version = await client.upload_skill_version(skill_id, Path("slide-layout.zip").read_bytes())
if version["state"] != "ready":
    raise RuntimeError(f"Skill version is {version['state']}")
```

Named Project keys write their own `project` Skills; Default Project keys write their
Organization's `org` Skills. Visible global and personal Skills, and a named Project's visible
`org` Skills, are read-only in the registry; writes return `404 service_api.not_found`.
Publishing does not transfer ownership. Unpinned assignments follow new versions; pinned ones do
not.

---

### `list_skills()` {#list-skills}

```python
async def list_skills(
    *, scope: str | None = None, q: str | None = None, page: int | None = None
) -> list[JsonObject]
```

Reads one catalog page and returns its `skills` list. `q` filters by name, and `page` is 1-based;
one page is not the full catalog. Platform keys see global Skills, same-organization `org`
Skills, same-Project `project` Skills, and eligible personal Skills owned by the key's owner.
Ownership selectors come from the key. Visibility does not grant registry write permission.

---

### `delete_skill()` {#delete-skill}

```python
async def delete_skill(skill_id: str) -> None
```

Deletes a registry Skill (`204`); it does not detach one Agent, which is what
`delete_agent_skill()` does. Platform keys may delete their own named Project's `project`
Skills or, with a Default Project key, their Organization's `org` Skills. Other IDs, including
visible read-only Skills, return `404 service_api.not_found`. Check shared consumers first.

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

| `session` key | Notes |
|---|---|
| `initial_events` | Accepts only `user.message`, at most 50 entries. Supplying one starts the first turn immediately. |
| `metadata` | Arbitrary JSON stored with the Session and returned by `get_session()`. Nothing interprets it, and you cannot add to it later. |
| `runtime_mode` | `"active"` pins the active configuration at creation. Omitted, active configuration is resolved on later turns. |
| `idle_compaction` | `True`, `False`, or `None`; the SDK preserves `False`, `None`, and omission as given. |

`session=None` sends an empty body.

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

`session_id` is opaque. Do not require a resource prefix; `api:` belongs to `session_key`. The
create receipt has `status: "running"` and no `run_status`. Read `run_status` from a later
`get_session()` call or a `list_sessions()` row.

The Agent must be running. Against a stopped Agent this raises `ZooworkError` with status `409`
and type `agent_not_running`. Derive the idempotency key from something stable in your system,
never from a value generated at call time.

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

| Parameter | Type | Notes |
|---|---|---|
| `history` | `bool` | Only `True` is sent, as `?history=true`. Adds the at-rest transcript under `history`. |
| `limit` | `int \| None` | Number of most recent transcript rows. Server default 100, maximum 500. Only meaningful with `history=True`. |

```python
from zoowork import message_text

s = await client.get_session(agent_id, session_id, history=True, limit=20)
print(s.get("run_status"))  # "succeeded" - latest run state
for row in s.get("history", []):
    if row["entry_type"] == "message":
        print(row["seq"], message_text(row["entry"]["message"]))
```

`history` rows are the **at-rest transcript, not the event log**. Each row has `seq`,
`entry_type`, `entry`, and optionally `created_at`, in ascending `seq` order. Conversation text
is under `entry["message"]` for `entry_type == "message"`; skip other entry types.

The fields vary by response surface: `create_session()` returns `status: "running"` and no
`run_status`; `get_session()` returns `status: None` alongside `run_status`; `list_sessions()`
rows carry `run_status` and omit `status`. `run_status` can be `None`, and `pending_approvals`
is an optional count. `session_key` is `api:<session_id>` for Sessions you create; `channel` is
`api` for those and `cron` for Sessions a schedule fired.

---

### `list_sessions()` and `list_session_page()` {#list-sessions}

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

`list_sessions()` reads the legacy numeric-page lane: newest first by `updated_at`, 50 per page,
`page` 1-based. Each row carries `run_status` and omits `status`.

`list_session_page()` reads the filtered cursor lane and returns a
[`SessionListPage`](#sessionlistpage). It always sends `cursor`, starting at `"sls1:0"`, so it
cannot fall into the legacy lane. `limit` is 1–100. List filters are joined with commas, and
`include_archived` is always sent as `true` or `false`.

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

Cursors are opaque and bound to the Agent and the complete filter set. Keep every filter
unchanged while continuing. `include_deleted=True` adds deletion tombstones, which carry
`deleted`, and the page reports `includes_deleted=True`; a tombstone is not a readable Session.
The SDK raises `TypeError` when `next_cursor` is not a string or `None`, or `includes_deleted` is
not a boolean.

---

### `archive_session()` and `delete_session()` {#archive-session}

```python
async def archive_session(agent_id: str, session_id: str) -> JsonObject
async def delete_session(agent_id: str, session_id: str) -> None
```

`archive_session()` stamps `archived_at` and returns the response with `archived` coerced to a
`bool`. Afterwards writes are `409 session_archived` while reads keep working. Interrupt an
in-flight run first.

`delete_session()` soft-deletes the Session (`204`), cancelling an in-flight run first.
Transcripts and events remain for audit.

---

### `post_events()` {#post-events}

```python
async def post_events(
    agent_id: str, session_id: str, events: Sequence[Mapping[str, Any]]
) -> list[JsonObject]
```

Writes events into an existing Session. The response is `202`; the SDK returns its `events`
list, one entry per event, or `[]` when the list is absent. An accepted event comes back as the
full event object the history will show, with its `seq`; an unaccepted one stays an
`{"id", "type", "accepted": False}` receipt.

The write path accepts the five types in `PUBLIC_INPUT_EVENT_TYPES`: `user.message`,
`user.interrupt`, `user.tool_confirmation`, `user.custom_tool_result`, and `system.message`.
`user.custom_tool_result` is the event-form alternative to `resolve_custom_tool_call()`.

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

`accepted` means the event was queued, not that a turn finished. A turn ends at `run.finished`.
Give each event a stable `idempotency_key` inside the event body, and a `post_events()` call
retried after a timeout will not deliver it twice.

**`user.interrupt` against a live run aborts it**: the response carries `accepted: True` and the
run ends with `run.finished` whose `payload["status"]` is `aborted`. With no run in flight,
`user.interrupt` returns `accepted: False`. **That is a no-op, not an error.**

**`system.message` reaches the model on the following turn**, out of band, and carries its body
in `text` rather than `content`. For API-Session user messages, `actor` is `{"ref": "<id>"}`;
see the identity limits in [Events](../build/events.md#user-message).

---

### `list_events()`, `list_events_page()`, and `list_all_events()` {#list-events}

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

Each method also has a deprecated overload that takes `after: int | None` instead of `cursor`.

| Parameter | Type | Notes |
|---|---|---|
| `cursor` | `str \| None` | Start after this position: a page's `next_cursor` or a streamed event's `cursor`. Listed events carry no per-event cursor. |
| `after` | `int \| None` | Deprecated overload. Selects the engine-only lane, which numbers events differently from the unified `seq` and omits your inputs, so never pass `event.seq` here. Type checkers flag calls that pass it. |
| `types` | `Sequence[str] \| None` | Server-side filter, joined with commas onto `?types=`. Only vocabulary members are accepted. |
| `limit` | `int \| None` | Server default 100, maximum 500. |
| `page_size` | `int` | `list_all_events()` only. The per-request `limit`, clamped to 1–500. |

Every entry passes through `normalize_event()`, so REST and SSE give you the same
[`SessionEvent`](#sessionevent).

::: warning One page per call
`list_events()` returns exactly one page and drops the pagination fields.
`list_events_page()` is the same call returning `(events, has_more, next_cursor)`:

```python
events, has_more, next_cursor = await client.list_events_page(agent_id, session_id, limit=100)
```

Pass `next_cursor` back as `cursor` to page by hand; otherwise use `list_all_events()`.
:::

`list_all_events()` follows `next_cursor` until `has_more` is false, and falls back to walking
the `after` lane on servers without cursor pagination:

```python
replies = await client.list_all_events(agent_id, session_id, types=["agent.assistant"])
later = await client.list_all_events(agent_id, session_id, cursor=saved_cursor)
```

Events come back in ascending `seq`. A walk that starts from `cursor` never falls back to
`after`. Passing both `cursor` and `after` raises `TypeError` before any request. The walk stops
without re-appending when a cursor fails to advance, and on the fallback walk events at or below
the position are dropped, so a boundary event is not returned twice.

---

### `stream_events()` {#stream-events}

```python
async def stream_events(
    agent_id: str, session_id: str, *, cursor: str | None = None
) -> AsyncIterator[SessionEvent]
```

A deprecated overload takes `after: int | None` instead of `cursor`. It resumes the engine-only
lane, whose numbering differs from the unified `seq`.

An async generator of [`SessionEvent`](#sessionevent); consume it with `async for`. For an
existing Session, pass its saved cursor. Only omit it for a new Session's first turn. Without
it, old answers and `run.finished` replay from the beginning. See the
[two-turn example](../build/events.md#streaming-a-turn) and
[missing-cursor recovery limits](../build/events.md#existing-session-without-a-saved-cursor).

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

Four behaviors worth knowing:

- **The stream is Session-scoped and does not close when a turn ends.** Break out yourself with
  `is_run_finished()`. `contextlib.aclosing` closes the HTTP stream as soon as you leave the
  loop.
- **The server closes the stream on idle.** Reconnect with
  `stream_events(agent_id, session_id, cursor=last_cursor)`, tracking `last_cursor` from each
  event's `cursor`. Resume is server-side, so nothing between the two windows is lost. The SDK
  does not reconnect for you; see the
  [reconnect loop](../build/events.md#a-reconnect-loop-that-survives-a-dropped-connection).
- **`chat.delta` preview frames are skipped.** They arrive as SSE `event_delta` frames on a
  separate non-durable lane, and the SDK drops them, along with any frame whose data is not a
  JSON object. You only see durable events.
- **Boundary events are de-duplicated.** The generator discards an event whose non-negative
  `seq` is not greater than the last one it yielded, so a replayed boundary event on reconnect
  does not reach you twice. An event with `seq == -1` carries no usable sequence and is passed
  through.

A non-2xx stream-open response raises the same `ZooworkError` as other calls. A dropped
connection or read timeout raises an `httpx` exception instead.

---

### `list_custom_tool_calls()` and `resolve_custom_tool_call()` {#custom-tool-calls}

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

Declare application-executed tools in `resource["custom_tools"]` as
[`CustomToolDeclaration`](#custom-tool-types) mappings. When
[`custom_tool_use(event)`](#event-helpers) returns a requested call, run it in your application
and return the result:

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

`content` holds 1–16 text, JSON, or base64 image blocks. `is_error` and `resolved_by` are sent
only when not `None`. A `202` response with `signaled: True` means delivery was accepted; the
row can remain pending until the run consumes it. `signaled: False` means the call was already
completed, timed out, or cancelled.

`list_custom_tool_calls(agent_id, status="pending")` recovers pending work after a restart. Only
`"pending"` is accepted as a status filter. While a run waits, `run_status` is
`awaiting_approval`; check `pending_custom_tool_calls` to distinguish it from a normal approval.
You can instead post a `user.custom_tool_result` event to the owning Session. See
[Tools](../build/tools.md#application-executed-custom-tools).

---

### `get_custom_tool_call()` and `list_custom_tool_call_page()` {#custom-tool-call-pages}

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

`get_custom_tool_call()` reads one call, terminal as well as pending.
`list_custom_tool_call_page()` returns one cursor page as the API sends it, keeping
`next_cursor` and `has_more`; pass `next_cursor` back as `cursor` with the same filters.

---

### `list_approvals()` and `resolve_approval()` {#approvals}

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

`list_approvals()` lists tool calls waiting for a decision and returns the response's
`approvals` list. `status` may only be omitted or `"pending"`, so resolved records are not
returned. This REST resource is separate from the `user.tool_confirmation` event path.

`resolve_approval()` sends `{"decision": decision}`, plus `resolvedBy` when `resolved_by` is set.
Send one of the record's `allowed_decisions` when present.

```python
approvals = await client.list_approvals(agent_id, status="pending")
for approval in approvals:
    allowed = approval.get("allowed_decisions")
    print(approval["approval_id"], approval.get("arguments_preview"), allowed)
```

A `202` receipt with `signaled: True` can still be `pending`; keep reading events for execution
progress. Approval records can carry `requested_at`, `arguments_preview`, `allowed_decisions`,
`timeout_at`, `resolved_by`, `resolved_at`, `signaled`, and `decision`. See
[Permission policies](../build/permissions.md).

---

### `get_approval()` and `list_approval_page()` {#approval-pages}

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

`get_approval()` reads one approval, terminal as well as pending. `list_approval_page()` returns
one cursor page as the API sends it, keeping `next_cursor` and `has_more`.

---

### Artifact methods {#artifacts}

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

Artifacts are published by the Agent's own `artifact_publish` tool; these methods manage what it
produced. The first Artifact call for an Agent costs one extra `get_agent()` to read its
ownership, cached in the client afterwards. An Agent whose projection carries no ownership fails
with `ZooworkError` status `500` and type `ownership_unavailable`. That error is created locally,
so no server response explains it.

| Method | Notes |
|---|---|
| `list_artifacts` | Returns `{"artifacts": [...], "page", "has_more"}`; `artifacts` is always a list. `limit` defaults to 50 and is capped at 100. |
| `get_artifact` | One row. `status` is `pending`, `ready`, `failed`, or `deleted`; only a `ready` row has a resolvable `url`. Foreign and unknown IDs are both 404. |
| `download_artifact` | Returns `artifact_id` and `url` for a `ready` Artifact. Treat the URL as a bearer capability. A row that never finalized returns `409 artifact_not_ready`. |
| `delete_artifact` | Deletes one Artifact and returns the row as the engine leaves it. |

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

Previously issued object-store URLs are not guaranteed to be revoked immediately on deletion.
See [Files and artifacts](../build/files.md).

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

Creates a schedule. The `201` receipt carries the public `schedule_id` and the deprecated
compatibility field `schedule_name`, not the full definition. Schedules outlive `stop_agent()`
and `delete_agent()`; delete them yourself.

`schedule` requires three keys. `schedule_id` is yours to choose, matching
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; re-creating the same ID with a *different* definition is a
`409`. `schedule` is the cadence. `payload` is the work; the example uses `kind: "agentTurn"`.
The management parser also accepts `systemEvent` and `command`, which have different execution
and caller restrictions; follow [Schedules](../build/schedules.md).

```python
await client.create_schedule(agent_id, {
    "schedule_id": "daily-digest",
    "schedule": {"kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai"},
    "payload": {"kind": "agentTurn", "message": "Summarise yesterday.", "thinking": "low"},
    "sessionTarget": "isolated",
})
```

The optional keys are `sessionTarget`, `delivery`, `enabled`, `deleteAfterRun`, and `jobKind`.
Omit `sessionTarget` or pass `"isolated"` for a fresh Session per fire, or `session:<id>` to
target an existing Session of this Agent. It is **immutable** after create. An interval cadence
is `{"kind": "every", "everyMs": 60000, "anchorMs": 0}`.

An `agentTurn` payload may set `thinking` (a [`ThinkingLevel`](#thinkinglevel)) to override the
Agent's level for that job's turns; it has no effect on other payload kinds. See
[Schedule overrides](../build/schedules.md#override-the-thinking-level).

---

### `update_schedule()` {#update-schedule}

```python
async def update_schedule(
    agent_id: str, schedule_id: str, update: Mapping[str, Any]
) -> JsonObject
```

Replaces the definition. To change the cadence send `schedule`, never the `scheduleSpec` a read
returns. Before sending, the SDK removes six keys: `sessionTarget`, `scheduleSpec`, `execution`,
`originMetadata`, `contextSnapshot`, and `creatorPrincipalRef`. The first two are read shapes;
the other four are server-derived and would otherwise return `400`. A read-modify-write round
trip from `get_schedule()` therefore works.

`payload.thinking` (`agentTurn` only) has three states. Omit it, or send an empty or
whitespace-only string, to keep the stored value; send `None` to clear it so the job follows the
Agent's level again; send a level to set it. The service trims and lowercases a new value and
normalizes the legacy spellings `xhigh`, `minimal`, and `adaptive` to `max`, `low`, and
`medium`.

```python
await client.update_schedule(agent_id, "daily-digest", {
    "payload": {"kind": "agentTurn", "message": "Summarise yesterday.", "thinking": None},
})
```

Like `delete_schedule()`, it carries no cross-timeout idempotency guarantee: after a timeout,
reconcile by listing rather than sending the write again.

---

### Other schedule methods and `wake()` {#schedules}

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

| Method | Notes |
|---|---|
| `list_schedules` | The response's `schedules` list. Rows mix the scheduler's own describe shape with a camelCase projection; read defensively. |
| `get_schedule` | One schedule in the camelCase read vocabulary. Use the public `schedule_id`; the cadence is in `scheduleSpec.cronExpressions[0]` and the target in `execution.kind`. Older projections can include `name` and a fully qualified `scheduleId`; treat them as compatibility fields. Do not send a read projection back as create input. |
| `delete_schedule` | Deletes a schedule. Reconcile by listing rather than retrying blindly. |
| `trigger_schedule` | Requests one extra firing; returns the receipt with `triggered` coerced to `bool`. A disabled schedule is skipped even when the receipt says `triggered: True`, and the receipt is not a run result. |
| `list_schedule_runs` | The response's `runs` list, newest first. `limit` defaults to 20 and is capped at 100. Rows mix two shapes; switch on `source`. `session_id` can be absent. |
| `wake` | `mode` `"next-heartbeat"` (the default) only writes the pending row; `"now"` also starts the heartbeat schedule and is `409` when no heartbeat is enabled. `deliverToUser: False` keeps the reminder internal. Returns `mode`, `queued`, and `triggered`; `triggered` is meaningful only in `now` mode. |

---

### `exec()` {#exec}

```python
async def exec(agent_id: str, args: Sequence[str]) -> JsonObject
```

Runs `args` as an argv list, not a shell string, in the Agent's sandbox with cwd fixed to
`/workspace`. **A non-zero exit is still HTTP 200**: the call returns normally, so check
`exit_code`.

```python
result = await client.exec(agent_id, ["ls", "-la", "/workspace"])
if result["exit_code"] != 0:
    raise RuntimeError(result.get("stderr"))
print(result["stdout"])
```

It requires an agent-scope sandbox and a rendered configuration: a session-scope Agent is
`409 exec_requires_agent_scope`, and an unrendered one is `409 exec_config_not_ready`. The command
times out after 300 seconds, and `stdout` and `stderr` are each truncated at 200,000 characters.
Neither limit is reported as an error.

---

### `upload_file()` {#upload-file}

```python
async def upload_file(agent_id: str, path: str, content: bytes | str) -> JsonObject
```

Copies a file into the Agent's sandbox so the Agent can read it by path. `path` is absolute, or
relative to `/workspace`; parent directories are created. A `str` is written as UTF-8 text.

```python
from pathlib import Path

file = await client.upload_file(agent_id, "input/report.pdf", Path("report.pdf").read_bytes())
print(file["path"], file["size"], file["sha256"])  # /workspace/input/report.pdf ...
```

The content travels through `exec()` in base64 chunks of about 72 KB, lands in a temporary file
beside the target, is checked against its SHA-256 inside the sandbox, and only then moves into
place, so a failed upload leaves nothing at `path`. It suits files up to a few megabytes and has
`exec()`'s requirements. It returns `{"path", "size", "sha256"}`. It raises `ValueError` for an
empty `path`, `ZooworkError` when a call fails, and `RuntimeError` when a sandbox command exits
non-zero or the checksum does not match. See
[Files](../build/files.md#send-a-file-to-the-agent).

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

Each argument is sent as the query parameter of the same name, and `None` values are omitted.
Usage stays within the current key scope.

```python
usage = await client.get_usage(range="7d", group_by="session", view="both", per_page=50)
```

Keep filters and the returned `snapshot` and `cursor` together when continuing a query. Invalid
parameters can return `400 usage.invalid_query` or a `422` with no business error type; correct
the parameters rather than retrying unchanged. See [Usage](./usage.md#query-parameters) for
accepted values and defaults.

---

### `get_balance()` {#get-balance}

```python
async def get_balance() -> JsonObject
```

Reads the Organization balance shared by every Project. Requires a Platform key; any Platform
key in the Organization can read it.

```python
balance = await client.get_balance()
print(balance["available_amount"], balance["currency"])  # "11.34" "usd"
```

`available_amount` is a USD decimal string with two places, not credits: settled top-ups minus
the consumption reported in the current billing period, as on the Platform Billing page. It does
not go below `"0.00"`. See [Usage](./usage.md#read-the-organization-balance).

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

Reads the output of one run in a Session and returns the response unchanged. Pass a returned
cursor back as `cursor` to continue.

---

### Webhook management methods {#webhook-management-methods}

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

Create, secret rotation, test, and redelivery require a stable `idempotency_key`. Responses keep
API field names; list responses keep `next_cursor` and `has_more`.

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

| Method | Notes |
|---|---|
| `list_agent_webhooks` | Endpoint rows are in `webhooks`. |
| `update_agent_webhook` / `delete_agent_webhook` | Sent as `POST .../update` and `POST .../delete`. |
| `rotate_agent_webhook_secret` | `input` is `{"revoke_previous_after": 86400}` to keep the previous secret for 24 hours, or `0` to revoke it immediately. |
| `test_agent_webhook` | A `202` receipt acknowledges queuing, not delivery or business processing. |
| `get_agent_webhook_event` | Reads one event within the authorized scope; it is not nested under an endpoint. |
| `list_agent_webhook_deliveries` | Filters deliveries; query them for the outcome of a test or redelivery. |
| `redeliver_agent_webhook_delivery` / `redeliver_agent_webhook_deliveries` | Queue another delivery of existing events; they do not rerun the Agent. |

See [Webhooks](../build/webhooks.md) for the full receiver and management flow.

---

### Environment methods {#environment-methods}

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

With a Platform key every one of these returns `404 service_api.not_found`. The `ownership`
argument of `create_environment()` does not make Environment management available. Use the
managed default sandbox; see [Environments](../build/environments.md).

## Types {#types}

Request and response records are plain `dict` values with the API's field spelling. The API is
Developer Preview and may add fields within a version: ignore what you do not recognize rather
than failing on it. The package exports the types below for type hints and for the values the
SDK builds itself.

### `JsonObject` {#jsonobject}

```python
JsonObject = dict[str, Any]
```

The return type of most client methods.

### `ThinkingLevel` {#thinkinglevel}

```python
ThinkingLevel = Literal["off", "low", "medium", "high", "max"]
```

The thinking level, in ascending order. A model resolves a level it does not list in its
`thinking.levels` to the nearest listed one, with ties going up, so `"off"` on a model that
cannot stop thinking becomes its lowest level. Request keys are `model.thinking` on an Agent and
`payload.thinking` on an `agentTurn` schedule; `None` clears either.

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

Returned by `list_agents()`. `data` holds only this page. `page`, `page_size`, and `total` come
from the API; the SDK derives `next_page`, which is `None` on the last page.
`get_next_page()` keeps the label filters and raises `RuntimeError` when there is no next page.
`iter_pages()` yields this page and each later one. `async for agent in page` yields every Agent
from this page onward.

### `SessionListPage` {#sessionlistpage}

```python
@dataclass(frozen=True, slots=True)
class SessionListPage:
    sessions: list[JsonObject]
    next_cursor: str | None
    includes_deleted: bool = False
```

Returned by `list_session_page()`. `next_cursor` is `None` at the end. `includes_deleted` is
`True` when the page was requested with `include_deleted=True`.

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

| Field | Notes |
|---|---|
| `seq` | Durable sequence that orders events; it is not a resume position. The deprecated `after` lane numbers events differently, so never pass `seq` as `after`. `-1` means no usable sequence was supplied. |
| `cursor` | Opaque resume token, set only on events from `stream_events()`. Pass it unchanged as `cursor=`; do not derive it from `seq`. Resume a listing from the page's `next_cursor`. |
| `event_type` | One of `SESSION_EVENT_TYPES`, or an unknown string that passed through. `""` if the wire carried no type. |
| `payload` | The event body. Its shape varies by type; use the [event helpers](#event-helpers). |
| `run_id` | The run this event belongs to. |
| `turn` | Turn number within the Session. |
| `created_at` | ISO timestamp. |
| `id` | Event ID, when present. |
| `processed_at` | Processing timestamp, when the wire carries `processed_at`. |

The fields are snake_case whichever wire shape the event arrived in; `normalize_event()` reads
both the unified snake_case and the legacy camelCase spelling. See [Events](../build/events.md).

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

The decoded form of an `agent.tool` event, returned by `tool_call()`. `phase` is `start`, `end`,
or `blocked`. One tool call produces a sequence of events sharing a `tool_call_id`: `start`
carries `args`, `end` carries `is_error` and `result_preview`, and `blocked` is a terminal block
before execution with no later `end`. Reasons include policy denial, approval
denial/timeout/cancellation, or interruption; read `event.payload["deniedReason"]` when present.
Approval waiting uses `agent.approval` with phase `requested`, not `blocked`. Pair events by
`tool_call_id`; they are **not adjacent** when calls run concurrently. A tool error does not
necessarily fail the run, so check the final run status. See [Events](../build/events.md).

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

The decoded form of an `agent.custom_tool_use` event, returned by `custom_tool_use()`. `phase`
is `requested` or `resolved`. `call_id` is the ID to pass to `resolve_custom_tool_call()`.
`outcome` is `completed`, `timeout`, or `cancelled` on a resolved call.

### Custom tool types {#custom-tool-types}

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

`CustomToolDeclaration` is one entry of `resource["custom_tools"]`. At most 32 declarations are
accepted. `input_schema` must be a JSON Schema object whose top level has `type: object`.
`timeoutMs` defaults to 600,000 ms and is at most 86,400,000 ms.

`CustomToolCallRecord` is a pending call or a resolution receipt.

```python
CustomToolResultContent = (
    CustomToolTextContent
    | CustomToolJsonContent
    | CustomToolImageContent
    | CustomToolInlineImageContent
)
```

| Type | Fields |
|---|---|
| `CustomToolTextContent` | `type: Literal["text"]`, `text: str` |
| `CustomToolJsonContent` | `type: Literal["json"]`, `value: Any` |
| `CustomToolImageContent` | `type: Literal["image"]`, `source: CustomToolImageSource` |
| `CustomToolImageSource` | `type: Literal["base64"]`, `media_type`, `data: str` (base64) |
| `CustomToolInlineImageContent` | `type: Literal["image"]`, `data: str` (base64), `mime_type` |

`media_type` and `mime_type` are `"image/png"`, `"image/jpeg"`, `"image/gif"`, or
`"image/webp"`. One result holds 1–16 blocks.

### `ZooworkClient` {#zooworkclient}

`ZooworkClient` is exported as a class, so you can annotate your own helpers with it:

```python
from zoowork import ZooworkClient

async def reply(client: ZooworkClient, agent_id: str, text: str) -> None: ...
```

## Errors {#errors}

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

Raised by every client method on a non-2xx response.

| Attribute | Type | Notes |
|---|---|---|
| `status` | `int` | The HTTP status. Always set. |
| `type` | `str \| None` | The machine-readable code: the body's `error.type`, else a top-level `code`. **Branch on it when present**, and keep a status fallback. |
| `content_type` | `str \| None` | The response `Content-Type`. |
| `body_snippet` | `str \| None` | The first 600 characters of the response body. |
| `cf_ray` | `str \| None` | The `cf-ray` response header. |
| `request_id` | `str \| None` | The body's `error.request_id` or `request_id`, when present. The public API does not guarantee one on every response. |
| `retryable` | `bool` | `True` for status 408, 429, 502, 503, and 504 unless the SDK set it explicitly. |

`str(error)` is the message: the body's `error.message`, `message`, or `detail`, or
`HTTP <status>` with the content type and `cf-ray` when the body carried none. Message text is
for people and logs; never parse it.

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

**Retryable errors.** `retryable` reflects only the status. It says the server may succeed
later, not that repeating the operation is safe. Retry reads with backoff; for writes, follow the
per-operation rules in [What is safe to retry](./errors.md#what-is-safe-to-retry):

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

**Errors the SDK creates locally.** Some `ZooworkError` values never came from the server:

| Source | `status` / `type` | `retryable` |
|---|---|---|
| `wait_until_running()`, `wait_for_channel_setup()` time out | `408` / `"timeout"` | `False` |
| An Artifact method cannot read the Agent's ownership | `500` / `"ownership_unavailable"` | `False` |
| A successful response is not JSON | the response status / `None` | by status |
| Webhook verification fails | `400` / the [`WebhookSignatureError`](#webhook-helpers) code | `False` |

**Other exceptions.** Transport failures, such as a refused connection or a timeout, raise
`httpx` exceptions (`httpx.TransportError` and its subclasses, including
`httpx.TimeoutException`), not `ZooworkError`. A response whose shape the SDK cannot use raises
`TypeError` or `ValueError`. Configuration errors raise `ValueError` at construction. The SDK does
not retry anything for you. See [Errors and retries](./errors.md) for the error types worth
branching on.

## Event helpers {#event-helpers}

Pure functions over a `SessionEvent`. None of them touch the network.

| Helper | Signature | Returns |
|---|---|---|
| `is_run_finished` | `(event: SessionEvent) -> bool` | `True` for `run.finished`. |
| `run_outcome` | `(event: SessionEvent) -> str \| None` | `"succeeded"`, `"failed"`, or `"aborted"` for `run.finished`; `None` otherwise. |
| `assistant_text` | `(event: SessionEvent) -> str` | Assistant text for `agent.assistant`; `""` for every other type. |
| `thinking_text` | `(event: SessionEvent) -> str` | Reasoning text for `agent.thinking`; `""` for every other type. |
| `tool_call` | `(event: SessionEvent) -> ToolCall \| None` | Decoded tool activity for `agent.tool`; `None` otherwise. |
| `custom_tool_use` | `(event: SessionEvent) -> CustomToolUse \| None` | Decoded application-executed tool activity for `agent.custom_tool_use`; `None` otherwise. |
| `message_text` | `(message: object) -> str` | Text of one `{"role", "content"}` message. |
| `normalize_event` | `(raw: object, sse_id: str \| None = None) -> SessionEvent` | Reads either wire shape into a `SessionEvent`. |

Because the text helpers return `""` for non-matching types, you can accumulate
unconditionally. See [Events](../build/events.md).

### `message_text(message)` {#message-text}

Assistant text lives at `payload["message"]["content"]`, and `content` is normally a list of
blocks where **only `{"type": "text", "text": ...}` blocks carry text**. `message_text()`
concatenates those. A plain string is returned as is, which is how write-side `user.message`
content comes back. Anything else returns `""`. That makes it the right tool for transcript rows
as well as events:

```python
from zoowork import message_text

s = await client.get_session(agent_id, session_id, history=True)
for row in s.get("history", []):
    if row["entry_type"] == "message":
        print(message_text(row["entry"]["message"]))
```

`assistant_text(event)` is `message_text(event.payload.get("message"))` guarded by the event
type.

### `normalize_event(raw, sse_id=None)` {#normalize-event}

```python
def normalize_event(raw: object, sse_id: str | None = None) -> SessionEvent
```

Accepts the unified snake_case and the legacy camelCase event shapes and does not raise on
unexpected input: a value that is not a mapping becomes an event with an empty `event_type` and
`payload`.
`sse_id` is the SSE `id:` line. It is kept as the event's `cursor` unless it is a bare integer.
When the body carries no `seq`, a bare-integer ID, or the number in a `pse1:<seq>` cursor, is
used as `seq`. The SDK calls it for you in the list methods and `stream_events()`; call it
directly only when you parse the wire yourself. Unknown event types pass through unchanged.

### `SESSION_EVENT_TYPES` and `PUBLIC_INPUT_EVENT_TYPES` {#event-type-constants}

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

`SESSION_EVENT_TYPES` is the read-side vocabulary: 20 types. `SessionEvent.event_type` is a
plain `str`, so an unknown type from a newer server still reaches you. `PUBLIC_INPUT_EVENT_TYPES`
lists the five types `post_events()` accepts.

```python
from zoowork import SESSION_EVENT_TYPES

if event.event_type not in SESSION_EVENT_TYPES:
    print("unknown event type", event.event_type)
```

`run.finished` is the end of a turn, with `payload["status"]` of `succeeded`, `failed`, or
`aborted`. `chat.delta` never reaches you from `stream_events()`; those frames are skipped.

## `parse_sse()` {#parse-sse}

```python
async def parse_sse(lines: AsyncIterable[str]) -> AsyncIterator[SSEMessage]

@dataclass(frozen=True, slots=True)
class SSEMessage:
    event: str
    data: Any
    id: str | None = None
```

The SSE line parser, exported for advanced use. `stream_events()` already uses it, and you do
not need it for normal work. It takes decoded text lines, such as `httpx`'s
`response.aiter_lines()`, and yields one `SSEMessage` per frame. `event` is the SSE event name,
defaulting to `message`. `id` is the `id:` line: an opaque resume cursor on the unified stream,
not `seq`. `data` is the JSON-parsed body, or the raw string when it is not JSON. Comment lines
are ignored.

Use it when you call the stream endpoint yourself, for instance to see the `event_delta` preview
frames that `stream_events()` skips:

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

Dropping the `id:` line would freeze your resume cursor, which is why the parser keeps it.

## Webhook helpers {#webhook-helpers}

Receiving helpers verify and parse incoming deliveries. They are synchronous, use only the
standard library, and do not register endpoints or send events; use the
[webhook management methods](#webhook-management-methods) and
[Webhooks](../build/webhooks.md) for that.

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

| Parameter | Notes |
|---|---|
| `headers` | A mapping, looked up case-insensitively, or any object with a `get(name)` method, such as a framework's case-insensitive headers. A multi-value entry is accepted only when it holds exactly one value. |
| `raw_body` | The body exactly as received. Do not parse or reserialize JSON before verification. |
| `secret` | One `whsec_` secret, or a sequence of every active secret during rotation. Omitted, it reads `ZOOWORK_WEBHOOK_SECRET`, which may hold several secrets separated by whitespace or commas. |
| `now` | Current time in Unix **seconds**, for tests. Defaults to the system clock. |
| `tolerance_seconds` | Allowed distance between `now` and the signed timestamp. Default 300. |
| `max_body_bytes` | Body ceiling, checked before the headers. Default 16 KiB. |

`verify_webhook_signature()` returns `(event_id, timestamp)`, the verified `webhook-id` and the
signed Unix-seconds timestamp. Checks run cheapest first and fail closed: secrets decode, body
size, the three headers and their shape, the timestamp window, then a constant-time comparison
of every `v1` signature against each secret. Signature entries of other versions are skipped.

`unwrap_webhook()` verifies first, so unverified bytes never reach the JSON parser, then returns
a [`WebhookEvent`](#webhookevent). It validates only the envelope frame, strictly: `object` must
be `"event"`; `id`, `type`, and `created_at` must be strings; `schema_version` must be an integer
value (`1` or `1.0`, never `1.5`); and `data` must be an object. Unknown event types and `data`
fields are preserved; arbitrary unknown top-level fields are not. Validate event-specific data
yourself. It does not check that the body `id` matches `webhook-id`.

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

Deduplicate on the verified delivery ID and do business processing after acknowledging. See
[Verify before acknowledging](../build/webhooks.md#verify-before-acknowledging).

### `WebhookSignatureError` {#webhooksignatureerror}

```python
class WebhookSignatureError(ZooworkError):
    code: WebhookSignatureErrorCode

WebhookSignatureErrorCode = Literal[
    "invalid_secret", "body_too_large", "missing_header", "invalid_header",
    "timestamp_out_of_window", "signature_mismatch", "invalid_payload",
]
```

Every verification failure raises it. It is a `ZooworkError` with `status` 400, `type` equal to
`code`, and `retryable` `False`, so one `except ZooworkError` clause covers the whole SDK. Match
`code`, never the message. Messages name the failing check and at most a header name, never a
secret, signature, or body bytes, so they are safe to log.

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

One verified envelope with the API's field names. `type` keeps the server's string even when it
is not in `WEBHOOK_EVENT_TYPES`, because event types are added on the server. See
[Handle an event](../build/webhooks.md#event-envelope).

### Other webhook helpers and constants {#other-webhook-helpers-and-constants}

| Name | Value or signature | Notes |
|---|---|---|
| `decode_webhook_secret` | `(secret: str) -> bytes` | Returns the 32-byte HMAC key behind a `whsec_` secret; raises `invalid_secret` otherwise. |
| `is_known_webhook_event_type` | `(value: str) -> bool` | Whether this SDK release knows the event type. It is parser vocabulary, not a deployment availability guarantee. |
| `session_id`, `run_id`, `agent_id`, `schedule_id` | `(event: WebhookEvent) -> str \| None` | Read the matching string field from `event.data`, or `None`. `schedule_id` is the public ID used by the schedule methods; a heartbeat fire reads `"heartbeat"`. |
| `WEBHOOK_EVENT_TYPES` | tuple of 21 strings | `run.started`, `run.finished`, `run.yielded`, `approval.requested`, `approval.resolved`, `custom_tool.requested`, `custom_tool.resolved`, `outcome.evaluated`, `session.created`, `session.archived`, `session.deleted`, `schedule.dispatched`, `schedule.dispatch_failed`, `schedule.skipped`, `schedule.finished`, `webhook.test`, `schedule.created`, `schedule.updated`, `schedule.paused`, `schedule.resumed`, `schedule.deleted`. |
| `WebhookEventType` | `Literal[...]` | The same 21 names as a type. |
| `WEBHOOK_ID_HEADER` | `"webhook-id"` | |
| `WEBHOOK_TIMESTAMP_HEADER` | `"webhook-timestamp"` | |
| `WEBHOOK_SIGNATURE_HEADER` | `"webhook-signature"` | |
| `WEBHOOK_SIGNATURE_VERSION` | `"v1"` | |
| `WEBHOOK_SECRET_PREFIX` | `"whsec_"` | |
| `WEBHOOK_SECRET_BYTES` | `32` | Decoded secret length. |
| `WEBHOOK_SECRET_ENV_VAR` | `"ZOOWORK_WEBHOOK_SECRET"` | |
| `WEBHOOK_TOLERANCE_SECONDS` | `300` | |
| `WEBHOOK_DEFAULT_MAX_BODY_BYTES` | `16384` | |
| `WebhookHeaders` | type alias | See the parameter table above. |

`session_id`, `run_id`, `agent_id`, and `schedule_id` share their names with common variables.
Import the module to keep them apart, for example `import zoowork` and
`zoowork.run_id(event)`.

The wire format is plain [Standard Webhooks](https://www.standardwebhooks.com/), and these
helpers are byte-compatible with the `standardwebhooks` package.

## Complete export list {#complete-export-list}

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

These are the names in `zoowork.__all__`. `DEFAULT_BASE_URL` is the public gateway base that
`ZOOWORK_BASE_URL` and the `base_url` argument override; it is exported so you can compare
against it or build a URL by hand. `__version__` is the installed package version.

Session metadata is set when you call `create_session()`;
`PATCH /agents/{id}/sessions/{sid}` returns `405`.

## Next {#next}

- [Errors and retries](./errors.md) - the error types worth branching on and safe retry rules.
- [Agents](../build/agents.md) - create, start, update, and the two response shapes.
- [Sessions](../build/sessions.md) and [Events](../build/events.md) - drive a turn, resume a
  stream, and read the transcript.
- [Tools](../build/tools.md) - application-executed calls and tool results.
- [Files and artifacts](../build/files.md) - input file upload and published output retrieval.
- [Schedules](../build/schedules.md) - recurring tasks and supported Outcome evaluation.
- [Webhooks](../build/webhooks.md) - register a receiver and verify deliveries.
- [TypeScript SDK reference](./typescript-sdk.md) - the same API from TypeScript.
