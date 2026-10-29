---
description: Review what an Agent did through Session events, transcripts, approvals, and trajectories, and use webhooks, schedules, and Usage to catch problems early.
---

# Review and monitor sessions

Every Session keeps an ordered, durable record of its work: your inputs, model responses, tool
calls and their results, approvals, errors, and how each run ended. Read that record to review
what an Agent did. Use webhooks, schedule lists, and Usage to notice problems without watching
every stream. This page shows what to read and what to look for; the linked guides describe
each API in detail.

Examples reuse the client from [Quickstart](../get-started/quickstart.md). Python calls run
inside an async function. For curl, complete the environment setup in
[Authentication](../get-started/authentication.md).

## Keep your own records

ZooWork does not know your end users, so your application is what connects a Session to a
person. Store these values beside each task:

- your user ID, together with the `agent_id` and `session_id`;
- the last processed event cursor, so a review or a reconnect can continue from it;
- who decided each approval, which you can also pass as `resolvedBy`.

Read and keep what you need before deleting a Session. After a successful delete, public
Session reads return 404, even though the records are retained. Webhook delivery and attempt
records currently have at least 30 days of retention; keep longer audit history in your own
storage.

## Review tool activity in a Session

The event log records each tool call the Agent made, with its arguments and result. Read the
events that matter for a review:

::: code-group

```ts [TypeScript]
const events = await client.listAllEvents(agentId, sessionId, {
  types: ['agent.tool', 'agent.approval', 'agent.custom_tool_use', 'agent.error', 'run.finished'],
})
for (const ev of events) {
  console.log(ev.seq, ev.eventType, ev.payload.phase, ev.payload.toolName ?? ev.payload.name)
}
```

```python [Python]
events = await client.list_all_events(
    agent_id,
    session_id,
    types=["agent.tool", "agent.approval", "agent.custom_tool_use", "agent.error", "run.finished"],
)
for event in events:
    payload = event.payload
    print(event.seq, event.event_type, payload.get("phase"), payload.get("toolName") or payload.get("name"))
```

```bash [curl]
curl -sS --fail-with-body --get \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'types=agent.tool,agent.approval,agent.custom_tool_use,agent.error,run.finished' \
  --data-urlencode 'limit=500'
```

:::

The SDK methods follow the cursor through every page. The curl request reads one page;
continue with its `next_cursor` while `has_more` is true. Do not use `listEvents` for a
review: it returns a single page and gives no sign that more events exist.

| Event | What to check |
|---|---|
| `agent.tool`, `phase: 'start'` | `toolName` and `args`. Look for hosts you do not expect in `exec` and `web_fetch` arguments, and for `persona_doc_update` or `cron` calls your product did not ask for. |
| `agent.tool`, `phase: 'end'` | `isError` and `resultPreview`. |
| `agent.tool`, `phase: 'blocked'` | `deniedReason`. The call ended without running, because of a policy, an approval denial or timeout, a cancellation, or an interruption. |
| `agent.approval` | `phase: 'requested'` with the tool and arguments; `phase: 'resolved'` with `resolution` and, when supplied, `resolvedBy`. |
| `agent.custom_tool_use` | Requests to your custom tools, their `input`, and how each one was resolved. |
| `agent.error` | Errors inside the turn, such as `mcp_connection_failed` or `mcp_authentication_failed`. |
| `run.finished` | `status` is `succeeded`, `failed`, or `aborted`. A yielded turn has `turnEndReason: 'yielded'` while its task continues. |

Pair `start` with `end` or `blocked` by `toolCallId`, not by position. A run can succeed after
a tool error, so check tool results and the run status separately. For more detail, add
`agent.command_output` for command output and `agent.patch` for applied patches. See
[Tool call phases](../build/events.md#tool-call-phases) and
[Turn outcomes](../build/events.md#turn-outcomes).

To read the stored conversation messages, call `getSession(agentId, sessionId, { history: true })`
or `get_session(agent_id, session_id, history=True)`. Each assistant message records its token
counts and `responseModel`, the model that actually answered. See
[Session operations](../build/session-operations.md).

## Get alerts with webhooks

Webhooks notify your backend without an open stream. For monitoring, subscribe to:

| Event types | Use |
|---|---|
| `approval.requested` | Route a pending tool call to an authorized reviewer. A pending approval is denied after ten minutes. |
| `custom_tool.requested` | Start your custom tool handler, which checks authorization before running the operation. |
| `run.finished` | Check the outcome and the output of each run. |
| `schedule.created`, `schedule.updated` | Notice new or changed schedules. |
| `schedule.dispatched`, `schedule.dispatch_failed` | Follow scheduled work. |

Verify the signature of every delivery. Webhooks can be duplicated or arrive out of order,
so treat each one as a signal to read the Session, approval, or schedule, not as the record
itself. If your receiver was down, recover pending work by listing it:
`listApprovals(agentId, { status: 'pending' })` and
`listCustomToolCalls(agentId, { status: 'pending' })` in TypeScript, or
`list_approvals(agent_id, status="pending")` and
`list_custom_tool_calls(agent_id, status="pending")` in Python. See
[Webhooks](../build/webhooks.md), [Permission policies](../build/permissions.md#resolve-a-pending-approval),
and [Custom tools](../build/tools.md#application-executed-custom-tools).

## Check scheduled work

`listSchedules(agentId)` / `list_schedules(agent_id)` returns the Agent's schedules, including
schedules the Agent created with its scheduling tool. Compare the list with the schedules your
application created, and pause or delete anything you do not expect. `listScheduleRuns()` /
`list_schedule_runs()` shows a schedule's executions. See [Schedules](../build/schedules.md).

## Watch spending

Query Usage grouped by Session to find expensive tasks, for example with
`getUsage({ range: '7d', groupBy: 'session' })` / `get_usage(range="7d", group_by="session")`.
A Platform key reads only usage attributed to that key. Organization administrators see
organization-wide usage, including shared sandbox costs, in
[ZooWork Platform](https://platform.zoowork.ai).

Usage reporting is not a cap: compare it with your own limits and interrupt work that exceeds
them. The token counts in a Session transcript help you understand a task, but their `cost`
fields are recorded as `0`; use Usage for consumption. See [Usage](../reference/usage.md).

## Review trajectories at scale

Reviewing one Session answers what happened in one task. To find recurring failures or unsafe
behavior across many tasks, keep each task's complete ordered event history with your own task
identifier and an outcome label. The same records support evaluation. See
[Agent trajectories](../get-started/trajectories.md).

## Respond to a problem

| Problem | Action |
|---|---|
| A run is doing something it should not | Send [`user.interrupt`](../build/events.md#user-interrupt). The run ends with `run.finished` and `status: 'aborted'`. |
| A schedule keeps starting unwanted work | Pause it with `enabled: false`, or delete it. See [Schedules](../build/schedules.md#enable-pause-and-delete). |
| An Agent must stop all work | Stop the Agent. This cancels its running work and blocks new Sessions. See [Stop and delete](../build/agents.md#stop-and-delete). |
| A tool is being misused | Remove it with `tool_policy`, or require approval for it. The next turn uses the new configuration; turns already in flight keep the old one. |
| The API key may be exposed | Create a new key, deploy it, then revoke the old key. See [Replace or revoke a key](../get-started/authentication.md#replace-or-revoke-a-key). |
| A webhook signing secret may be exposed | Rotate it with `revoke_previous_after: 0` to revoke the old secret immediately. See [Webhooks](../build/webhooks.md#maintain-the-endpoint). |
| An Artifact URL reached the wrong people | Delete the Artifact. A presigned URL issued earlier can keep working until it expires. See [Files and artifacts](../build/files.md#access-urls-and-deletion). |

## Related

- [Secure your deployment](./secure-deployment.md): the controls to put in place before you go live.
- [Risks and boundaries](./risks-and-boundaries.md): where data lives and what each risk looks like.
- [Events and streaming](../build/events.md): the complete event vocabulary and cursor rules.
- [Agent trajectories](../get-started/trajectories.md): use execution records for evaluation.
