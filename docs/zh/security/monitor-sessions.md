---
title: 审查与监控 Session
description: 通过 Session 事件、transcript、审批和轨迹审查 Agent 做了什么，并用 webhook、schedule 列表和 Usage 尽早发现问题。
source: /en/security/monitor-sessions
source_hash: 76b95008da5ecfb8345e02b4ad41c21311bec5b383440037c905562837f46a43
---

# 审查与监控 Session

每个 Session 都按顺序持久保存它的工作记录：你的输入、模型回复、工具调用及其结果、审批、
错误，以及每个 run 如何结束。读取这份记录，就能审查 Agent 做了什么。用 webhook、schedule 列表和
Usage，可以在不盯着每个流的情况下发现问题。本页说明读什么、看什么；各 API 的细节见链接的指南。

示例复用[快速开始](../get-started/quickstart.md)中的 client。Python 调用在 async 函数中运行。
curl 先完成[鉴权](../get-started/authentication.md)中的环境变量设置。

## 保存你自己的记录 {#keep-your-own-records}

ZooWork 不知道你的终端用户是谁，所以把 Session 和具体的人关联起来的是你的应用。
在每个任务旁边保存这些值：

- 你的用户 ID，以及对应的 `agent_id` 和 `session_id`；
- 最后处理过的事件 cursor，审查或重新连接时可以从这里继续；
- 每次审批由谁决定，也可以通过 `resolvedBy` 传给 ZooWork。

删除 Session 之前，先读取并保存你需要的内容。删除成功后，公共 Session 读取会返回 404，
即使记录仍被保留。Webhook 投递和尝试记录目前至少保留 30 天；更长时间的审计历史保存在你自己的存储里。

## 审查一个 Session 的工具活动 {#review-tool-activity-in-a-session}

事件日志记录了 Agent 发起的每次工具调用，包括参数和结果。读取审查需要的事件：

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

SDK 方法会沿着 cursor 读完所有页。curl 请求只读取一页；`has_more` 为 true 时，用它的
`next_cursor` 继续读取。审查时不要用 `listEvents`：它只返回一页，也不会提示还有更多事件。

| 事件 | 要检查什么 |
|---|---|
| `agent.tool`，`phase: 'start'` | `toolName` 和 `args`。留意 `exec` 和 `web_fetch` 参数中出现的意外主机，以及你的产品没有要求的 `persona_doc_update` 或 `cron` 调用。 |
| `agent.tool`，`phase: 'end'` | `isError` 和 `resultPreview`。 |
| `agent.tool`，`phase: 'blocked'` | `deniedReason`。调用没有执行就结束了，原因可能是策略拒绝、审批被拒或超时、取消，或者中断。 |
| `agent.approval` | `phase: 'requested'` 带有工具和参数；`phase: 'resolved'` 带有 `resolution`，提供时还有 `resolvedBy`。 |
| `agent.custom_tool_use` | 对你的 custom tool 的请求、它们的 `input`，以及每个请求如何处理。 |
| `agent.error` | 回合内的错误，例如 `mcp_connection_failed` 或 `mcp_authentication_failed`。 |
| `run.finished` | `status` 为 `succeeded`、`failed` 或 `aborted`。yield 的回合带有 `turnEndReason: 'yielded'`，其任务仍在继续。 |

用 `toolCallId` 把 `start` 和 `end` 或 `blocked` 配对，不要按位置配对。工具出错后 run 仍可能成功，
所以要分别检查工具结果和 run 状态。需要更多细节时，加上 `agent.command_output` 查看命令输出，
加上 `agent.patch` 查看应用的补丁。见[工具调用阶段](../build/events.md#tool-call-phases)和
[回合结果](../build/events.md#turn-outcomes)。

要读取保存的对话消息，调用 `getSession(agentId, sessionId, { history: true })` 或
`get_session(agent_id, session_id, history=True)`。每条 assistant 消息都记录了 token 数和
`responseModel`，即实际回答的模型。见 [Session 操作](../build/session-operations.md)。

## 用 webhook 接收提醒 {#get-alerts-with-webhooks}

Webhook 不需要保持流连接就能通知你的后端。用于监控时，订阅这些事件：

| 事件类型 | 用途 |
|---|---|
| `approval.requested` | 把 pending 的工具调用转给有权审批的人。pending approval 十分钟后会被拒绝。 |
| `custom_tool.requested` | 启动你的 custom tool 处理程序，由它在执行前检查授权。 |
| `run.finished` | 检查每个 run 的结果和输出。 |
| `schedule.created`、`schedule.updated` | 发现新增或修改的 schedule。 |
| `schedule.dispatched`、`schedule.dispatch_failed` | 跟踪定时执行的工作。 |

验证每次投递的签名。Webhook 可能重复，也可能乱序到达，所以把每次投递当作去读取 Session、
审批或 schedule 的信号，而不是记录本身。如果接收端曾经宕机，列出 pending 的工作来恢复：
TypeScript 用 `listApprovals(agentId, { status: 'pending' })` 和
`listCustomToolCalls(agentId, { status: 'pending' })`，Python 用
`list_approvals(agent_id, status="pending")` 和
`list_custom_tool_calls(agent_id, status="pending")`。见 [Webhooks](../build/webhooks.md)、
[权限策略](../build/permissions.md#处理-pending-approval)和
[Custom tool](../build/tools.md#应用执行的自定义工具)。

## 检查定时工作 {#check-scheduled-work}

`listSchedules(agentId)` / `list_schedules(agent_id)` 返回该 Agent 的 schedule，
包括 Agent 用自己的调度工具创建的 schedule。把这个列表与你的应用创建的 schedule 对比，
暂停或删除不在预期内的。`listScheduleRuns()` / `list_schedule_runs()` 显示一个 schedule 的执行记录。
见 [Schedules](../build/schedules.md)。

## 关注花费 {#watch-spending}

按 Session 分组查询 Usage，找出花费高的任务，例如
`getUsage({ range: '7d', groupBy: 'session' })` / `get_usage(range="7d", group_by="session")`。
Platform key 只能读取归属于该 key 的用量。组织管理员可以在
[ZooWork Platform](https://platform.zoowork.ai) 查看全组织用量，包括共享的 sandbox 成本。

Usage 报告不是上限：把它和你自己的限额比较，并中断超限的工作。Session transcript 中的 token 数
有助于理解一个任务，但其中的 `cost` 字段记录为 `0`；消耗以 Usage 为准。见 [Usage](../reference/usage.md)。

## 大规模审查轨迹 {#review-trajectories-at-scale}

审查一个 Session，回答的是一个任务里发生了什么。要在大量任务中发现反复出现的失败或不安全行为，
为每个任务保存完整、有序的事件历史，连同你自己的任务标识和 outcome 标签。
同一批记录也可以用于评测。见 [Agent 轨迹](../get-started/trajectories.md)。

## 发现问题后如何处理 {#respond-to-a-problem}

| 问题 | 处理方式 |
|---|---|
| 一个 run 正在做不该做的事 | 发送 [`user.interrupt`](../build/events.md#user-interrupt)。run 以 `run.finished` 结束，`status` 为 `'aborted'`。 |
| 一个 schedule 不断启动不需要的工作 | 用 `enabled: false` 暂停，或者删除它。见 [Schedules](../build/schedules.md#enable-pause-and-delete)。 |
| 一个 Agent 必须停止所有工作 | 停止该 Agent。这会取消它正在运行的工作，并阻止新的 Sessions。见[停止与删除](../build/agents.md#停止与删除)。 |
| 某个工具被误用 | 用 `tool_policy` 去掉它，或要求审批。下一个回合使用新配置；正在进行的回合仍使用旧配置。 |
| API key 可能已泄露 | 创建新 key 并部署，再吊销旧 key。见[更换或吊销 key](../get-started/authentication.md#替换或撤销-key)。 |
| Webhook signing secret 可能已泄露 | 用 `revoke_previous_after: 0` 轮换，立即吊销旧 secret。见 [Webhooks](../build/webhooks.md#maintain-the-endpoint)。 |
| Artifact URL 被不该看到的人拿到 | 删除该 Artifact。之前发出的 presigned URL 可能在过期前仍然可用。见[文件与产物](../build/files.md#access-urls-and-deletion)。 |

## 相关 {#related}

- [保护你的部署](./secure-deployment.md)：上线前要落实的控制手段。
- [风险与边界](./risks-and-boundaries.md)：数据存在哪里，以及每种风险的表现。
- [事件与流式](../build/events.md)：完整的事件类型和 cursor 规则。
- [Agent 轨迹](../get-started/trajectories.md)：把执行记录用于评测。
