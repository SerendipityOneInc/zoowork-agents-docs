---
description: Run an Agent on a schedule, inspect its executions, and evaluate scheduled results.
---

# Schedules

Create a schedule when your Agent should run without a new message from your application.
Each firing dispatches work to the Agent. Inspect dispatch and the resulting run separately:
successfully starting work does not prove its result is complete or correct.

Use a backend API key with authority over the Agent and the `client` configured in
[Authentication](../get-started/authentication.md). Use `agentId` in TypeScript, `agent_id` in
Python, or `AGENT_ID` in curl. Python `await` examples run inside an async function. Start
the Agent before expecting it to execute scheduled work.

## Create a schedule

This example creates an enabled daily digest at 09:00 in Shanghai. Automatic firings are
active immediately; a manual trigger adds an execution without changing that cadence.
Choose the schedule and payload with that in mind.

Test the task text in an ordinary Session first; this checks the task, not schedule dispatch.
When testing the Schedule itself, choose a cadence whose next automatic firing is well after
your test window, and pause or delete it as soon as the test is complete. A short interval
keeps firing while enabled and can continue consuming credits.

::: code-group

```ts [TypeScript]
const scheduleId = 'daily-digest'
await client.createSchedule(agentId, {
  schedule_id: scheduleId,
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  payload: { kind: 'agentTurn', message: 'Summarise yesterday and include source links.' },
  sessionTarget: 'isolated',
  enabled: true,
})
```

```python [Python]
schedule_id = "daily-digest"
await client.create_schedule(agent_id, {
    "schedule_id": schedule_id,
    "schedule": {"kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai"},
    "payload": {"kind": "agentTurn", "message": "Summarise yesterday and include source links."},
    "sessionTarget": "isolated",
    "enabled": True,
})
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "schedule_id":"daily-digest",
    "schedule":{"kind":"cron","expr":"0 9 * * *","tz":"Asia/Shanghai"},
    "payload":{"kind":"agentTurn","message":"Summarise yesterday and include source links."},
    "sessionTarget":"isolated",
    "enabled":true
  }'
```

:::

| Field | Meaning |
|---|---|
| `schedule_id` | Your stable ID, matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. |
| `schedule` | Cadence. This example uses `kind: "cron"`, a cron `expr`, and an IANA `tz`. |
| `payload` | Work to dispatch. `agentTurn` uses a non-empty `message`. |
| `sessionTarget` | `isolated` creates a fresh session per firing. Omission has the same default. |
| `enabled` | Must be true for automatic and manual executions. It does not report a run result. |

The 201 receipt includes the public `schedule_id`. An older `schedule_name` field is retained
for compatibility; use `schedule_id` when addressing the endpoints below. Read the saved
definition with GET rather than expecting it in the create receipt.

Recreating the same ID with the same definition reconciles the existing schedule. The same
ID with a different definition returns 409. Use a stable ID to recover from a lost response;
see [Errors and retries](../reference/errors.md).

### Choose the conversation

Use `sessionTarget: "session:<session_id>"` to target an existing session of this Agent.
`sessionTarget` is immutable after creation. Create another schedule when the conversation
target must change.

An isolated session separates conversation history. It does not establish application-user
file or memory isolation. See [An agent per user](./per-user-agents.md) for that boundary.

## Inspect and trigger once

For curl, set `SCHEDULE_ID=daily-digest`. Read the saved definition:

::: code-group

```ts [TypeScript]
const schedule = await client.getSchedule(agentId, scheduleId)
```

```python [Python]
schedule = await client.get_schedule(agent_id, schedule_id)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules/$SCHEDULE_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Read responses use a different vocabulary from create requests. They include the public
`schedule_id` alongside compatibility fields. Change the cadence through `schedule`, not by
copying a read response's `scheduleSpec` back into an update.

Trigger a manual firing of the enabled schedule without changing the cadence. If you paused
the schedule, [enable it](#enable-pause-and-delete) first; doing so also activates automatic firings:

::: code-group

```ts [TypeScript]
const receipt = await client.triggerSchedule(agentId, scheduleId)
```

```python [Python]
receipt = await client.trigger_schedule(agent_id, schedule_id)
```

```bash [curl]
curl -X POST "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules/$SCHEDULE_ID/trigger" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

The trigger receipt acknowledges a request, not execution or completion. A disabled schedule
can return `triggered: true` and then be skipped with `schedule.skipped` / `reason: "disabled"`.
Do not use a disabled schedule as a manual-only test mode. Its run list can also lack `status`
and `session_id`; missing fields are not evidence of success. Inspect recent firings next:

::: code-group

```ts [TypeScript]
const runs = await client.listScheduleRuns(agentId, scheduleId, { limit: 20 })
```

```python [Python]
runs = await client.list_schedule_runs(agent_id, schedule_id, limit=20)
```

```bash [curl]
curl "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules/$SCHEDULE_ID/runs?limit=20" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

The SDK methods return the run list; HTTP returns it in the `runs` array.
`limit` defaults to 20 and is capped at 100. Entries can come from different sources; read
`source` before interpreting source-specific fields. Follow available run/session correlation
with [Events](./events.md), [run output](./session-operations.md#read-output-for-one-run), or
[Webhooks](./webhooks.md). A skipped or failed dispatch is different from a run that started
and later failed.

## Enable, pause, and delete

To resume a paused schedule, enable it before a manual trigger. This also enables automatic firings:

::: code-group

```ts [TypeScript]
await client.updateSchedule(agentId, scheduleId, { enabled: true })
```

```python [Python]
await client.update_schedule(agent_id, schedule_id, {"enabled": True})
```

```bash [curl]
curl -X PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules/$SCHEDULE_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}'
```

:::

Use the same update with `enabled:false` to pause future executions, including manual triggers. Pausing does not
cancel work already dispatched; use a [session interrupt](./events.md#user-interrupt) when
you also need to stop its current run.

Delete the schedule when it is no longer needed:

::: code-group

```ts [TypeScript]
await client.deleteSchedule(agentId, scheduleId)
```

```python [Python]
await client.delete_schedule(agent_id, schedule_id)
```

```bash [curl]
curl -X DELETE "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules/$SCHEDULE_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

Do not assume stopping or deleting an Agent cleans up all its schedules. Manage the schedule
lifecycle explicitly. After an uncertain update/delete response, read or list schedules to
reconcile state instead of assuming a retry cannot change anything.

## Payloads and limits

The minimal flow uses `agentTurn`. Its additional fields include `model`, `thinking`,
`toolsAllow`, `timeoutSeconds`, and the `outcome` described below. `timeoutSeconds` limits
execution time; it is not a monetary budget, and `0` removes that timeout override.

The management HTTP API also recognizes `systemEvent` and `command` payloads. They are
different execution modes, not alternate ways to write an `agentTurn` message. Agent-created
schedules have narrower rules than management requests. Do not apply their limits to every
API call, or assume that runtime scheduling tools and the public SDK expose identical options.

The public session API has no spending-cap or budget-resume contract. Use
[Usage](../reference/usage.md) for consumption visibility; setting a timeout or pausing a
schedule does not undo consumption already incurred.

## Evaluate a scheduled result

This optional setting evaluates scheduled `agentTurn` work. It is not a general Session
outcome resource, and it is separate from the application-owned outcome labels described in
[Agent trajectories](../get-started/trajectories.md).

An outcome specifies what the scheduled Agent should produce and how to check it. The
runtime evaluates each candidate, feeds back a revision request, and repeats up to the
configured iteration limit. Keep criteria concrete: a digest that includes a source link for
each factual claim is easier to check than a digest that is merely “good.”

Add `outcome` to an `agentTurn` payload when creating or updating the schedule:

::: code-group

```ts [TypeScript]
await client.updateSchedule(agentId, scheduleId, {
  payload: {
    kind: 'agentTurn',
    message: 'Summarise yesterday and include source links.',
    outcome: {
      description: 'Produce a digest containing source links.',
      evaluator: {
        type: 'rubric',
        rubric: { type: 'text', text: 'Every factual claim has a source link.' },
      },
      maxIterations: 3,
      publish: 'after_satisfied',
    },
  },
})
```

```python [Python]
await client.update_schedule(agent_id, schedule_id, {
    "payload": {
        "kind": "agentTurn",
        "message": "Summarise yesterday and include source links.",
        "outcome": {
            "description": "Produce a digest containing source links.",
            "evaluator": {
                "type": "rubric",
                "rubric": {"type": "text", "text": "Every factual claim has a source link."},
            },
            "maxIterations": 3,
            "publish": "after_satisfied",
        },
    },
})
```

```bash [curl]
curl -X PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID/schedules/$SCHEDULE_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "payload": {
    "kind": "agentTurn",
    "message": "Summarise yesterday and include source links.",
    "outcome": {
      "description": "Produce a digest containing source links.",
      "evaluator": {
        "type": "rubric",
        "rubric": { "type": "text", "text": "Every factual claim has a source link." }
      },
      "maxIterations": 3,
      "publish": "after_satisfied"
    }
  }
}'
```

:::

This example updates the existing schedule. To configure an outcome at creation, include
the same `payload` alongside the schedule ID and cadence. It is not a session event.

| Outcome field | Meaning |
|---|---|
| `description` | Required target, up to 4,096 characters. |
| `evaluator` | Required evaluator. This example uses a `rubric` with inline `text`, up to 32,768 characters. A rubric evaluator can optionally select `model`. |
| `maxIterations` | Defaults to 3; accepts 1–5. |
| `publish` | `after_satisfied` by default, or `always` / `never`. Evaluation and publication are separate decisions. |

With `after_satisfied`, publication waits for an accepted result. `always` allows publication
without waiting for acceptance; `never` suppresses publication. Revision iterations remain
within the same logical run. Observe evaluator progress through its events and the
`outcome.evaluated` webhook, then inspect the run's terminal result.

| Result | Terminal run behavior |
|---|---|
| `satisfied` | Succeeded. |
| `needs_revision` | Continue evaluating another candidate while iterations remain. |
| `failed` or `max_iterations_reached` | Failed; under the default publication policy, an unaccepted result is not published. |
| `interrupted` | Aborted. |
| `evaluator_error` | Fails closed as an evaluator failure, rather than treating the candidate as accepted. |

When updating, an omitted `payload.outcome` preserves the stored setting; `null` explicitly
clears the rendered default; an object replaces the outcome configuration. Outcome changes
belong to the management API, not to Agent-created scheduling tools.

Current evaluation supports scheduled `agentTurn` work, not ordinary interactive sessions or
heartbeat turns. `user.define_outcome` is not an accepted session event. File/reference rubrics
and subagent evaluators are not supported. A command evaluator is a separate advanced mode;
this guide does not substitute a shell command for the inline rubric.

For application-side quality labels and evaluation datasets, see
[Trajectories](../get-started/trajectories.md). Those labels are distinct from a runtime outcome.
