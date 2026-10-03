---
description: 通过公共HTTP API查询Usage，理解key scope、筛选与分页。
source: /en/reference/usage
source_hash: 1f77b4e7bfac34b583cd8be671f3250edec6fce51777a0ece78662584f6f1886
---

# Usage

在后端调用 `GET /usage` 查询消耗情况，并与应用运行的 Session 关联。Usage 用于观测，不会设置 Session budget，也不会在达到花费阈值时停止 run。

## 读取过去七天

完成[鉴权配置](../get-started/authentication.md)，请求聚合结果和单条记录：

```bash
curl -sS --fail-with-body --get "$ZOOWORK_BASE_URL/usage" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  --data-urlencode 'range=7d' \
  --data-urlencode 'group_by=session' \
  --data-urlencode 'view=both' \
  --data-urlencode 'timezone=UTC'
```

Usage 查询可以使用 `getUsage()` / `get_usage()` 或 HTTP。

Platform key 只能读取归属于自身的 Usage。省略 `api_key_id` 就查询这一 scope；传入其他 key 的 ID 会被拒绝。组织管理员使用 Platform 的 Usage 页面查看组织整体 Usage，包括共享 sandbox 成本。API key 不会继承 UI 的组织级权限。

## Credits 与账户余额 {#credits-and-account-balance}

`credits` 表示 Platform credits 消耗，不是 token 数、美元分或请求次数。Platform 钱包使用 **200 credits/USD**；例如 100 credits 对应 USD 0.50。这是单位换算，不是每次模型调用或每个 Session 的固定价格。

Project key 的 Usage 只包含所选时间范围内归属于该 key 的消耗，不是 Organization 的剩余余额。其他 key、共享 sandbox 费用、充值和报表时间差都会影响对账，不能用某次余额直接减去这份结果来推算当前余额。组织余额和组织范围的 Usage 请在 Platform 查看。

## 查询参数

| 参数 | 接受的值 | 默认值或行为 |
|---|---|---|
| `range` | `24h`、`7d`、`30d` | `24h` |
| `timezone` | 有效的 timezone 名称 | `UTC`，最多 100 个字符 |
| `group_by` | `session`、`api_key` | `session` |
| `view` | `groups`、`records`、`both` | `both` |
| `session_id` | Session ID | 可选，1–255 个字符 |
| `root_session_id` | Root Session ID | 可选，1–255 个字符 |
| `api_key_id` | API key ID | 可选，仍受调用 key 的权限限制 |
| `attribution` | `exact`、`shared`、`non_api`、`unattributed` | 可选的归属分类筛选，不扩大访问范围 |
| `page` | 1–1000 的整数 | `1` |
| `per_page` | 1–100 的整数 | `50` |
| `as_of` | 带 timezone 的 timestamp | 可选的查询边界 |
| `snapshot` | 32 个小写十六进制字符 | 可选的分页状态 |
| `cursor` | 不透明字符串，最多 256 个字符 | 可选的分页状态 |

继续查询时，将筛选条件与返回的分页状态一起保留，不要自己构造 cursor 或 snapshot。遇到 `usage.snapshot_expired`，发起新查询，不再使用已过期的状态。

## 处理查询失败

| HTTP / code | 操作 |
|---|---|
| 400 / `usage.invalid_query` | 修正无效 timezone 等查询错误。 |
| 422 / 无业务 type | 修正参数校验错误，例如 `range=1y` 或 `per_page=1000`。响应为 `detail` 数组，SDK 的 `type` 可能缺失；不要原样重试。 |
| 403 / `usage.access_denied` | 只查询 key scope 内的 Usage。 |
| 409 / `usage.snapshot_expired` | 使用新的分页状态重新查询。 |
| 409 / `platform.billing_not_ready` | 完成组织的 billing 设置；这个 code 本身不表示余额不足。 |
| 429 / `usage.busy` | 对读取请求做 backoff 后重试。 |
| 503 / `usage.unavailable` | 稍后重试，不要把不可用或不完整的结果当作零消耗。 |

认证失败和安全重试规则见[错误与重试](./errors.md)。定时工作见 [Schedules](../build/schedules.md)，run 状态见 [Session 操作](../build/session-operations.md)。它们都不提供服务端强制执行的花费上限。

## SDK 调用

::: code-group

```ts [TypeScript]
const usage = await client.getUsage({ range: '7d', groupBy: 'session', view: 'both', perPage: 50 })
```

```python [Python]
usage = await client.get_usage(range="7d", group_by="session", view="both", per_page=50)
```

:::

方法参数遵循对应语言的命名；响应保留 API 字段名。snapshot 和 cursor 原样传回，查询受当前 Key scope 限制。
