---
description: Register a webhook receiver, verify signed events, and inspect or retry deliveries.
---

# Subscribe to webhooks

Use webhooks when your backend needs to learn that a run ended, a tool needs attention, or a
schedule changed without keeping an SSE connection open. Use [Events](./events.md) when you
need the full, ordered conversation log.

Webhooks must be enabled on the service your API key calls. If the route is unavailable, requests can return `404`.

Both SDKs expose Agent webhook management methods; HTTP examples show the same contract.
Use the backend credentials and HTTP configuration from
[Authentication](../get-started/authentication.md), with access to the Agent. Start the Agent
before generating run events.

## Choose event types

Subscribe before the events you need occur. Webhooks can be duplicated or delivered out of
order; they do not replace the durable session event log.

| Event types | What to observe |
|---|---|
| `session.created`, `session.archived`, `session.deleted` | Session lifecycle. |
| `run.started`, `run.finished`, `run.yielded` | Run lifecycle. A yielded run can have continuing task work. |
| `approval.requested`, `approval.resolved` | Tool permission decisions. |
| `custom_tool.requested`, `custom_tool.resolved` | Application-executed custom tool calls. |
| `outcome.evaluated` | Evaluation of a [scheduled result](./schedules.md#evaluate-a-scheduled-result). |
| `schedule.created`, `schedule.updated`, `schedule.paused`, `schedule.resumed`, `schedule.deleted` | Schedule configuration lifecycle. |
| `schedule.dispatched`, `schedule.dispatch_failed`, `schedule.skipped`, `schedule.finished` | Scheduled execution progress. Dispatch and completed Agent work are different stages. |

`webhook.test` is diagnostic: the test operation produces it for one receiver. It cannot be
included in `event_types`. Agent, Environment, vault, and memory-store lifecycle notifications
are not part of this catalog.

## Register a receiver

Create an HTTPS endpoint in your application first. The URL must have a publicly resolvable
hostname on port 443. Direct IP addresses, URL credentials, fragments, and private addresses
are rejected. Replace `WEBHOOK_RECEIVER_URL` with your real receiver URL.

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: run-finished-receiver-v1' \
  -d "$(jq -n --arg url "$WEBHOOK_RECEIVER_URL" \
    '{url:$url,event_types:["run.finished"]}')"
```

| Create field | Meaning |
|---|---|
| `url` | Required HTTPS receiver URL. |
| `event_types` | Required non-empty list from the catalog above. Wildcards are not accepted. |
| `description` | Optional description, up to 500 characters. |
| `session_scope` | `api` by default, or `all` to include other session origins. |
| `enabled` | Defaults to true. Set false to register without receiving business events yet. |

The response includes `endpoint.id`, `signing_secret`, `signing_secret_version`, and
`signing_secret_available`. Save the `whsec_` signing secret in your server's secret storage;
ordinary GET requests do not return it. Reuse the same Idempotency-Key if the create response
is lost. Check `signing_secret_available` on a replay: a secret that has since been revoked
may no longer be returned.

Each Agent scope allows 10 undeleted endpoints. A disabled endpoint still occupies a slot.

## Verify before acknowledging

Deliveries use [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks).
The SDK verifies the signature over the original request bytes, then parses the event.
Read the body before JSON middleware touches it: parsing and reserializing changes signed bytes.

Use the SDK receiving helpers below to verify incoming deliveries. Register and manage
endpoints with the [SDK calls](#sdk-calls) or the HTTP examples on this page.

Set `ZOOWORK_WEBHOOK_SECRET` to the `whsec_` secret returned at registration. The handlers
below receive raw bytes and headers from your HTTP framework. The Python function returns
the HTTP status that its framework adapter should send.

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

The handlers explicitly compare `event.id` with the signed `webhook-id` before accepting
work. This check belongs to your application; the unwrap helpers do not perform it.

Implement `acceptOnce` / `accept_once` in your application: atomically record the unique
`event.id` and enqueue its work, or return successfully if that ID was already accepted.
Acknowledge only after durable acceptance, then process longer work outside the request.

The default body ceiling is **16 KiB**; also configure that request limit in your HTTP
server. The timestamp tolerance is **±300 seconds** against `webhook-timestamp`, rather than
payload `created_at`. Keep the receiver clock synchronized. Multiple secrets in
`ZOOWORK_WEBHOOK_SECRET` can be separated by whitespace or commas during rotation. An
explicit `secret` string is one secret; use an array or sequence for multiple secrets.

`unwrapWebhook` is async; `unwrap_webhook` is synchronous. If you override their clock for a
local test, TypeScript's `now` is milliseconds, while Python's `now` is Unix seconds. Their
optional limit arguments are `toleranceSeconds` / `maxBodyBytes` and
`tolerance_seconds` / `max_body_bytes`. See the [TypeScript](../reference/typescript-sdk.md)
and [Python](../reference/python-sdk.md) references for the helper signatures.

You can alternatively verify the same protocol with the official `standardwebhooks` library.
Do not use a parsed JSON body as verification input.

## Handle an event {#event-envelope}

The webhook body has top-level `type` and `id` fields. It is different from the SDK's
`SessionEvent`, which uses `eventType` in TypeScript or `event_type` in Python and carries a
durable cursor.

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

This shortened example omits the event-specific summary. `data` also carries ownership
attribution and, where applicable, run/session correlation. Preserve unknown fields when
storing events. With `session_scope: "all"`, a notification can have
`resource_access: "internal_only"`; that does not grant access to its session through the
public API.

Deduplicate using the top-level event `id`, which is also the `webhook-id` header. Use payload
`created_at` for when the event happened; `webhook-timestamp` is the time a delivery attempt
was signed and changes on retry.

The unwrap helpers validate the base envelope: `object`, `id`, `type`, `schema_version`,
`created_at`, and `data`. They do not validate every event-specific `data` field. Check the
fields your handler uses and tolerate unknown event types. TypeScript's
`knownWebhookEvent()` narrows the type without runtime validation of `data`.

Use run/session correlation on a `run.finished` notification to
[read that run's output](./session-operations.md#read-output-for-one-run). Check
[yielded turns](./events.md#when-a-turn-yields) before marking the whole task complete.
Reconcile through resource reads rather than relying on notification arrival order.

## Test delivery

Set `WEBHOOK_ID` to the `endpoint.id` returned at registration:

```bash
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/test" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: receiver-test-v1' \
  -d '{}'
```

The 202 response carries `object: "webhook_test"`, `endpoint_id`, and `receipt_id`. It confirms
queuing, not successful delivery. Inspect the delivery log for the result:

```bash
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/deliveries?event_type=webhook.test" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

Read the `deliveries` array. `status` is `pending`, `in_flight`, `succeeded`, `dead`, or
`cancelled`; a successful HTTP test receipt is not the same as `status: "succeeded"` here.
Follow `next_cursor` while `has_more` is true, preserving filters. The list defaults to 50
records and accepts `limit` from 1 to 200.

A disabled endpoint can still receive an explicit test. Business events require it to be
enabled. Once a test is delivered and your receiver accepts its signature, generate a real
event and verify that path too.

## Delivery behavior

| Receiver result | Behavior |
|---|---|
| Any 2xx | Delivery acknowledged. |
| 3xx | Redirect is not followed; endpoint is disabled. |
| 410 | Endpoint is disabled. |
| Address fails the public-network check | Endpoint is disabled. |
| 408, 425, 429, 5xx, or transport failure | Regular retry policy. |
| Other 4xx | Short retry policy, up to five attempts. |

The regular backoff is 5 seconds, 30 seconds, 2 minutes, 10 minutes, 1 hour, then 6 hours,
with ±20% jitter and a six-hour cap. A 429 `Retry-After` can delay the next attempt within
that cap. Automatic retry ends at the event's 72-hour deadline. These retry intervals do not guarantee delivery times.

Events and attempt logs support recovery; terminal delivery/attempt records currently have
at least 30 days of retention. Store the events needed for longer audit history in your own
application. Never assume exactly-once processing or use webhooks as the only record of a
conversation.

## Inspect and recover deliveries

All paths below are relative to `/agents/{agent_id}/webhooks`:

| Method and path | Use |
|---|---|
| `GET /{webhook_id}` | Read endpoint configuration without the plaintext secret. |
| `GET /{webhook_id}/deliveries` | List delivery records. |
| `GET /{webhook_id}/deliveries/{delivery_id}` | Read one delivery and its attempts. |
| `GET /events/{event_id}` | Read an event within the authorized scope. It is not nested under one endpoint. |
| `POST /{webhook_id}/deliveries/{delivery_id}/redeliver` | Queue another delivery of the existing event. |
| `POST /{webhook_id}/deliveries/redeliver` | Batch redelivery; use only after selecting the intended recovery scope. |

Single redelivery requires an Idempotency-Key:

```bash
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/deliveries/$DELIVERY_ID/redeliver" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Idempotency-Key: recovery-round-v1'
```

202 confirms queuing. Manual redelivery opens a new 72-hour window from that operation. The
endpoint must be enabled; a disabled endpoint returns 409. Redelivery sends the frozen event
again; it does not rerun the Agent or produce a new business result. Keep event-ID deduplication
in place even during recovery.

## Maintain the endpoint

Public endpoint updates use `POST /{webhook_id}/update`, and deletion uses
`POST /{webhook_id}/delete`:

```bash
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/webhooks/$WEBHOOK_ID/update" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

For secret rotation, call `POST /{webhook_id}/rotate-secret` with an Idempotency-Key and
`{"revoke_previous_after":86400}`. This retains the previous secret for 24 hours while you
deploy the new verifier secret. Use `0` for immediate revocation; no other value is accepted.
Store the returned secret and check `signing_secret_available`. During the overlap, deliveries
carry signatures for both active secrets.

Resolve the cause of an automatic disable before re-enabling an endpoint. Do not use an
enabled flag or a 202 receipt as proof that the receiver has processed events.

## API key scope

The examples use Agent-scoped paths and require access to that Agent. See
[Authentication](../get-started/authentication.md) for key setup and resource scope.
Caller-supplied organization, owner, or project query parameters never widen key authority.

## SDK calls

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

Creation, rotation, test and redelivery require a stable idempotency key. A 202 receipt acknowledges queuing. On an idempotent replay, `signing_secret` can be null; check `signing_secret_available` and never log the secret. See the SDK references for get/update/delete, event lookup and single/batch redelivery.
