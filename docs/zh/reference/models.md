---
description: 从当前模型目录选择可用alias，并处理生命周期变化。
source: /en/reference/models
source_hash: 2af2c22cbb518973272783a5d3e3834c29bfe7659381d6e0bf2eeb7974dcd5d4
---

# Models

选择 Agent 的模型前，先读取 model catalog。目录反映 key 所调用 deployment 的配置。使用目录中可选择的 alias。

## 列出模型

::: code-group

```ts [TypeScript]
const models = await client.listModels()
console.log(models)
```

```python [Python]
models = await client.list_models()
print(models)
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY"
```

:::

SDK 配置与 HTTP 示例使用的变量见 [Authentication](../get-started/authentication.md)。

从可选择的条目中取 `model` alias，创建 Agent 时设为 `resource.model.primary`。省略模型会选中创建时生效的 platform default。需要确定性的配置时，显式指定 alias。

## 读取目录元数据

| 字段 | 用法 |
|---|---|
| `model` | Agent 配置使用的 alias。 |
| `display_name`、`family` | 展示元数据，不能替代 alias。 |
| `input` | 声明的输入类型，不表示已有对应 upload API，也不保证支持所有文件格式。 |
| `context_window_tokens` | 返回时表示目录中的 context capacity，不是 Session history retention 上限。 |
| `selectable` | 为 `false` 时不能用于新的选择，即使仍保留给已有引用。 |
| `lifecycle_status`、`expired_at`、`retired_at`、`retire_not_before` | 返回时表示生命周期元数据；保留未来可能出现的新状态值。 |
| `expired_fallback_to` | 返回时表示建议的替代 alias，选择前仍需读取它的目录条目。 |
| `revision`、`default_for` | 返回时表示目录版本及默认类别元数据。 |

`default_for` 表示 Agent 配置槽位，例如 `model`、`imageModel`、`imageGenerationModel`、`pdfModel`；fallback 条目可能带 `.fallbacks.N` 后缀。它不表示输入类型。选择默认聊天模型时查找 `model`，不要查找 `text`。以当前 catalog 为准，不要固定某个槽位的模型名称。

遇到 `409 model_not_selectable`，刷新目录并选择可用 alias。原样重试 create 或 update 无法解决这个问题。

支持的输入输出流程见[文件与产物](../build/files.md)，消耗查询见 [Usage](./usage.md)。

## 下一步

[Agent 配置](../build/agents.md)说明模型配置和生命周期。[错误与重试](./errors.md)说明选择失败时的处理。
