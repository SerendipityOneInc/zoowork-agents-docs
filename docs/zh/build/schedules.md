---
title: Schedules
description: 定时运行 Agent，检查执行记录，并评价定时结果。
source: /en/build/schedules
source_hash: 01869597f7f0b5895e2143d991a270233e11a3ccf9f48ef42124f964033868f7
---

# Schedules

Agent 需要在没有新的应用消息时运行，可以创建 schedule。每次触发都会向 Agent 派发工作。派发和最终 run 要分别检查：成功启动工作，不证明结果已完成或正确。

使用有该 Agent 权限的后端 API key，以及[认证](../get-started/authentication.md)中配置的 `client`。Agent ID 在 TypeScript 中记为 `agentId`，Python 中记为 `agent_id`，curl 中使用 `AGENT_ID`。Python 的 `await` 示例在 async 函数内运行。需要执行定时工作前，先启动 Agent。

## 创建 Schedule {#create-a-schedule}

下面的例子在上海时区每天 09:00 生成 digest。先以 disabled 状态创建，检查并手动触发后再开启自动运行：

::: code-group

```ts [TypeScript]
const scheduleId = 'daily-digest'
await client.createSchedule(agentId, {
  schedule_id: scheduleId,
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  payload: { kind: 'agentTurn', message: 'Summarise yesterday and include source links.' },
  sessionTarget: 'isolated',
  enabled: false,
})
```

```python [Python]
schedule_id = "daily-digest"
await client.create_schedule(agent_id, {
    "schedule_id": schedule_id,
    "schedule": {"kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai"},
    "payload": {"kind": "agentTurn", "message": "Summarise yesterday and include source links."},
    "sessionTarget": "isolated",
    "enabled": False,
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
    "enabled":false
  }'
```

:::

| 字段 | 含义 |
|---|---|
| `schedule_id` | 你选择的稳定 ID，匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。 |
| `schedule` | 运行频率。本例使用 `kind: "cron"`、cron `expr`、IANA `tz`。 |
| `payload` | 派发的工作。`agentTurn` 使用非空 `message`。 |
| `sessionTarget` | `isolated` 每次触发创建新 session，省略时也采用这个默认值。 |
| `enabled` | 控制自动触发，不表示 run 的结果。 |

201 receipt 带有公共 `schedule_id`。旧 `schedule_name` 保留用于兼容；使用 `schedule_id` 访问下面的 endpoint。Create receipt 不包含完整定义，需要通过 GET 读取。

用相同 ID 和相同定义再次创建，会核对已有 schedule。相同 ID 配不同定义返回 409。使用稳定 ID 恢复丢失的 response；见[错误与重试](../reference/errors.md)。

### 选择对话 {#choose-the-conversation}

`sessionTarget: "session:<session_id>"` 指向该 Agent 已有的 session。创建后不能修改 `sessionTarget`。需要改变对话目标时，创建另一个 schedule。

Isolated session 分开保存对话历史，不构成应用用户的文件或记忆隔离。这一边界见[每用户一个 Agent](./per-user-agents.md)。

## 检查并触发一次 {#inspect-and-trigger-once}

curl 中设置 `SCHEDULE_ID=daily-digest`。读取已保存定义：

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

Read response 与 create request 使用不同字段形式。响应带公共 `schedule_id` 和兼容字段。修改频率时传 `schedule`，不要把 read response 的 `scheduleSpec` 原样放回 update。

手动触发一次，不改变运行频率：

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

Trigger receipt 表示是否请求了派发，不包含 Agent 答复。接着检查最近触发记录：

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

SDK 方法直接返回 run 列表；HTTP response 将列表放在 `runs` 数组中。`limit` 默认 20，上限 100。Entry 可能来自不同来源；先读 `source`，再解释来源专属字段。有 run/session 关联时，通过[事件](./events.md)、[run output](./session-operations.md#read-output-for-one-run)或 [Webhooks](./webhooks.md)继续观察。Skipped、dispatch failure 与已启动后失败的 run 不是同一种结果。

## 开启、暂停和删除 {#enable-pause-and-delete}

检查手动结果后，开启自动触发：

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

用相同 update 传 `enabled:false`，暂停后续自动触发。暂停不会取消已经派发的工作；同时需要停止当前 run 时，使用 [session interrupt](./events.md#user-interrupt)。

不再需要时删除 schedule：

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

不要假设停止或删除 Agent 会清理它的全部 schedule。显式管理 schedule 生命周期。Update/delete response 不确定时，通过 read/list 核对状态，不要假设 retry 一定没有影响。

## Payload 和限制 {#payloads-and-limits}

最小流程使用 `agentTurn`。它的其他字段包括 `model`、`thinking`、`toolsAllow`、`timeoutSeconds` 和下面的 `outcome`。`timeoutSeconds` 限制执行时间，不是金额 budget；`0` 清除这个 timeout override。

管理 HTTP API 也识别 `systemEvent` 和 `command` payload。它们是不同执行方式，不是填写 `agentTurn` message 的另两种写法。Agent 自己创建的 schedule 有更窄规则，不能把这些限制套在所有 API 请求上，也不能假设 runtime scheduling tool 与公共 SDK 的选项完全相同。

公共 Session API 没有花费上限或提高 budget 恢复的 contract。[Usage](../reference/usage.md) 用于观察消耗；设置 timeout 或暂停 schedule 不会撤销已经产生的消耗。

## 评价定时结果 {#evaluate-a-scheduled-result}

这个可选设置只评价 scheduled `agentTurn` 工作。它不是通用 Session outcome resource，也不同于 [Agent trajectories](../get-started/trajectories.md) 中由应用保存的 outcome label。

Outcome 指定 Agent 应产出什么，以及如何检查。Runtime 评价候选结果，把修改要求反馈给 Agent，再继续迭代，直到达到 iteration limit。使用具体条件：digest 的每条事实都带 source link，比只要求 digest “写得好”更容易检查。

创建或更新 schedule 时，把 `outcome` 加入 `agentTurn` payload：

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

这个例子更新已有 schedule。创建时配置 outcome，则把同一份 `payload` 和 schedule ID、cadence 一起提交。它不是 session event。

| Outcome 字段 | 含义 |
|---|---|
| `description` | 必填目标，最多 4,096 个字符。 |
| `evaluator` | 必填 evaluator。本例用 inline `text` 的 `rubric`，最多 32,768 个字符。Rubric evaluator 可选 `model`。 |
| `maxIterations` | 默认 3，接受 1–5。 |
| `publish` | 默认 `after_satisfied`，或 `always` / `never`。评价和发布是独立决策。 |

`after_satisfied` 在结果被接受后发布；`always` 不等待接受就允许发布；`never` 不发布。修改迭代保持在同一个 logical run 内。通过 evaluator event 和 `outcome.evaluated` webhook 观察，再检查 run 的 terminal result。

| 结果 | Terminal run 行为 |
|---|---|
| `satisfied` | Succeeded。 |
| `needs_revision` | 还有 iteration 名额时继续评价下一次候选结果。 |
| `failed` 或 `max_iterations_reached` | Failed；默认 publication policy 不发布未接受结果。 |
| `interrupted` | Aborted。 |
| `evaluator_error` | 按 evaluator failure 失败处理，不把候选结果当作已接受。 |

更新时，省略 `payload.outcome` 保留已保存设置；`null` 显式清除 rendered default；object 替换完整 outcome 配置。Outcome 变更属于管理 API，不属于 Agent 自己使用的 scheduling tool。

当前评价支持 scheduled `agentTurn`，不支持普通 interactive session 或 heartbeat turn。`user.define_outcome` 不是合法 session event。File/reference rubric 和 subagent evaluator 不支持。Command evaluator 是另外的高级模式；本指南不使用 shell command 替换 inline rubric。

应用侧质量标签和 evaluation dataset 见 [Trajectories](../get-started/trajectories.md)。这些标签与 runtime outcome 是不同概念。
