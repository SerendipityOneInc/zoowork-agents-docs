---
description: Select model aliases, inspect thinking capabilities, and handle model lifecycle changes.
---

# Models

Read the model catalog before selecting a model for an Agent. The catalog reflects the deployment your key calls. Use a selectable alias from that catalog.

## List models

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

For SDK setup and the variables used by the HTTP example, see [Authentication](../get-started/authentication.md).

Choose the `model` alias from a selectable row and set it as `resource.model.primary` when creating an Agent. Omitting the model selects the platform default active at creation time. Set an explicit alias when provisioning should be deterministic.

## Read catalog metadata

| Field | How to use it |
|---|---|
| `model` | Alias used in Agent configuration. |
| `display_name`, `family` | Display metadata; not a substitute for the alias. |
| `input` | Advertised input types. This does not establish an upload API or make every file format acceptable. |
| `context_window_tokens` | Catalog context capacity when supplied. Do not interpret it as a Session history retention limit. |
| `selectable` | `false` means the alias is unavailable for new selection, even if retained for existing references. |
| `lifecycle_status`, `expired_at`, `retired_at`, `retire_not_before` | Lifecycle metadata when supplied. Preserve unknown future status values. |
| `expired_fallback_to` | Suggested replacement alias when supplied; read its catalog row before selecting it. |
| `revision`, `default_for` | Catalog revision and default-category metadata when supplied. |
| `thinking.default`, `thinking.levels` | Model default and levels that take effect as named. |

`default_for` names Agent configuration slots, such as `model`, `imageModel`,
`imageGenerationModel`, and `pdfModel`; fallback entries can include a `.fallbacks.N` suffix.
It does not describe input modalities. For the primary chat default, look for `model`, not
`text`. Read the current catalog rather than hardcoding which model occupies a slot.

The catalog order is not a preference ranking, and the first selectable row is not the
platform default. Choose a model by `default_for` or by an explicit alias, not by position.

On `409 model_not_selectable`, refresh the catalog and select an available alias. Repeating the same create or update unchanged will not fix it.

Use [Files and artifacts](../build/files.md) for supported input/output flows and [Usage](./usage.md) for consumption queries.

## Read thinking capabilities {#thinking-capabilities}

Each catalog row carries `thinking: { default, levels }`. `levels` lists the levels that
produce distinct requests on that model, in ascending order. `default` is the model's level
when neither the Agent nor the platform sets one. A platform default or safety override can
change the effective level without changing this catalog value.

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

The public vocabulary is `off`, `low`, `medium`, `high`, and `max`. A level outside a model's
`levels` resolves to the nearest listed level, with ties going up. A model may list only
`medium` when its route has no thinking switch, or only `off` when thinking is unsupported.
A model without `off` uses its lowest listed level when you request `off`. Read the current
row instead of maintaining a separate model-family table.

Set or clear the Agent default through [`model.thinking`](../build/agents.md#set-the-thinking-level).

## Next steps

[Agent configuration](../build/agents.md) explains model configuration and lifecycle. [Errors and retries](./errors.md) explains selection failures.
