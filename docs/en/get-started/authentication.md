---
description: Get an API key from ZooWork Platform, add funds, and configure your first SDK or HTTP request.
---

# Authentication and API keys

Create an API key in [ZooWork Platform](https://platform.zoowork.ai), add funds to your organization, and use the key from your application's backend.

## Get an API key

1. Sign in to [ZooWork Platform](https://platform.zoowork.ai).
2. Select a Project from the sidebar. Use **Default Project** for your first task.
3. Open **API keys**, select **Create API key**, enter a name for your application, and select **Create key**.
4. Copy the secret from **Save your API key**. It is shown once; the key list does not reveal it again.
5. Save the key in your application's secret configuration.

Keys are created by the organization owner. If you are using an organization you do not own, ask its owner to create the key.

## Add funds

Before running Agent tasks, add funds to your organization's prepaid balance:

1. Open the account menu, select **Organization settings**, then select **Billing**.
2. Select **Add funds** and choose an amount. Select **Other** to enter a custom amount within the displayed limits.
3. Select **Buy Credits** and complete the payment in Stripe Checkout.
4. Return to **Billing** and confirm that **Current balance** has updated before running your task. Payment confirmation and the balance update can complete at different times.

Funds are shared by all Projects in the organization. Organization admins can view the balance and add funds. Creating a key does not add funds to the balance.

## Use the SDK

Set your key on the server or in your local development terminal:

```bash
export ZOOWORK_API_KEY='zwp_live_...'
```

Both SDKs read this variable. After [installing the SDK](./quickstart.md#set-up), create a client and make a request:

::: code-group

```ts [TypeScript]
import { createZooworkClient } from '@zoowork-ai/sdk'

const client = createZooworkClient()
console.log(await client.listModels())
```

```python [Python]
import asyncio
from zoowork import create_zoowork_client

async def main() -> None:
    async with create_zoowork_client() as client:
        print(await client.list_models())

asyncio.run(main())
```

:::

The SDK supplies the API address. You do not need to configure it for normal use. See the [TypeScript configuration](../reference/typescript-sdk.md#zooworkconfig) or [Python configuration](../reference/python-sdk.md#configuration) if you need to override it.

## Use HTTP

For curl examples, also set the public API base URL once in the same terminal. It includes `/service/v1`:

```bash
export ZOOWORK_BASE_URL='https://clawapi.ecap.gsmo.ai/service/v1'
```

HTTP requests authenticate with a Bearer header. Other guides reuse these variables:

```bash
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

## Key scope and security

The key selects an organization and a Project. ZooWork derives Agent ownership from it; do not supply ownership when creating an Agent. Resources outside the key's organization, Project, or owner scope can return 404 even when they exist.

Keep the key in your backend. Authenticate your application's users and authorize their access to each Agent and Session before making requests on their behalf. The API key does not replace these checks.

Keys support Agents and their available subresources, Models, and Usage. Some management resources, including custom Environments, Skill registry publishing, and native chat channels, are not exposed to Platform API keys. See [Availability and limits](../reference/capabilities.md) before using these methods.

## Replace or revoke a key

To replace a key, create a new one, save its secret, update your application, and revoke the previous key in **API keys**. Revocation prevents further authentication; it does not delete the Agents, Sessions, or files created while the key was active.

For authentication or billing errors, follow [Errors and retries](../reference/errors.md) instead of repeatedly sending the same request.

## Next steps

- [Quickstart](./quickstart.md): create an Agent and run your first task.
- [Usage](../reference/usage.md): query usage attributed to your key.
- [An agent per user](../build/per-user-agents.md): separate user workspaces and enforce application access.
