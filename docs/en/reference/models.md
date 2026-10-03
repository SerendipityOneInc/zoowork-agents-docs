---
description: Select an available model from the catalog and handle lifecycle changes without hardcoding a model list.
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

On `409 model_not_selectable`, refresh the catalog and select an available alias. Repeating the same create or update unchanged will not fix it.

Use [Files and artifacts](../build/files.md) for supported input/output flows and [Usage](./usage.md) for consumption queries.

## Next steps

[Agent configuration](../build/agents.md) explains model configuration and lifecycle. [Errors and retries](./errors.md) explains selection failures.
