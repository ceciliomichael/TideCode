# Provider model catalogs

Each built-in provider has one editable JSON file in this folder. The Models settings page only shows entries from these files; it does not request a provider's `/models` endpoint.

Every entry accepts:

- `apiModelId`: exact model identifier sent to the provider.
- `id`: stable Echosphere identifier. Prefixing it with the provider name is recommended, except for Codex where the API model identifier is already used.
- `label`: name shown in the interface.
- `enabledByDefault`: whether the model initially appears in model pickers.
- `reasoningCapable`: whether the model exposes reasoning choices.
- `reasoningEfforts`: ordered choices shown in chat. Supported values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- `defaultReasoningEffort`: initial choice; it must also appear in `reasoningEfforts`.

Built-in providers use their native SDK request format. Custom providers are edited from the Providers page instead. Their Models JSON can add `reasoningBodies`, whose keys become the choices shown in chat and whose values are the exact request-body fragments sent for those choices:

```json
[
  {
    "apiModelId": "my-model",
    "label": "My model",
    "enabledByDefault": true,
    "reasoningCapable": true,
    "defaultReasoningEffort": "high",
    "reasoningBodies": {
      "none": { "thinking": { "type": "disabled" } },
      "high": { "thinking": { "type": "enabled" } }
    }
  }
]
```

Duplicate `apiModelId` values within one provider are ignored after the first match, case-insensitively.
