---
description: "Beta: store each user's MCP credentials in a Vault, attach them to that user's Sessions, and revoke them when the user leaves."
---

# Vault (beta)

::: warning Beta
Vault is a beta feature. It needs a Platform API key and a deployment where Vault is enabled.
Where it is not available, the Vault routes answer `404 service_api.not_found` and a
`createSession` request with Vault fields answers `400 vault.session_fields_unavailable`.
TypeScript SDK 0.15.0 or later and Python SDK 0.10.0 or later raise `VaultBetaUnavailableError`
for both. Fields and behavior may change before general availability.
:::

A Vault stores credentials for an Agent's remote MCP servers. Your application saves a user's
MCP credential in a Vault, then creates that user's Session with the Vault attached. When the
Agent calls the matching MCP server in that Session, the platform sends that user's credential.

Responses never return a stored secret, and Vault credentials are not placed in the sandbox
environment. Before an MCP result or error is written to the Session, the platform removes the
credential's literal value from it. It cannot recognize a value the server returns in an
encoded form.

Use Vault when one Agent calls the same MCP server on behalf of several users, each with their
own account. For a service that only your backend can reach, use an
[application-executed custom tool](./tools.md#application-executed-custom-tools) instead.

Examples reuse the `client` from [Quickstart](../get-started/quickstart.md). Python calls run
inside an async function. For curl, complete the setup in
[Authentication](../get-started/authentication.md). `yourDb` and `your_db` stand for your own
data layer.

## How the pieces fit

| Resource | What it is |
|---|---|
| Vault | A container for credentials, in `org` or `project` scope. ZooWork does not model end users; to give each user their own credentials, create one Vault per user and record the mapping in your database. Vault `metadata` can carry your user ID. |
| Credential | One secret for one MCP server URL, with `purpose: "mcp"`. The URL, auth type, and `provider_account_ref` cannot change after creation. |
| Agent MCP server | A server in the Agent's `mcp` array declared with `auth: { type: "vault" }`. Only these servers receive Vault credentials. |
| Session binding | Created when a Session is created with `vault_ids`. It records which credential each Vault server uses for the life of the Session. |

A Session uses only the Vaults your application attaches. The model cannot choose, list, or
change Vaults or credentials. `external_user_ref` and `actor.ref` are labels; they do not grant
access to anything.

### Scopes and keys

| Scope | Managed with | Usable by |
|---|---|---|
| `project` | A named Project's key. `project_id` must be that Project's own `proj_…` ID. | Agents in the same Project. |
| `org` | A Default Project key. | Agents in any Project of the organization, including the Default Project. |

Every Vault route is a management route, reads included. A named Project key cannot read or
manage org Vaults (`403 vault.management_forbidden`), and a Default Project key does not see
project Vaults. Agents in the Default Project can use only org Vaults. A named Project's Agent
can use its own Project's Vaults and org Vaults.

The `proj_…` ID is the `ownership.project_id` of an Agent created with that Project's key; read
it with `getAgent()` / `get_agent()`.

## Declare the MCP server

Add `auth: { type: "vault" }` to the server in the Agent's configuration. The `url` must use
HTTPS and have no query string or fragment. The server must still meet the other
[MCP connection requirements](./mcp.md#connection-requirements).

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

The `mcp` array is replaced as a whole, so include every server the Agent should keep. A server
cannot declare both `auth` and `credential`. In a Session without Vault credentials, a Vault
server is not loaded. Other MCP servers keep working as declared in both kinds of Session.

## Create a Vault

Create a Vault for the user and save its ID in your user mapping. Every Vault write needs an
idempotency key; reuse it to retry the same operation.

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

For an org Vault, use a Default Project key and send `{ "scope": "org", "name": … }` without
`project_id`. Scope and project cannot change later. The response has `id`, `scope`,
`project_id`, `name`, `metadata`, `status`, `revision`, `purge_state`, and `created_at`.

`listVaults` / `list_vaults` returns the Vaults of your key's scope. It accepts `cursor`,
`limit` (1–100), and `status` (`active` or `archived`); pass `next_cursor` back unchanged while
`has_more` is true.

## Add a credential

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

`provider_account_ref` is your own stable reference to the account at the provider. ZooWork does
not derive it from the token.

| `auth.type` | Sent to the MCP server | Fields |
|---|---|---|
| `static_bearer` | `Authorization: Bearer <access_token>` | `mcp_server_url`, `access_token`. |
| `static_headers` | The headers as given | `mcp_server_url`, `headers` (at least one). `Host`, `Content-Length`, `Connection`, `Cookie`, and hop-by-hop headers are refused. |
| `mcp_oauth` with `refresh_owner: "external"` | `Authorization: Bearer <access_token>` | `mcp_server_url`, `access_token`, `expires_at` (required; `null` when unknown). Your application refreshes the token and rotates it. |
| `mcp_oauth` with `refresh_owner: "engine"` | `Authorization: Bearer <access_token>` | As above, plus `refresh`. ZooWork refreshes the token; see [Let ZooWork refresh an OAuth token](#managed-refresh). |

The credential's `mcp_server_url` must equal the server's `url` exactly after normalization.
Scheme and host case and a default port do not matter; a trailing slash does. To change the
URL, account, or auth type, create a new credential.

## Start a Session with the Vault

Pass the Vault fields with an ordinary `createSession` request. An idempotency key is required
when any Vault field is present.

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

| Field | Meaning |
|---|---|
| `isolation` | `session` or `shared`. Always send it with Vault fields. Use `session` when the Agent serves more than one end user; see [What a Session with credentials can use](#what-a-session-with-credentials-can-use). |
| `vault_ids` | 1–8 unique Vault IDs visible to the Agent's organization and Project. |
| `credential_bindings` | Optional, up to 16 `{ server_name, credential_id }` entries, one per server. Needed only when several credentials in the attached Vaults match the same server. |
| `external_user_ref` | Optional label of up to 256 characters, returned on the binding for your own reconciliation. It cannot change and grants nothing. |
| `vault_binding_options` | Optional. `expires_at` sets a deadline for the binding (a future time, or `null` for none). `allow_delegate` and `allow_unattended` must be `false`. |

Omit every Vault field you do not use. A field that is present, even as `null` or `[]`, makes
the request a Vault request. With Vault fields, `runtime_mode` can only be omitted or `active`,
and `config_version`, `skill_config_version`, and `idle_compaction` are refused with
`400 invalid_request`.

At creation, each Vault server of the Agent gets exactly one credential. A server with no
matching credential fails the request with `409 vault.credential_missing`, and several matches
fail it with `409 vault.credential_ambiguous` until you name one in `credential_bindings`. A
selection that does not belong to the attached Vaults or does not match the server URL is
`403 vault.binding_denied`. The selected credentials stay fixed: a credential added to the
Vault later is not used by existing Sessions.

The create response adds these fields to the usual Session receipt:

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

The binding also carries `id`, `root_binding_id`, `parent_binding_id`, `project_id`, `source`,
`session_id`, and `schedule_id`. `project_id` is `null` for an Agent in the Default Project.
Store `vault_binding.revision` with the Session: revoking it and offboarding send it back.
`getSession` and the Session lists return `isolation`; the binding is returned by creation and
by revoke.

## What a Session with credentials can use

The binding's `profile` is fixed when the Session is created:

| `profile` | When | Tools |
|---|---|---|
| `session_isolated` | `isolation: "session"` | The Agent's tool policy, inside the Session's own workspace and Memory. Paired-device tools are unavailable. |
| `shared` | `isolation: "shared"` | The Agent's tool policy, like a Session without credentials. The Session shares the Agent's workspace, Memory, and Artifacts with every other Session. Use it only for an Agent that serves one end user. |
| `restricted` | A deployment where those modes are not enabled | Only the Agent's MCP tools and `tool_search` / `tool_describe`. No sandbox, Memory, or other built-in tools. |

[Session isolation](./per-user-agents.md#session-isolation) describes what `session` separates
and what it does not.

In every profile:

- Vault credentials go only to MCP servers declared with `auth: { type: "vault" }`. The sandbox
  cannot read them, so commands the Agent runs cannot call the provider with them.
- Requests that change a per-Session setting, such as a `config_version` on an input event, the
  Session's model, queue mode, idle compaction, or a state-changing Session command, return
  `403 vault.profile_restricted`. Instructions follow the Agent's current configuration.
- Sessions the Agent spawns with `sessions_spawn` do not receive the credentials. In a
  `session` Session, a spawned Session shares the parent's workspace and Memory but cannot use
  the Vault MCP servers.

Not supported in this beta:

- Delegating credentials to spawned Sessions or to Schedules. A Schedule cannot target a
  Session that has Vault credentials.
- Chat channel conversations and ZooWork's own apps. Vault fields are accepted only when your
  backend creates a Session through the API.
- Credentials for commands in the sandbox, or credentials configured on an Environment.
- Extending a binding. When a binding expires, create a new Session.

## Owner credentials are not isolated {#owner-credentials}

::: danger Isolation does not cover the Agent owner's credentials
`isolation: "session"` separates files, Memory, and Artifacts between Sessions. It does not
separate the Agent owner's credentials. In `session` and `shared` Sessions alike, code that the
model runs in the sandbox, and built-in tools that act as the owner, can still use the owner's
platform identity, the owner's connected GitHub credentials, the owner's browser sign-in state,
and the Agent's model-billing keys. Existing Skills keep these credentials.

A request from one of your users can therefore lead to actions with the owner's authority. Do
not describe a Vault Session to your users as isolated from the Agent owner's accounts. Remove
tools that the task does not need with [`tool_policy`](./tools.md#narrowing-the-tool-set-with-tool-policy),
and do not connect owner accounts to an Agent that serves other users unless that access is
intended.

Vault credentials are not affected: they stay out of the sandbox environment.
:::

## Rotate and monitor a credential

Rotate a secret with an update. Read the current `revision` first; it is sent as `If-Match`.
The next MCP connection or tool call uses the new secret. Existing Sessions do not need to be
recreated.

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

For `static_headers`, send `{ "auth": { "headers": { … } } }`. For `mcp_oauth`, also send
`expires_at` with the new token (`null` when unknown). An update can change `name`, the secret,
or both; omit what you keep and never send `null` for it. A call that started before the
rotation can finish with the previous secret.

### Credential health

Every credential response has `health`. It is `null` when the credential is not active, and
otherwise `{ state, reason, retry_after }`:

| `state` | Meaning | What to do |
|---|---|---|
| `ok` | Usable. | Nothing. |
| `degraded` | ZooWork's refresh is backing off until `retry_after`. | Wait, or ask the user to re-authorize if it persists. |
| `expired` | A static or application-refreshed credential is past its `expires_at`. | Rotate it. |
| `reauthorization_required` | ZooWork's refresh is blocked; `reason` is `authorization_required` or `outcome_unknown`. | Ask the user to re-authorize, then submit new material with an update. |

Treat any other value as not healthy. The SDK helpers `vaultCredentialHealthState` and
`vault_credential_health_state` return `unknown` for a state they do not know.

### Validate a credential

`validateVaultCredential` / `validate_vault_credential` probes the MCP server with the stored
credential. It changes nothing, so it takes neither an idempotency key nor a revision. The
result has `status` (`valid`, `invalid`, or `unknown`), `stage` (`resolve`, `connect`, or
`initialize`), `http_status`, `error_code`, `retryable`, `validated_at`, and `request_id`. It
never returns the provider's response body. A credential already known to be expired returns
`stage: "resolve"` and `error_code: "credential_expired"` without a request. Validation does not
refresh a ZooWork-refreshed token.

### Let ZooWork refresh an OAuth token {#managed-refresh}

With `refresh_owner: "engine"`, ZooWork refreshes an expired access token when a Session needs
it, and reports problems through `health`. Send a `refresh` object with the credential:

| Field | Notes |
|---|---|
| `token_endpoint` | HTTPS token endpoint. |
| `client_id` | OAuth client ID. |
| `token_endpoint_auth` | `none`, `client_secret_basic`, or `client_secret_post`. |
| `client_secret` | Required for the two `client_secret_*` methods; omit it for `none`. |
| `refresh_token` | The refresh token. |
| `resource`, `scope` | Optional. |
| `rotates_refresh_token` | Defaults to `true` on creation. Never `null`. |

`token_endpoint`, `client_id`, and `token_endpoint_auth` are fixed after the first submission;
create a new credential to change them. An update without `refresh_owner` keeps the stored
owner. To re-authorize, send a new `access_token`, `expires_at`, and `refresh`; an omitted
`rotates_refresh_token` keeps the stored value. If refresh is
not available on your deployment, the request fails with `400 vault.unsupported_refresh_owner`;
use `refresh_owner: "external"` and rotate the token yourself.

Do not let two systems refresh the same refresh token. Choose one owner per credential.

## Revoke access

You have three ways to stop a Session from using credentials.

**Revoke one Session.** Send the binding revision you stored at creation:

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

After a revoke, reads of the Session still work, and its Artifacts can still be read. A new
message, tool result, or non-deny approval returns `409 vault.binding_revoked`; interrupts and
explicit denials still work. A Session whose binding expired returns
`409 vault.binding_expired` in the same places. A `404` from this route can mean an unknown
Agent or Session, a Session without Vault credentials, or Vault being unavailable.

**Archive or delete the user's own Vault or credential.** The next MCP connection or call that
needs it fails in every Session that uses it, and other users' Sessions are not affected. The
rest of those Sessions keeps working. Archive keeps the metadata and reports `purge_state`;
delete answers `204`, and later reads return `404`. Neither can be undone.

**Delete the Session.** See [Session operations](./session-operations.md#delete-a-session).

Revocation is not retroactive. A call admitted before the revoke, archive, or delete committed
can still complete.

### Offboard a user

When a user leaves and their Sessions share a Vault with other users, revoke each of their
Sessions. ZooWork does not track which Sessions belong to which user, so send the list from your
own records. The offboarding route records the list, answers `202`, and keeps retrying each
revoke in the background.

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

A request lists 1–100 Sessions; `revision` defaults to `1`. In production code, bound the
polling loop with a deadline; the service keeps retrying after you stop reading.

| Ledger `status` | Meaning |
|---|---|
| `in_progress` | At least one Session is still `pending`. |
| `completed` | Every Session is `revoked`. |
| `incomplete` | At least one Session ended `not_found` or `failed`. |

Each entry in `sessions` has a `state`, the attempt count, `last_code`, and an `attempt_log`.
`not_found` means the Agent or Session could not be found for the key after several attempts;
it is **not** a revocation. Check those Sessions yourself. `failed` means a refusal such as
`vault.revision_conflict`, or retries ran out. The ledger is readable with keys of the same
organization and Project, and records the operator as `actor_ref` with a `correlation_id`.

## Idempotency keys and revisions

- Every write except validate needs an `Idempotency-Key` of 1–256 characters. Use one key per
  logical operation and reuse it, unchanged, to retry a timeout or `503 vault.unavailable`.
  The same key with a different request is `409 vault.idempotency_conflict`. Keys are scoped to
  your organization and Project.
- Update, archive, delete, and revoke also need the resource's current `revision` as a decimal
  `If-Match` header. A stale revision is `412 vault.revision_conflict`: read again, then decide.
- A retried delete that answers `404 vault.not_found` has already succeeded.

The SDK methods take `idempotencyKey` / `idempotency_key` and `revision` and send these headers.

## Limits

| Item | Limit |
|---|---|
| Vaults attached to one Session | 8 |
| `credential_bindings` entries | 16 |
| Active credentials per Vault | 100 |
| Vault or credential `name` | 256 characters |
| Vault `metadata` | 8 KiB of JSON |
| List page size | 1–100 |
| Sessions per offboarding request | 100 |

## Errors

Vault routes answer `{ "code": "vault.…", "detail": … }`. On Session routes, binding errors
carry both the dotted code at the top level and the runtime code in `error.type`, for example
`"code": "vault.binding_revoked"` with `"error": { "type": "vault_binding_revoked" }`. The SDK's
`vaultSessionErrorCode` / `vault_session_error_code` accepts either spelling. The full list is
in [Errors](../reference/errors.md#vault-errors).

## Related

- [An agent per user](./per-user-agents.md) — Session isolation and when to use separate Agents.
- [MCP servers](./mcp.md) — connection requirements, tool selection, and catalogs.
- [Risks and boundaries](../security/risks-and-boundaries.md) — where credentials and data live.
- [TypeScript SDK](../reference/typescript-sdk.md#vault-beta) and [Python SDK](../reference/python-sdk.md#vault-beta) — method signatures.
