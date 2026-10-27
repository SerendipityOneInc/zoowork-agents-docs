---
description: 选择模型 alias、读取 thinking 能力并处理模型生命周期变化。
source: /en/reference/models
source_hash: 148d292db97698f96f63a0189b9270752d2914cafcead5464be703257c92dfd1
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
| `thinking.default`、`thinking.levels` | 模型默认档位，以及该模型可以实际区分的档位。 |

`default_for` 表示 Agent 配置槽位，例如 `model`、`imageModel`、`imageGenerationModel`、`pdfModel`；fallback 条目可能带 `.fallbacks.N` 后缀。它不表示输入类型。选择默认聊天模型时查找 `model`，不要查找 `text`。以当前 catalog 为准，不要固定某个槽位的模型名称。

目录顺序不代表偏好，第一个 selectable 的条目也不是平台默认模型。按 `default_for` 或明确的 alias 选择模型，不要按位置选择。

遇到 `409 model_not_selectable`，刷新目录并选择可用 alias。原样重试 create 或 update 无法解决这个问题。

支持的输入输出流程见[文件与产物](../build/files.md)，消耗查询见 [Usage](./usage.md)。

## 读取 thinking 能力 {#thinking-capabilities}

每个目录条目都带有 `thinking: { default, levels }`。`levels` 按从低到高的顺序列出
该模型可以实际区分的档位。`default` 是 Agent 和平台都没有设置档位时使用的模型默认值。
平台默认值或安全覆盖设置可以改变实际档位，而不会改变目录中的这个值。

::: code-group

```ts [TypeScript]
const models = await client.listModels()
const selected = models.find(
  (model) => model.selectable !== false && model.default_for?.includes('model'),
)
console.log(selected?.thinking?.default, selected?.thinking?.levels)
```

```python [Python]
models = await client.list_models()
selected = next(
    model for model in models
    if model.get("selectable") is not False and "model" in (model.get("default_for") or [])
)
print(selected.get("thinking", {}).get("default"))
print(selected.get("thinking", {}).get("levels"))
```

```bash [curl]
curl -sS --fail-with-body "$ZOOWORK_BASE_URL/models" \
  -H "Authorization: Bearer $ZOOWORK_API_KEY" |
  jq '.[] | {model, thinking}'
```

:::

公开档位是 `off`、`low`、`medium`、`high` 和 `max`。请求的档位不在模型的 `levels` 中时，
会取最近的可用档位；距离相同时取较高的一档。线路没有推理开关的模型可能只列出 `medium`，
不支持推理的模型只列出 `off`。模型没有 `off` 时，请求 `off` 会使用它的最低可用档位。
读取当前目录条目即可，无需自己维护一份模型系列对照表。

通过 [`model.thinking`](../build/agents.md#设置-thinking-档位) 设置或清除 Agent 默认值。

## 下一步

[Agent 配置](../build/agents.md)说明模型配置和生命周期。[错误与重试](./errors.md)说明选择失败时的处理。
