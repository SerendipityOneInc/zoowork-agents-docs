---
title: Vault（Beta）
description: "Beta：把每个用户的 MCP 凭据存入 Vault，绑定到该用户的 Sessions，并在用户离开时撤销。"
source: /en/build/vault
source_hash: 6a0a8502691ecd62cadf7f75fbde919abbac21ac6ae3871a9d94448b95b71d4e
---

# Vault（Beta）

::: warning Beta
Vault 是 beta 功能，需要 Platform API key，以及 TypeScript SDK 0.15.0 及以上或 Python SDK 0.10.0 及以上。
字段和行为在正式发布（GA）前可能变化。
:::

Vault 存放 Agent 所用远程 MCP Server 的凭据。你的应用把用户的 MCP 凭据保存到 Vault，
再在创建该用户的 Session 时绑定这个 Vault。Agent 在该 Session 中调用对应的 MCP Server 时，
平台会发送该用户的凭据。

响应不会返回已存储的 secret，Vault 凭据也不会放进 sandbox 环境。
MCP 结果或错误写入 Session 之前，平台会从中移除凭据的原文值。
如果 Server 以编码后的形式返回该值，平台无法识别。

当同一个 Agent 要代表多个用户调用同一个 MCP Server、且每个用户有各自的账号时，使用 Vault。
如果服务只有你的后端能访问，请改用[应用执行的 custom tool](./tools.md#应用执行的自定义工具)。

示例复用[快速开始](../get-started/quickstart.md)中的 `client`。Python 调用在 async 函数内运行。
使用 curl 时，先完成 [Authentication](../get-started/authentication.md) 中的准备工作。
`yourDb` 和 `your_db` 代表你自己的数据层。

整个流程分四步：

1. 在 Agent 上用 `auth: { type: "vault" }` [声明 MCP Server](#declare-the-mcp-server)。
2. 为用户[创建 Vault](#create-a-vault)，并[添加该用户的 credential](#add-a-credential)。
3. 启动 Agent，和创建任何 Session 之前一样，见[快速开始](../get-started/quickstart.md)。
4. [创建该用户的 Session](#start-a-session-with-the-vault)，并挂上 Vault。

## 工作原理 {#how-the-pieces-fit}

| 资源 | 说明 |
|---|---|
| Vault | 凭据容器，作用域为 `org` 或 `project`。ZooWork 不对终端用户建模；要让每个用户拥有自己的凭据，请为每个用户创建一个 Vault，并在你的数据库中记录对应关系。Vault 的 `metadata` 可以携带你的用户 ID。 |
| Credential | 针对一个 MCP Server URL 的一份 secret，`purpose: "mcp"`。URL、认证类型和 `provider_account_ref` 在创建后不能更改。 |
| Agent MCP server | Agent 的 `mcp` 数组中声明了 `auth: { type: "vault" }` 的 Server。只有这些 Server 会收到 Vault 凭据。 |
| Session binding | 创建 Session 时传入 `vault_ids` 后生成。它记录每个 Vault Server 在该 Session 存续期间使用哪份 credential。 |

Session 只使用你的应用绑定的 Vault。模型不能选择、列出或更改 Vault 或 credential。
`external_user_ref` 和 `actor.ref` 只是标签，不授予任何访问权限。

### 作用域与 key {#scopes-and-keys}

| 作用域 | 管理方式 | 可使用者 |
|---|---|---|
| `project` | 使用具名 Project 的 key。`project_id` 必须是该 Project 自己的 `proj_…` ID。 | 同一 Project 中的 Agent。 |
| `org` | 使用 Default Project 的 key。 | 组织内任意 Project 中的 Agent，包括 Default Project。 |

所有 Vault 路由都是管理路由，读取也不例外。key 访问自己 scope 之外的 Vault 时：

| 请求 | 具名 Project 的 key，org Vault | Default Project 的 key，project Vault |
|---|---|---|
| 按 ID 读取、更新、归档或删除，包括其中的 credential | `403 vault.management_forbidden` | `404 vault.not_found`：Default Project 看不到 project Vault |
| `listVaults` 且 `scope` 设为另一种 scope | `403 vault.management_forbidden` | `403 vault.management_forbidden` |
| `listVaults` 不带 `scope` | 只返回该 key 的 project Vault | 只返回 org Vault |
| 在另一种 scope 中 `createVault` | `403 vault.management_forbidden` | `404 vault.project_not_found` |

Default Project 中的 Agent 只能使用 org Vault。具名 Project 的 Agent
可以使用自己 Project 的 Vault 和 org Vault。

要知道手里的 key 属于哪一种，用 `getAgent()` / `get_agent()` 读取一个用它创建的 Agent。
具名 Project 的 key 创建的 Agent，`ownership.project_id` 是 `proj_…` ID；Default Project 的 key 创建的 Agent，这个字段是 `null`。

## 声明 MCP Server {#declare-the-mcp-server}

在 Agent 配置的 Server 上加入 `auth: { type: "vault" }`。`url` 必须使用 HTTPS，且不能带查询字符串或片段。
该 Server 还必须满足其他 [MCP 连接要求](./mcp.md#连接要求)。

::: code-group

```ts [TypeScript]
await client.updateAgent(agentId, {
  mcp: [
    {
      name: 'tickets',
      url: 'https://mcp.example.com/tickets',
      auth: { type: 'vault' },
      exposure: 'direct',
    },
  ],
})
```

```python [Python]
await client.update_agent(
    agent_id,
    {
        "mcp": [
            {
                "name": "tickets",
                "url": "https://mcp.example.com/tickets",
                "auth": {"type": "vault"},
                "exposure": "direct",
            }
        ]
    },
)
```

```bash [curl]
curl -sS --fail-with-body --request PUT "$ZOOWORK_BASE_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"mcp":[{"name":"tickets","url":"https://mcp.example.com/tickets","auth":{"type":"vault"},"exposure":"direct"}]}'
```

:::

创建 Agent 时声明 Server，把同样的条目放进 `createAgent` / `create_agent` 的 `resource.mcp`。

`mcp` 数组会整体替换，因此要包含 Agent 需要保留的每个 Server。
一个 Server 不能同时声明 `auth` 和 `credential`。在没有 Vault 凭据的 Session 中，
Vault Server 不会加载。两种 Session 中，其他 MCP Server 都按声明继续工作。

## 创建 Vault {#create-a-vault}

为用户创建一个 Vault，并把它的 ID 保存到你的用户映射中。每次 Vault 写入都需要 idempotency key；
重试同一操作时复用它。示例使用具名 Project 的 key。使用 Default Project 的 key 时，发送不带 `project_id` 的 `{ "scope": "org", "name": … }`。

::: code-group

```ts [TypeScript]
const vault = await client.createVault(
  { scope: 'project', project_id: projectId, name: `user-${user.id}`, metadata: { user_id: user.id } },
  { idempotencyKey: `vault-${user.id}` },
)
await yourDb.users.update(user.id, { vault_id: vault.id })
```

```python [Python]
vault = await client.create_vault(
    {
        "scope": "project",
        "project_id": project_id,
        "name": f"user-{user_id}",
        "metadata": {"user_id": user_id},
    },
    idempotency_key=f"vault-{user_id}",
)
await your_db.users.update(user_id, {"vault_id": vault["id"]})
```

```bash [curl]
jq -n --arg project "$PROJECT_ID" --arg user "$USER_ID" \
  '{scope:"project", project_id:$project, name:("user-" + $user), metadata:{user_id:$user}}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/vaults" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: vault-$USER_ID" \
    --data-binary @-
```

:::

作用域和 Project 之后不能更改。响应包含 `id`、`scope`、`project_id`、`name`、`metadata`、
`status`、`revision`、`purge_state` 和 `created_at`。

`listVaults` / `list_vaults` 返回你的 key 作用域内的 Vault。它接受 `cursor`、
`limit`（1–100）和 `status`（`active` 或 `archived`）；`has_more` 为 true 时，原样传回 `next_cursor`。

## 添加 credential {#add-a-credential}

::: code-group

```ts [TypeScript]
const credential = await client.createVaultCredential(
  vault.id,
  {
    name: 'tickets',
    purpose: 'mcp',
    provider_account_ref: `tickets-account-${user.id}`,
    auth: {
      type: 'static_bearer',
      mcp_server_url: 'https://mcp.example.com/tickets',
      access_token: userTicketsToken,
    },
  },
  { idempotencyKey: `credential-${user.id}-tickets` },
)
```

```python [Python]
credential = await client.create_vault_credential(
    vault["id"],
    {
        "name": "tickets",
        "purpose": "mcp",
        "provider_account_ref": f"tickets-account-{user_id}",
        "auth": {
            "type": "static_bearer",
            "mcp_server_url": "https://mcp.example.com/tickets",
            "access_token": user_tickets_token,
        },
    },
    idempotency_key=f"credential-{user_id}-tickets",
)
```

```bash [curl]
jq -n --arg ref "tickets-account-$USER_ID" --arg token "$USER_TICKETS_TOKEN" \
  '{name:"tickets", purpose:"mcp", provider_account_ref:$ref,
    auth:{type:"static_bearer", mcp_server_url:"https://mcp.example.com/tickets", access_token:$token}}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/vaults/$VAULT_ID/credentials" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: credential-$USER_ID-tickets" \
    --data-binary @-
```

:::

`provider_account_ref` 是你自己对 provider 处该账号的稳定引用。ZooWork 不会从 token 推导它。

| `auth.type` | 发送给 MCP Server 的内容 | 字段 |
|---|---|---|
| `static_bearer` | `Authorization: Bearer <access_token>` | `mcp_server_url`、`access_token`。 |
| `static_headers` | 原样发送给定的 header | `mcp_server_url`、`headers`（至少一个）。`Host`、`Content-Length`、`Connection`、`Cookie` 和 hop-by-hop header 会被拒绝。 |
| `mcp_oauth`，`refresh_owner: "external"` | `Authorization: Bearer <access_token>` | `mcp_server_url`、`access_token`、`expires_at`（必填；未知时为 `null`）。由你的应用刷新并轮换 token。 |
| `mcp_oauth`，`refresh_owner: "engine"` | `Authorization: Bearer <access_token>` | 同上，另加 `refresh`。由 ZooWork 刷新 token；见[让 ZooWork 刷新 OAuth token](#managed-refresh)。 |

credential 的 `mcp_server_url` 经规范化后必须与 Server 的 `url` 完全相等。
scheme 和 host 的大小写以及默认端口不影响比较；末尾的斜杠则有影响。
要更改 URL、账号或认证类型，请创建新的 credential。

## 用 Vault 启动 Session {#start-a-session-with-the-vault}

在普通的 `createSession` 请求中传入 Vault 字段。只要出现任何 Vault 字段，就必须提供 idempotency key。

::: code-group

```ts [TypeScript]
const session = await client.createSession(
  agentId,
  {
    isolation: 'session',
    vault_ids: [vaultId],
    external_user_ref: user.id,
    initial_events: [{ type: 'user.message', content: 'List my open tickets.' }],
  },
  `session-${conversationId}`,
)
await yourDb.sessions.insert({
  user_id: user.id,
  agent_id: agentId,
  session_id: session.session_id,
  binding_revision: session.vault_binding?.revision,
})
```

```python [Python]
session = await client.create_session(
    agent_id,
    {
        "isolation": "session",
        "vault_ids": [vault_id],
        "external_user_ref": user_id,
        "initial_events": [{"type": "user.message", "content": "List my open tickets."}],
    },
    idempotency_key=f"session-{conversation_id}",
)
await your_db.sessions.insert({
    "user_id": user_id,
    "agent_id": agent_id,
    "session_id": session["session_id"],
    "binding_revision": session["vault_binding"]["revision"],
})
```

```bash [curl]
jq -n --arg vault "$VAULT_ID" --arg user "$USER_ID" \
  '{isolation:"session", vault_ids:[$vault], external_user_ref:$user,
    initial_events:[{type:"user.message", content:"List my open tickets."}]}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: session-$CONVERSATION_ID" \
    --data-binary @-
```

:::

| 字段 | 含义 |
|---|---|
| `isolation` | `session` 或 `shared`。带 Vault 字段时必须发送。省略时目前记录为 `session`；服务端之后可能以 `400 vault.isolation_required` 拒绝这种省略，两个 SDK 都已强制要求传入。Agent 服务多个终端用户时使用 `session`；见[带凭据的 Session 能使用什么](#what-a-session-with-credentials-can-use)。 |
| `vault_ids` | 1–8 个唯一的 Vault ID，须对 Agent 所在的组织和 Project 可见。 |
| `credential_bindings` | 可选，最多 16 个 `{ server_name, credential_id }` 条目，每个 Server 一个。仅当所绑定的 Vault 中有多份 credential 匹配同一个 Server 时才需要。 |
| `external_user_ref` | 可选，最长 256 个字符的标签，会在 binding 上返回，供你自己对账。它不能更改，也不授予任何权限。 |
| `vault_binding_options` | 可选。`expires_at` 为 binding 设置截止时间（未来的时间，或用 `null` 表示不设截止）。`allow_delegate` 和 `allow_unattended` 必须为 `false`。 |

不用的 Vault 字段请全部省略。只要字段存在，即使是 `null` 或 `[]`，该请求也会被视为 Vault 请求。
带 Vault 字段时，`runtime_mode` 只能省略或为 `active`，
`config_version`、`skill_config_version` 和 `idle_compaction` 会被以 `400 invalid_request` 拒绝。

创建时，Agent 的每个 Vault Server 恰好获得一份 credential。
没有匹配 credential 的 Server 会使请求以 `409 vault.credential_missing` 失败；
有多份匹配时，请求以 `409 vault.credential_ambiguous` 失败，直到你在 `credential_bindings` 中指定其一。
所选 credential 不属于所绑定的 Vault，或与 Server URL 不匹配时，返回 `403 vault.binding_denied`。
选定的 credential 保持不变：之后加入 Vault 的 credential 不会被已有 Session 使用。

创建响应在通常的 Session 回执上增加以下字段：

```json
{
  "session_id": "0123456789abcdef0123456789abcdef",
  "isolation": "session",
  "project_id": "proj_…",
  "vault_ids": ["vlt_…"],
  "vault_binding": {
    "status": "unrevoked",
    "revision": 1,
    "profile": "session_isolated",
    "expires_at": null,
    "external_user_ref": "user-42",
    "credential_bindings": [
      { "server_name": "tickets", "vault_id": "vlt_…", "credential_id": "vcr_…" }
    ]
  }
}
```

binding 还包含 `id`、`root_binding_id`、`parent_binding_id`、`project_id`、`source`、
`session_id` 和 `schedule_id`。对于 Default Project 中的 Agent，`project_id` 为 `null`。
请把 `vault_binding.revision` 与 Session 一起保存：撤销和 offboarding 时需要传回它。
`getSession` 和 Session 列表返回 `isolation`；binding 由创建和撤销返回。

## 带凭据的 Session 能使用什么 {#what-a-session-with-credentials-can-use}

binding 的 `profile` 在创建 Session 时确定：

| `profile` | 适用情况 | 工具 |
|---|---|---|
| `session_isolated` | `isolation: "session"` | Agent 的 tool policy，在该 Session 自己的 workspace 和 Memory 内。配对设备的工具不可用。 |
| `shared` | `isolation: "shared"` | Agent 的 tool policy，与不带凭据的 Session 相同。该 Session 与其他所有 Session 共享 Agent 的 workspace、Memory 和 Artifacts。只用于只服务一个终端用户的 Agent。 |

[Session 隔离](./per-user-agents.md#session-isolation)说明了 `session` 隔离什么、不隔离什么。

在这两种 profile 中：

- Vault 凭据只会发送给声明了 `auth: { type: "vault" }` 的 MCP Server。
  sandbox 读不到它们，因此 Agent 运行的命令不能用它们调用 provider。
- 修改单个 Session 设置的请求，例如输入事件上的 `config_version`、Session 的模型、队列模式、
  idle compaction，或会改变状态的 Session 命令，返回 `403 vault.profile_restricted`。
  指令遵循 Agent 的当前配置。
- Agent 通过 `sessions_spawn` 派生的 Session 不会收到这些凭据。在 `session` Session 中，
  派生的 Session 与父 Session 共享 workspace 和 Memory，但不能使用 Vault MCP Server。

本 beta 不支持：

- 把凭据委托给派生的 Session 或 Schedule。Schedule 不能指向持有 Vault 凭据的 Session。
- 聊天渠道会话和 ZooWork 自己的应用。只有当你的后端通过 API 创建 Session 时，才接受 Vault 字段。
- 供 sandbox 中命令使用的凭据，或配置在 Environment 上的凭据。
- 延长 binding。binding 过期后，请创建新的 Session。

## Owner 的凭据不被隔离 {#owner-credentials}

::: danger 隔离不覆盖 Agent owner 的凭据
`isolation: "session"` 在 Session 之间隔离文件、Memory 和 Artifacts，但不隔离 Agent owner 的凭据。
无论是 `session` 还是 `shared` Session，模型在 sandbox 中运行的代码，以及以 owner 身份行动的内置工具，
仍然可以使用 owner 的平台身份、owner 已连接的 GitHub 凭据、owner 的浏览器登录状态，
以及 Agent 的模型计费 key。已有的 Skills 会保留这些凭据。

因此，你的某个用户的一次请求，可能导致以 owner 的权限执行操作。
不要向你的用户宣称 Vault Session 与 Agent owner 的账号是隔离的。
用 [`tool_policy`](./tools.md#用-tool-policy-收窄工具集)移除任务不需要的工具；
除非确有必要，不要把 owner 的账号连接到服务其他用户的 Agent 上。

Vault 凭据不受影响：它们不会进入 sandbox 环境。
:::

## 轮换并监控 credential {#rotate-and-monitor-a-credential}

通过 update 轮换 secret。先读取当前的 `revision`，它会作为 `If-Match` 发送。
下一次 MCP 连接或工具调用会使用新的 secret，已有 Session 无需重新创建。

::: code-group

```ts [TypeScript]
const current = await client.getVaultCredential(vaultId, credentialId)
await client.updateVaultCredential(
  vaultId,
  credentialId,
  { auth: { access_token: newToken } },
  { idempotencyKey: `rotate-${credentialId}-${tokenVersion}`, revision: current.revision },
)
```

```python [Python]
current = await client.get_vault_credential(vault_id, credential_id)
await client.update_vault_credential(
    vault_id,
    credential_id,
    {"auth": {"access_token": new_token}},
    idempotency_key=f"rotate-{credential_id}-{token_version}",
    revision=current["revision"],
)
```

```bash [curl]
jq -n --arg token "$NEW_TOKEN" '{auth:{access_token:$token}}' |
  curl -sS --fail-with-body \
    "$ZOOWORK_BASE_URL/vaults/$VAULT_ID/credentials/$CREDENTIAL_ID/update" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: rotate-$CREDENTIAL_ID-$TOKEN_VERSION" \
    -H "If-Match: $REVISION" \
    --data-binary @-
```

:::

对于 `static_headers`，发送 `{ "auth": { "headers": { … } } }`。对于 `mcp_oauth`，
还要随新 token 一起发送 `expires_at`（未知时为 `null`）。update 可以更改 `name`、secret 或两者；
不改的字段省略即可，不要为它发送 `null`。轮换之前已开始的调用，可能仍以旧 secret 完成。

### Credential 健康状态 {#credential-health}

每个 credential 响应都有 `health`。credential 不处于 active 状态时为 `null`，
否则为 `{ state, reason, retry_after }`：

| `state` | 含义 | 处理方式 |
|---|---|---|
| `ok` | 可用。 | 无需处理。 |
| `degraded` | ZooWork 的刷新正在退避，直到 `retry_after`。 | 等待；如果持续出现，请用户重新授权。 |
| `expired` | 静态或由应用刷新的 credential 已超过 `expires_at`。 | 轮换它。 |
| `reauthorization_required` | ZooWork 的刷新被阻塞；`reason` 为 `authorization_required` 或 `outcome_unknown`。 | 请用户重新授权，然后通过 update 提交新的材料。 |

任何其他值都视为不健康。SDK 辅助函数 `vaultCredentialHealthState` 和
`vault_credential_health_state` 对不认识的 state 返回 `unknown`。

### 校验 credential {#validate-a-credential}

`validateVaultCredential` / `validate_vault_credential` 用存储的 credential 探测 MCP Server。
它不改变任何内容，因此既不需要 idempotency key，也不需要 revision。
结果包含 `status`（`valid`、`invalid` 或 `unknown`）、`stage`（`resolve`、`connect` 或 `initialize`）、
`http_status`、`error_code`、`retryable`、`validated_at` 和 `request_id`。
它从不返回 provider 的响应体。已知已过期的 credential 会直接返回
`stage: "resolve"` 和 `error_code: "credential_expired"`，不发出请求。
校验不会刷新由 ZooWork 刷新的 token。

`valid` 表示 Server 接受了带该 credential 的 MCP `initialize` 请求。校验不会调用工具，所以 Server 仍然可能拒绝之后的工具调用。
除非 Server 返回了 HTTP 错误状态，否则 `http_status` 为 `null`。

### 让 ZooWork 刷新 OAuth token {#managed-refresh}

使用 `refresh_owner: "engine"` 时，ZooWork 会在 Session 需要时刷新过期的 access token，
并通过 `health` 报告问题。随 credential 发送一个 `refresh` 对象：

| 字段 | 说明 |
|---|---|
| `token_endpoint` | HTTPS token endpoint。 |
| `client_id` | OAuth client ID。 |
| `token_endpoint_auth` | `none`、`client_secret_basic` 或 `client_secret_post`。 |
| `client_secret` | 两种 `client_secret_*` 方式必填；`none` 时省略。 |
| `refresh_token` | refresh token。 |
| `resource`、`scope` | 可选。 |
| `rotates_refresh_token` | 创建时默认为 `true`。不能为 `null`。 |

`token_endpoint`、`client_id` 和 `token_endpoint_auth` 在首次提交后固定；
要更改它们，请创建新的 credential。不带 `refresh_owner` 的 update 保留已存储的 owner。
重新授权时，发送新的 `access_token`、`expires_at` 和 `refresh`；省略 `rotates_refresh_token` 则保留已存储的值。

不要让两个系统刷新同一个 refresh token。每个 credential 只选一个 owner。

## 撤销访问 {#revoke-access}

有三种方式可以让 Session 停止使用凭据。

**撤销单个 Session。** 发送创建时保存的 binding revision：

::: code-group

```ts [TypeScript]
const binding = await client.revokeSessionVaultBinding(agentId, sessionId, {
  idempotencyKey: `revoke-${sessionId}`,
  revision: storedRevision,
})
console.log(binding.status) // "revoked"
```

```python [Python]
binding = await client.revoke_session_vault_binding(
    agent_id,
    session_id,
    idempotency_key=f"revoke-{session_id}",
    revision=stored_revision,
)
print(binding["status"])  # "revoked"
```

```bash [curl]
curl -sS --fail-with-body --request POST \
  "$ZOOWORK_BASE_URL/agents/$AGENT_ID/sessions/$SESSION_ID/vault-binding/revoke" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H "Idempotency-Key: revoke-$SESSION_ID" \
  -H "If-Match: $BINDING_REVISION"
```

:::

撤销之后，Session 仍可读取，其 Artifacts 也仍可读取。新的消息、tool result 或非拒绝类的审批会返回
`409 vault.binding_revoked`；中断和显式拒绝仍然有效。binding 已过期的 Session 在相同位置返回
`409 vault.binding_expired`。该路由返回 `404` 可能表示 Agent 或 Session 未知，
或者 Session 没有 Vault 凭据。

**归档或删除用户自己的 Vault 或 credential。** 下一次需要它的 MCP 连接或调用，
会在所有使用它的 Session 中失败，其他用户的 Session 不受影响。
这些 Session 的其余部分继续工作。归档保留 metadata 并报告 `purge_state`；
删除返回 `204`，之后的读取返回 `404`。两者都不能撤销。归档或删除 Vault 后，其中的每个 credential 也随之停止使用，不需要先逐个移除。

::: code-group

```ts [TypeScript]
const vault = await client.getVault(vaultId)
await client.deleteVault(vaultId, {
  idempotencyKey: `delete-vault-${vaultId}`,
  revision: vault.revision,
})
```

```python [Python]
vault = await client.get_vault(vault_id)
await client.delete_vault(
    vault_id,
    idempotency_key=f"delete-vault-{vault_id}",
    revision=vault["revision"],
)
```

```bash [curl]
curl -sS --fail-with-body --request DELETE "$ZOOWORK_BASE_URL/vaults/$VAULT_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" \
  -H "Idempotency-Key: delete-vault-$VAULT_ID" \
  -H "If-Match: $REVISION"
```

:::

`deleteVaultCredential` / `delete_vault_credential` 以同样的方式接收 Vault ID、credential ID 和该 credential 的 `revision`。

**删除 Session。** 见 [Session 操作](./session-operations.md#delete-a-session)。

撤销不具有追溯效力。在撤销、归档或删除提交之前已被受理的调用，仍可能完成。

### 用户离职（offboarding） {#offboard-a-user}

用户离开时，如果他们的 Session 与其他用户共享同一个 Vault，请撤销他们的每个 Session。
ZooWork 不记录哪些 Session 属于哪个用户，所以要从你自己的记录中发送列表。
offboarding 路由会记录该列表，返回 `202`，并在后台持续重试每个撤销。

::: code-group

```ts [TypeScript]
const sessions = await yourDb.sessions.findByUser(user.id)
const ledger = await client.createVaultOffboarding(
  {
    sessions: sessions.map((s) => ({
      agent_id: s.agent_id,
      session_id: s.session_id,
      revision: s.binding_revision,
    })),
    external_user_ref: user.id,
  },
  { idempotencyKey: `offboard-${user.id}` },
)

let current = ledger
while (current.status === 'in_progress') {
  await new Promise((resolve) => setTimeout(resolve, 30_000))
  current = await client.getVaultOffboarding(ledger.id)
}
```

```python [Python]
import asyncio

sessions = await your_db.sessions.find_by_user(user_id)
ledger = await client.create_vault_offboarding(
    {
        "sessions": [
            {
                "agent_id": s["agent_id"],
                "session_id": s["session_id"],
                "revision": s["binding_revision"],
            }
            for s in sessions
        ],
        "external_user_ref": user_id,
    },
    idempotency_key=f"offboard-{user_id}",
)

current = ledger
while current["status"] == "in_progress":
    await asyncio.sleep(30)
    current = await client.get_vault_offboarding(ledger["id"])
```

```bash [curl]
jq -n --arg agent "$AGENT_ID" --arg session "$SESSION_ID" --arg user "$USER_ID" \
  --argjson revision "$BINDING_REVISION" \
  '{sessions:[{agent_id:$agent, session_id:$session, revision:$revision}], external_user_ref:$user}' |
  curl -sS --fail-with-body "$ZOOWORK_BASE_URL/vault-offboardings" \
    -H "Authorization: Bearer $ZOOWORK_API_KEY" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: offboard-$USER_ID" \
    --data-binary @-

curl -sS --fail-with-body "$ZOOWORK_BASE_URL/vault-offboardings/$OFFBOARDING_ID" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

一个请求列出 1–100 个 Session；`revision` 默认为 `1`。在生产代码中，请为轮询循环设置截止时间；
即使你停止读取，服务也会继续重试。

| Ledger `status` | 含义 |
|---|---|
| `in_progress` | 至少还有一个 Session 处于 `pending`。 |
| `completed` | 每个 Session 都已 `revoked`。 |
| `incomplete` | 至少有一个 Session 最终为 `not_found` 或 `failed`。 |

`sessions` 中的每个条目都有 `state`、尝试次数、`last_code` 和 `attempt_log`。
`not_found` 表示经过多次尝试，仍无法用该 key 找到对应的 Agent 或 Session；
它**不是**撤销。请自行检查这些 Session。`failed` 表示被拒绝（例如 `vault.revision_conflict`）或重试已耗尽。
同一组织和 Project 的 key 都可以读取该 ledger，它会把操作者记录为 `actor_ref`，并附带 `correlation_id`。ledger 作为这次请求的记录保留，没有删除它的路由。

## Idempotency key 与 revision {#idempotency-keys-and-revisions}

- 除 validate 外，每次写入都需要 1–256 个字符的 `Idempotency-Key`。每个逻辑操作使用一个 key，
  遇到超时或 `503 vault.unavailable` 重试时原样复用。
  同一个 key 搭配不同的请求会返回 `409 vault.idempotency_conflict`。
  key 的作用域是你的组织和 Project。
- update、archive、delete 和 revoke 还需要把资源当前的 `revision` 作为十进制 `If-Match` header 发送。
  revision 过期返回 `412 vault.revision_conflict`：重新读取，再决定如何处理。
- 重试的 delete 如果返回 `404 vault.not_found`，说明它已经成功。

SDK 方法接受 `idempotencyKey` / `idempotency_key` 和 `revision`，并发送这些 header。

## 限制 {#limits}

| 项目 | 限制 |
|---|---|
| 一个 Session 绑定的 Vault 数 | 8 |
| `credential_bindings` 条目数 | 16 |
| 每个 Vault 的 active credential 数 | 100 |
| Vault 或 credential 的 `name` | 256 个字符 |
| Vault `metadata` | 8 KiB JSON |
| 列表页大小 | 1–100 |
| 每个 offboarding 请求的 Session 数 | 100 |

## 错误 {#errors}

Vault 路由返回 `{ "code": "vault.…", "detail": … }`。每个错误码、它的原因，以及 Session 路由上 binding 错误的形状，
见[错误](../reference/errors.md#vault-errors)。

## 相关 {#related}

- [每用户一个 Agent](./per-user-agents.md)——Session 隔离，以及何时使用独立的 Agents。
- [MCP Server](./mcp.md)——连接要求、工具选择和目录。
- [风险与边界](../security/risks-and-boundaries.md)——凭据和数据存放在哪里。
- [TypeScript SDK](../reference/typescript-sdk.md#vault-beta)和 [Python SDK](../reference/python-sdk.md#vault-beta)——方法签名。
