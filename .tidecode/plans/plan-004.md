---
status: draft
---

# Fix remaining CLI desktop handoff review findings

## Objective

Close the remaining issues found after the `plan-003` implementation while preserving the completed model/provider desktop handoff, API-key prefill, dialog remount behavior, and CLI model selection.

## Review findings

### 1. Medium — disconnected Codex accounts are still treated as a usable/configured provider in CLI paths

Verified behavior:

- `electron/providers/codex/service.ts::disconnectCodexProvider()` deletes active Codex auth but leaves stored account summaries intact.
- `getCodexProviderStatus()` can therefore return `accounts.length > 0` while `isAuthenticated === false`.
- Desktop model availability correctly uses `providersState.codex.isAuthenticated` in `src/components/settings/models/modelViewUtils.ts`.
- CLI availability still uses account-count semantics in several places:
  - `electron/cli/cliModelCommand.ts::getDesktopCompatibleProviderIdsFromStore()` passes `codex.accounts.length > 0` into `getDesktopCompatibleProviderIds()`.
  - `electron/cli/models.ts::getTideCodeSystemModels()` adds `codex` to configured providers when `codexStatus.accounts.length > 0`.
  - `electron/cli/cliProviderCommand.ts::readProviderSnapshot()` sets `codexConnected` from `codex.accounts.length > 0`.
- The Codex runtime itself requires active authentication: `electron/chat/codex/client.ts::resolveCodexAuthData()` fails with “Codex is not connected” when `maybeRotateCodexAccountForChat()` returns no active auth.

Consequences:

- After disconnecting Codex while saved accounts remain, `/model add` can route to Models even though the desktop does not consider Codex configured.
- `/model` can still list/select Codex models, but the next Codex chat fails as not connected.
- `/provider` can show Codex as ready even though active auth is absent.

Required changes:

- Use `codex.isAuthenticated` as the CLI definition of an actively configured/usable Codex provider everywhere provider availability is evaluated.
- In `cliModelCommand.ts`, change the store-backed availability call to pass `codex.isAuthenticated`; update the fallback object returned by `.catch()` accordingly.
- In `models.ts`, add Codex to `configuredProviders` only when `codexStatus.isAuthenticated === true`.
- In `cliProviderCommand.ts`, set `codexConnected` from `codex.isAuthenticated`; update the fallback shape accordingly.
- Keep stored account summaries available for the desktop account-management UI; do not delete accounts merely to make CLI state match.

Tests:

- Add a regression case representing `accounts: [saved account]` with `isAuthenticated: false` and assert Codex is not considered desktop-compatible/CLI-usable.
- Add coverage for authenticated Codex remaining available.
- If practical, factor the Codex-availability predicate into a tiny pure helper used by the three CLI call sites so the regression is directly testable without Electron mocking.

### 2. Medium/Low security — expired or abandoned API-key handoff files can remain on disk indefinitely

Verified behavior:

- `electron/cli/apiKeyHandoff.ts` writes the API key in plaintext JSON under `~/.tidecode/config/cli-api-key-handoffs` with a 30-second `expiresAt` and restrictive permissions.
- Successful consume is one-shot: the file is renamed, read, and deleted.
- Spawn/setup failures call `discardApiKeyHandoff()`.
- Expired records are rejected and deleted only when `consumeApiKeyHandoff()` is actually attempted.
- There is no directory sweep for handoffs that are never consumed (for example: CLI/process crash after creation, desktop crash before renderer consumption, or an abandoned launch).

Consequences:

The logical TTL prevents later API use, but the raw credential can still remain physically readable in the protected handoff directory long after expiry. That contradicts the intended ephemeral-secret design.

Required changes:

- Add `cleanupExpiredApiKeyHandoffs()` to `electron/cli/apiKeyHandoff.ts`.
- Restrict cleanup to the dedicated handoff directory.
- Remove expired `.json` records based on their validated `expiresAt` value.
- Also handle malformed/stale files conservatively: use file age as a fallback and only delete entries older than a safe threshold so a currently active handoff cannot be removed.
- Clean stale `.consuming-*` remnants left by an interrupted consumer when they are older than the same safe threshold.
- Invoke cleanup before creating a new handoff and once during desktop app startup/IPC registration so abandoned secrets are removed even if no later `/provider add` occurs.
- Cleanup failures should not block ordinary startup; log or ignore them without exposing file contents/API keys.

Tests:

- Verify an expired, never-consumed handoff is removed by cleanup.
- Verify a fresh handoff is preserved.
- Verify malformed old files are removed while malformed fresh files are left alone.
- Verify stale `.consuming-*` remnants are removed.
- Preserve the existing one-shot and expired-consume tests.

### 3. Low — failed API-key handoff consumption is silent in the Providers UI

Verified behavior:

- `ProvidersSettingsPanel` converts `consumeApiKeyHandoff(...)` failure/expiry to `null` and opens the custom-provider dialog without the key.
- The launch request is then acknowledged normally.

Consequence:

If the handoff expires or cannot be read, the user sees an empty API-key field with no indication that the requested prefill failed.

Required change:

- When `launchRequest.apiKeyHandoffToken` is present but consumption returns `null`, open the provider dialog as today but show a concise local warning such as “The API key could not be transferred; enter it again.”
- Do not log the token or key.
- Do not block provider setup.

## Files to modify

- `electron/cli/cliModelCommand.ts`
- `electron/cli/models.ts`
- `electron/cli/cliProviderCommand.ts`
- `electron/cli/apiKeyHandoff.ts`
- `electron/ipc/registerAppIpcHandlers.ts` or the nearest desktop startup path for best-effort stale-handoff cleanup
- `src/components/settings/providers/ProvidersSettingsPanel.tsx`
- `tests/cli/apiKeyHandoff.test.ts`
- `tests/cli/cliModelCommand.test.ts` and/or a focused Codex availability test

## Preserve

- API keys must remain out of process argv and Electron renderer `additionalArguments`; only the random handoff token may be serialized.
- `/provider add` name/base-URL/API-key prefill remains supported.
- `/model add <provider>` must never silently substitute a different provider.
- Repeated external requests must continue remounting the relevant dialog with fresh initial state.
- Environment-only API-key providers remain excluded from desktop Add Model routing unless desktop `ProvidersState` is explicitly extended to represent them.
- CLI custom-model save/edit/remove forms remain removed.

## Verification

- Run `npm run typecheck`.
- Run `npm test`.
- Manually verify:
  - disconnect Codex while one or more stored Codex accounts remain, then confirm `/provider` reports Codex not connected and `/model` does not offer Codex as configured;
  - `/model add` with only disconnected stored Codex accounts routes to provider setup instead of Models;
  - authenticated Codex still appears and works normally;
  - an abandoned API-key handoff is removed after TTL on the next desktop startup or handoff creation;
  - a valid API-key handoff still prefills the provider dialog;
  - an expired/missing handoff opens the dialog with a visible non-secret warning rather than silently losing the prefill.

## Definition of done

- CLI and desktop use active Codex authentication, not stored-account count, as the configured/usable Codex predicate.
- No expired/abandoned API-key handoff secret remains indefinitely in the dedicated handoff directory.
- Failed API-key prefill is visible but non-blocking.
- All `plan-003` fixes remain intact and tests/typecheck pass.
