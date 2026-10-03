---
description: Query usage with the SDK or public HTTP API and understand API-key scope, filters, and pagination.
---

# Usage

Query usage from your backend with `GET /usage`. Use it to observe consumption alongside the Sessions your application runs. Usage reporting does not enforce a Session budget or stop a run at a spending threshold.

## Read the last seven days

Complete [Authentication](../get-started/authentication.md), then request grouped and individual records:

```bash
curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/usage" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'range=7d' \
  --data-urlencode 'group_by=session' \
  --data-urlencode 'view=both' \
  --data-urlencode 'timezone=UTC'
```

Use `getUsage()` / `get_usage()` or HTTP for Usage queries.

A Platform key can read only usage attributed to that key. Omit `api_key_id` to query that scope. Passing another key's ID is rejected. Organization administrators use Platform's Usage page for organization-wide usage, including shared sandbox costs; an API key does not inherit that UI access.

## Credits and account balance

`credits` measures consumption in Platform credits, not tokens, cents, or a request count.
The Platform wallet uses **200 credits per USD**; 100 credits corresponds to USD 0.50 in
that unit. This is a unit conversion, not a fixed price per model call or per Session.

Usage for a Project key includes only consumption attributed to that key and the selected
query range. It is not the Organization's remaining balance. Other keys, shared sandbox
costs, top-ups and reporting timing mean subtracting this result from a previous balance
is not a reliable wallet reconciliation. Check the Organization balance and Usage in Platform.

## Query parameters

| Parameter | Accepted values | Default or behavior |
|---|---|---|
| `range` | `24h`, `7d`, `30d` | `24h` |
| `timezone` | Valid timezone name | `UTC`; at most 100 characters |
| `group_by` | `session`, `api_key` | `session` |
| `view` | `groups`, `records`, `both` | `both` |
| `session_id` | Session ID | Optional; 1–255 characters |
| `root_session_id` | Root Session ID | Optional; 1–255 characters |
| `api_key_id` | API key ID | Optional; still constrained by the calling key |
| `attribution` | `exact`, `shared`, `non_api`, `unattributed` | Optional classification filter; does not broaden access |
| `page` | Integer 1–1000 | `1` |
| `per_page` | Integer 1–100 | `50` |
| `as_of` | Timestamp with a timezone | Optional query boundary |
| `snapshot` | 32 lowercase hexadecimal characters | Optional pagination state |
| `cursor` | Opaque string, at most 256 characters | Optional pagination state |

Keep filters and returned pagination state together when continuing a query. Do not synthesize a cursor or snapshot. On `usage.snapshot_expired`, start a new query instead of reusing the expired state.

## Handle query failures

| HTTP / code | Action |
|---|---|
| 400 / `usage.invalid_query` | Fix semantic query errors, such as an invalid timezone. |
| 422 / no business type | Fix query validation errors, such as `range=1y` or `per_page=1000`. The response has a `detail` array; SDK `type` may be absent. Do not retry unchanged. |
| 403 / `usage.access_denied` | Query only usage within the key's scope. |
| 409 / `usage.snapshot_expired` | Restart the query with fresh pagination state. |
| 409 / `platform.billing_not_ready` | Complete the organization's billing setup; this code alone does not mean insufficient balance. |
| 429 / `usage.busy` | Retry a read with backoff. |
| 503 / `usage.unavailable` | Retry later; do not treat an unavailable or incomplete result as zero usage. |

See [Errors and retries](./errors.md) for authentication failures and safe retry rules. Use [Schedules](../build/schedules.md) for scheduled work and [Session operations](../build/session-operations.md) for run state; neither introduces a server-enforced spending cap.

## SDK calls

::: code-group

```ts [TypeScript]
const usage = await client.getUsage({ range: '7d', groupBy: 'session', view: 'both', perPage: 50 })
```

```python [Python]
usage = await client.get_usage(range="7d", group_by="session", view="both", per_page=50)
```

:::

Options follow each language's method conventions; response fields retain API spelling. Preserve snapshot and cursor values and stay within the current key scope.
