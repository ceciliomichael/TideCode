---
status: draft
---

# Post-implementation review fixes

## Objective

Keep the intended CLI → desktop model/provider handoff, including provider name/base URL/API-key prefill, while correcting four issues found in review.

## Findings and required changes

1. **High — do not transport API keys in process argv.** `cliProviderCommand.ts` currently puts `apiKey` in `TideCodeLaunchRequest`; `desktopAppLaunch.ts` serializes the request into the spawned TideCode command line; on cold start `createApplicationWindow.ts` copies it again into renderer `additionalArguments`, and preload reads it from `process.argv`. Preserve API-key prefill, but move the secret to a one-shot secure handoff (random token + owner-only/ACL-protected file under the shared `~/.tidecode/config` area, read/delete once by main process, short TTL). Keep only non-secret navigation/name/base URL data in argv. Also redact the API key from CLI composer history if `/provider add ... <apiKey>` remains supported.

2. **Medium — align provider availability between CLI and desktop.** `electron/cli/models.ts` counts environment-only API keys as configured, while desktop `modelViewUtils.ts` only considers `ProvidersState` built from stored provider config plus Codex. Therefore `/model add` can route to Models while the desktop has zero selectable providers and consumes the request without opening a dialog. Change `cliModelCommand.ts::hasConfiguredProvider()` to use desktop-compatible availability semantics (stored configured providers + Codex), or separately teach `ProvidersState` about environment-backed providers.

3. **Medium — never silently substitute a requested provider.** `getModelAddLaunchRequest()` checks whether any provider is configured, but `ModelsSettingsPanel` falls back from an unavailable requested provider to `configuredProviders[0]`. `/model add anthropic` can therefore open OpenAI if only OpenAI is configured. Validate the requested provider specifically; only use first-provider fallback when no provider was requested. If the requested provider is unavailable, route to Providers/setup or show a clear error.

4. **Medium/Low — remount dialogs for repeated external requests.** `ProviderConfigDialog` and `UserModelDialog` initialize form state from props only on mount. A second CLI launch request while a dialog is already open can be acknowledged without updating provider/prefill values. Add a per-request dialog instance key/version in `ProvidersSettingsPanel` and `ModelsSettingsPanel` and use it as the React `key` so every accepted external request gets a fresh form instance.

## Tests

Add regression coverage for environment-only provider routing and unavailable requested providers. Keep existing serialization/executable-candidate tests. Manually verify packaged cold-start and second-instance flows, repeated `/model add` and `/provider add` while dialogs are already open, and confirm API keys do not appear in TideCode main/renderer process command lines.

Run `npm run typecheck` and `npm test` after the fixes.

## Definition of done

- CLI custom-model wizard remains removed.
- Intended provider prefill remains, including API key, but secrets never travel in argv or renderer `additionalArguments`.
- `/model add` only targets a desktop provider that the Models page can actually use.
- Requested providers are never silently replaced.
- Repeated external requests refresh the open dialog with new initial state.
- Cold-start, second-instance, model switching, legacy model-management redirects, and existing provider setup/edit/remove continue working.
