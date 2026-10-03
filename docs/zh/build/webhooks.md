---
title: Webhooks
description: 注册 webhook receiver，验证签名事件，检查并重试投递。
source: /en/build/webhooks
source_hash: a1a6a6093ed67c10220a05db938f27941307d5c3472fe93240a374c399766a35
---

# 订阅 Webhooks

后端需要在不保持 SSE 连接的情况下，得知 run 已结束、工具需要处理或 schedule 有变更时，可以使用 webhook。需要完整、有顺序的对话日志时，使用[事件](./events.md)。

API key 所访问的服务需要启用 Webhooks。接口不可用时，请求可能返回 `404`。

两个 SDK 都提供 Agent webhook 管理方法，HTTP 示例展示相同契约。复用[认证](../get-started/authentication.md)中的后端凭据和 HTTP 配置，并确保有该 Agent 的访问权限。生成 run 事件前先 start Agent。

## 选择事件类型 {#choose-event-types}

在需要的事件发生前订阅。Webhook 可能重复，也可能乱序送达，不能替代持久的 Session event log。

| 事件类型 | 观察内容 |
|---|---|
| `session.created`、`session.archived`、`session.deleted` | Session 生命周期。 |
| `run.started`、`run.finished`、`run.yielded` | Run 生命周期。Yielded run 仍可能有后续任务工作。 |
| `approval.requested`、`approval.resolved` | 工具权限决策。 |
| `custom_tool.requested`、`custom_tool.resolved` | 应用执行的 custom tool 调用。 |
| `outcome.evaluated` | [定时结果](./schedules.md#evaluate-a-scheduled-result)的评价。 |
| `schedule.created`、`schedule.updated`、`schedule.paused`、`schedule.resumed`、`schedule.deleted` | Schedule 配置生命周期。 |
| `schedule.dispatched`、`schedule.dispatch_failed`、`schedule.skipped`、`schedule.finished` | 定时执行进度。派发与 Agent 工作完成是不同阶段。 |

`webhook.test` 只用于诊断；test 操作对一个 receiver 产生该事件，不能放进 `event_types`。Agent、Environment、vault、memory-store 生命周期通知不属于这份词表。

## 注册 Receiver {#register-a-receiver}

先在应用中创建 HTTPS endpoint。URL 必须使用可公开解析的 hostname，端口为 443。直接 IP、URL 中的凭据、fragment 和私有地址会被拒绝。把 `WEBHOOK_RECEIVER_URL` 替换为真实 receiver URL。

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: run-finished-receiver-v1' \
  -d "$(jq -n --arg url "$WEBHOOK_RECEIVER_URL" \
    '{url:$url,event_types:["run.finished"]}')"
```

| 创建字段 | 含义 |
|---|---|
| `url` | 必填，HTTPS receiver URL。 |
| `event_types` | 必填，从上面词表选择的非空数组。不接受 wildcard。 |
| `description` | 可选说明，最多 500 个字符。 |
| `session_scope` | 默认 `api`；`all` 包含其他来源的 session。 |
| `enabled` | 默认 true。设为 false，可以先注册而不接收业务事件。 |

响应带有 `endpoint.id`、`signing_secret`、`signing_secret_version`、`signing_secret_available`。把 `whsec_` signing secret 保存在服务端 secret storage；普通 GET 不返回明文 secret。Create response 丢失时复用同一个 Idempotency-Key。重放时检查 `signing_secret_available`；后来已撤销的 secret 可能不再返回。

每个 Agent scope 最多 10 个未删除 endpoint。Disabled endpoint 也占一个名额。

## 先验签，再确认 {#verify-before-acknowledging}

投递使用 [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks)。SDK 对原始 request bytes 验签，再解析事件。必须在 JSON middleware 处理前读取 body；解析后重新序列化会改变签名覆盖的字节。

使用 TypeScript SDK **0.9.0 或以上**，或 Python SDK **0.4.0 或以上**。这些是接收 helper；注册和管理 webhook 仍使用本页 HTTP 路径。

将 `ZOOWORK_WEBHOOK_SECRET` 设为注册时返回的 `whsec_` secret。下面的 handler 从 HTTP framework 接收 raw bytes 和 headers；Python 函数返回应由 framework adapter 发送的 HTTP status。

::: code-group

```ts [TypeScript]
import { unwrapWebhook, ZooworkWebhookError, type WebhookEvent } from '@zoowork-ai/sdk'

export async function receiveWebhook(
  request: Request,
  acceptOnce: (event: WebhookEvent) => Promise<void>,
): Promise<Response> {
  const rawBody = new Uint8Array(await request.arrayBuffer())
  let event: WebhookEvent
  try {
    event = await unwrapWebhook({ headers: request.headers, rawBody })
    if (event.id !== request.headers.get('webhook-id')) return new Response(null, { status: 400 })
  } catch (error) {
    if (error instanceof ZooworkWebhookError) return new Response(null, { status: 400 })
    throw error
  }

  try {
    await acceptOnce(event)
    return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 503 })
  }
}
```

```python [Python]
from collections.abc import Callable, Mapping
from zoowork import WebhookEvent, WebhookSignatureError, unwrap_webhook


def receive_webhook(
    raw_body: bytes,
    headers: Mapping[str, str],
    accept_once: Callable[[WebhookEvent], None],
) -> int:
    try:
        event = unwrap_webhook(headers=headers, raw_body=raw_body)
        delivery_id = next((v for k, v in headers.items() if k.lower() == "webhook-id"), None)
        if event.id != delivery_id:
            return 400
    except WebhookSignatureError:
        return 400

    try:
        accept_once(event)
    except Exception:
        return 503
    return 204
```

:::

handler 在接收工作前显式比较 `event.id` 与签名覆盖的 `webhook-id`。这是应用完成的校验，unwrap helper 不会替你做这个比较。

在应用中实现 `acceptOnce` / `accept_once`：原子地记录唯一 `event.id` 并入队；该 ID 已接收时直接成功返回。持久接收成功后再确认投递，耗时工作在请求之外处理。

默认 body 上限是 **16 KiB**；HTTP server 也需要配置这个 request limit。时间容差是相对于 `webhook-timestamp` 的 **±300 秒**，不是相对于 payload `created_at`。保持 receiver 时钟同步。轮换期间，`ZOOWORK_WEBHOOK_SECRET` 可用空格或逗号分隔多个 secret。显式传入的 `secret` 字符串只表示一个 secret；多个 secret 使用 array 或 sequence。

`unwrapWebhook` 是 async，`unwrap_webhook` 是同步函数。本地测试覆盖时钟时，TypeScript 的 `now` 是毫秒，Python 的 `now` 是 Unix 秒。可选限制参数分别为 `toleranceSeconds` / `maxBodyBytes` 和 `tolerance_seconds` / `max_body_bytes`。helper 签名见 [TypeScript](../reference/typescript-sdk.md) 和 [Python](../reference/python-sdk.md) reference。

也可以用官方 `standardwebhooks` library 验证相同协议。不要把解析后的 JSON body 作为验签输入。

## 处理事件 {#event-envelope}

Webhook body 使用顶层 `type` 和 `id`。SDK 的 `SessionEvent` 则带有持久 cursor，事件类型字段在 TypeScript 中为 `eventType`，在 Python 中为 `event_type`。

```json
{
  "object": "event",
  "id": "event-id",
  "type": "run.finished",
  "schema_version": 1,
  "created_at": "2026-10-02T09:00:00.000Z",
  "data": {
    "agent_id": "agent-id",
    "session_origin": "api",
    "resource_access": "public"
  }
}
```

这个缩短的例子省略了事件专属摘要。`data` 还带有 ownership attribution，以及适用时的 run/session 关联。存储事件时保留未知字段。使用 `session_scope: "all"` 时，通知可能带有 `resource_access: "internal_only"`；它不授予通过公共 API 读取该 session 的权限。

使用顶层 event `id` 去重，它也等于 `webhook-id` header。Payload 的 `created_at` 表示事件发生时间；`webhook-timestamp` 是本次 attempt 签名时间，会在 retry 时更新。

unwrap helper 只校验基础 envelope：`object`、`id`、`type`、`schema_version`、`created_at` 和 `data`。它们不校验每种事件的完整 `data` schema。检查 handler 使用的字段，并容忍未知事件类型。TypeScript 的 `knownWebhookEvent()` 只收窄 type，不对 `data` 做 runtime validation。

收到 `run.finished` 时，用 run/session 关联 [读取该 run 的 output](./session-operations.md#read-output-for-one-run)。展示整个任务完成前，检查 [yielded turn](./events.md#when-a-turn-yields)。通过资源读取核对状态，不要依赖通知到达顺序。

## 测试投递 {#test-delivery}

把 `WEBHOOK_ID` 设为注册响应的 `endpoint.id`：

```bash
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/test" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: receiver-test-v1' \
  -d '{}'
```

202 响应带有 `object: "webhook_test"`、`endpoint_id`、`receipt_id`。它确认入队，不证明投递成功。通过 delivery log 检查结果：

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/deliveries?event_type=webhook.test" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

读取 `deliveries` 数组。`status` 是 `pending`、`in_flight`、`succeeded`、`dead` 或 `cancelled`；test HTTP receipt 成功与这里的 `status: "succeeded"` 不是同一件事。`has_more` 为 true 时，保持 filter 不变继续传 `next_cursor`。列表默认 50 条，`limit` 接受 1–200。

Disabled endpoint 仍可接收显式 test，业务事件则要求 enabled。Test 送达、receiver 验签成功后，再产生一个真实事件验证业务路径。

## 投递行为 {#delivery-behavior}

| Receiver 结果 | 行为 |
|---|---|
| 任意 2xx | 确认投递。 |
| 3xx | 不跟随 redirect，endpoint 被 disabled。 |
| 410 | Endpoint 被 disabled。 |
| 地址未通过公网检查 | Endpoint 被 disabled。 |
| 408、425、429、5xx 或 transport failure | Regular retry policy。 |
| 其他 4xx | Short retry policy，最多五次 attempt。 |

Regular backoff 为 5 秒、30 秒、2 分钟、10 分钟、1 小时，之后 6 小时，带 ±20% jitter，上限 6 小时。429 的 `Retry-After` 可在上限内延后下一次 attempt。自动 retry 在事件发生后的 72 小时 deadline 结束。这些重试间隔不保证实际送达时间。

Event 和 attempt log 支持恢复；terminal delivery/attempt 记录当前至少保留 30 天。更长期审计需要的事件由应用自行保存。不要假设 exactly-once，也不要用 webhook 作为对话的唯一记录。

## 检查和恢复投递 {#inspect-and-recover-deliveries}

下表的 path 相对于 `/agents/{agent_id}/webhooks`：

| Method 和 path | 用法 |
|---|---|
| `GET /{webhook_id}` | 读取 endpoint 配置，不返回明文 secret。 |
| `GET /{webhook_id}/deliveries` | 列出 delivery record。 |
| `GET /{webhook_id}/deliveries/{delivery_id}` | 读取一次 delivery 及其 attempt。 |
| `GET /events/{event_id}` | 在授权 scope 内读取事件；不嵌套在单个 endpoint 下。 |
| `POST /{webhook_id}/deliveries/{delivery_id}/redeliver` | 将已有事件再次入队投递。 |
| `POST /{webhook_id}/deliveries/redeliver` | Batch redelivery；先选定恢复范围再使用。 |

单条 redelivery 要求 Idempotency-Key：

```bash
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/deliveries/$DELIVERY_ID/redeliver" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Idempotency-Key: recovery-round-v1'
```

202 只确认入队。Manual redelivery 从该操作起重新给 72 小时窗口。Endpoint 必须 enabled；disabled endpoint 返回 409。Redelivery 再次发送冻结的事件，不重新运行 Agent，也不产生新的业务结果。恢复时仍要保留 event-ID 去重。

## 维护 Endpoint {#maintain-the-endpoint}

公共更新方法是 `POST /{webhook_id}/update`，删除是 `POST /{webhook_id}/delete`：

```bash
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/update" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

轮换 secret 时，调用 `POST /{webhook_id}/rotate-secret`，带 Idempotency-Key 和 `{"revoke_previous_after":86400}`。旧 secret 保留 24 小时，供你部署新 verifier secret。传 `0` 则立即撤销旧 secret；不接受其他值。保存新 secret，并检查 `signing_secret_available`。Overlap 期间，delivery 携带两个 active secret 的签名。

先解决自动 disabled 的原因，再重新 enabled。不要把 enabled flag 或 202 receipt 当成 receiver 已处理事件的证据。

## API key scope

示例使用 Agent-scoped path，并要求有该 Agent 的访问权限。Key 的设置和资源范围见[认证](../get-started/authentication.md)。调用方传入的 organization、owner、project query 不会扩大 key 权限。

## SDK 调用

以下示例要求安装包含该方法的 SDK release。先检查已安装的 exports；缺少方法时使用本页 HTTP 示例。

::: code-group

```ts [TypeScript]
const created = await zc.createAgentWebhook(agentId, {
  url: 'https://receiver.example/webhook', event_types: ['run.finished'],
}, 'register-hook-v1')
const page = await zc.listAgentWebhooks(agentId) // page.webhooks
const receipt = await zc.testAgentWebhook(agentId, created.endpoint.id, 'test-hook-v1')
const deliveries = await zc.listAgentWebhookDeliveries(agentId, created.endpoint.id, { eventType: 'webhook.test' })
```

```python [Python]
created = await client.create_agent_webhook(
    agent_id, {"url": "https://receiver.example/webhook", "event_types": ["run.finished"]},
    idempotency_key="register-hook-v1",
)
page = await client.list_agent_webhooks(agent_id)  # page["webhooks"]
receipt = await client.test_agent_webhook(agent_id, created["endpoint"]["id"], idempotency_key="test-hook-v1")
deliveries = await client.list_agent_webhook_deliveries(agent_id, created["endpoint"]["id"], event_type="webhook.test")
```

:::

创建、轮换、测试和重投需要稳定的 idempotency key。202 回执仅表示入队。幂等重放中的 `signing_secret` 可以为 null；检查 `signing_secret_available`，不要输出 secret。读取、修改、删除、事件查询和单条／批量重投见 SDK reference。
