# Provider model catalogs

Each built-in provider has one editable JSON file in this folder. The Models settings page only shows entries from these files; it does not request a provider's `/models` endpoint.

Every entry accepts:

- `apiModelId`: exact model identifier sent to the provider.
- `id`: stable TideCode identifier. Prefixing it with the provider name is recommended, except for Codex where the API model identifier is already used.
- `label`: name shown in the interface.
- `enabledByDefault`: whether the model initially appears in model pickers.
- `reasoningCapable`: whether the model exposes reasoning choices.
- `reasoningEfforts`: ordered choices shown in chat. Supported values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- `defaultReasoningEffort`: initial choice; it must also appear in `reasoningEfforts`.
- `maxTokens`: the provider-documented maximum output-token limit for that exact model. Omit it when the provider publishes only a dynamic context limit instead of a fixed output limit; no application default is inferred.
- `supportsImageInput`: optional boolean for models whose provider capability differs from the provider default. When false, image references remain visible as text but binary image parts are omitted.

User-added models are managed from Settings → Models and are stored in one catalog per provider under `~/.tidecode/models`. Built-in provider catalogs remain read-only at runtime. Each user model owns its reasoning profile, so changing one model never changes another model from the same provider.

For custom OpenAI-compatible providers, the model dialog generates a validated `reasoning_effort` request fragment for each selected reasoning value. Existing provider Models JSON is migrated into the user catalog the first time this directory is created.

Duplicate `apiModelId` values within one provider are ignored after the first match, case-insensitively.
