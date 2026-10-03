---
description: 在 ZooWork Platform 获取 API key、充值，并配置第一个 SDK 或 HTTP 请求。
source: /en/get-started/authentication
source_hash: 11b6c69833879c941afa1a1371d1a5337d5bb4c4a28f63b12aec3c02c4102bdc
---

# Authentication 与 API key

在 [ZooWork Platform](https://platform.zoowork.ai) 创建 API key，为组织充值，再从应用后端使用这个 key。

## 获取 API key

1. 登录 [ZooWork Platform](https://platform.zoowork.ai)。
2. 从侧栏选择 Project。第一个任务使用 **Default Project** 即可。
3. 打开 **API keys**，选择 **Create API key**，输入应用名称，再选择 **Create key**。
4. 在 **Save your API key** 中复制 secret。secret 只显示一次，key 列表不会再次显示完整值。
5. 将 key 保存到应用的 secret 配置中。

key 由组织 owner 创建。如果使用的组织不归你所有，请组织 owner 创建 key。

## 充值

运行 Agent 任务前，先为组织的预付余额充值：

1. 打开账户菜单，选择 **Organization settings**，再选择 **Billing**。
2. 选择 **Add funds** 并选择金额。需要自定义金额时，选择 **Other**，并在页面显示的限制内输入金额。
3. 选择 **Buy Credits**，在 Stripe Checkout 完成付款。
4. 返回 **Billing**，确认 **Current balance** 已更新，再运行任务。付款确认和余额更新可能在不同时间完成。

组织内所有 Project 共用这笔余额。组织 admin 可以查看余额和充值。创建 key 不会为余额充值。

## 使用 SDK

在服务器或本地开发终端中设置 key：

```bash
export ZOOWORK_API_KEY='zwp_live_...'
```

两个 SDK 都读取这个变量。[安装 SDK](./quickstart.md#准备) 后，创建 client 并发送请求：

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

SDK 已提供 API 地址，正常使用无需配置。需要覆盖时，见 [TypeScript 配置](../reference/typescript-sdk.md#zooworkconfig) 或 [Python 配置](../reference/python-sdk.md#配置)。

## 使用 HTTP

运行 curl 示例时，在同一个终端中设置一次公共 API base URL。它包含 `/service/v1`：

```bash
export ZOOWORK_BASE_URL='https://clawapi.ecap.gsmo.ai/service/v1'
```

HTTP 请求使用 Bearer header。其他指南复用这些变量：

```bash
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

## Key 的范围与安全

key 对应一个组织和一个 Project。ZooWork 从 key 派生 Agent 的 ownership；创建 Agent 时不要传入 ownership。资源存在，但不在 key 的组织、Project 或 owner 范围内，也可能返回 404。

将 key 保存在后端。应用需要先认证自己的用户，再检查用户是否有权访问目标 Agent 和 Session，之后才代表用户发送请求。API key 不能代替这些检查。

key 可以访问 Agent 及其可用子资源、Models 和 Usage。Skill registry 发布要求服务端支持，并遵循 key 对应的 [Skill 写权限](../build/skills.md#api-availability)。自定义 Environment 和原生聊天渠道仍未向 Platform API key 开放。调用前请查阅[可用性与限制](../reference/capabilities.md)。

## 替换或撤销 key

需要替换 key 时，先创建新 key，保存 secret 并更新应用，再到 **API keys** 撤销之前的 key。撤销会阻止后续认证，但不会删除 key 生效期间创建的 Agent、Session 或文件。

遇到认证或 billing 错误时，按[错误与重试](../reference/errors.md)处理，不要反复发送相同请求。

## 下一步

- [快速开始](./quickstart.md)：创建 Agent 并运行第一个任务。
- [Usage](../reference/usage.md)：查询归属于 key 的消耗。
- [每用户一个 Agent](../build/per-user-agents.md)：隔离用户 workspace，并落实应用访问检查。
