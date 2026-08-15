---
status: draft
---

# Move custom model management from CLI to desktop settings

## 1. Objective

Remove the multi-step custom-model configuration workflow from the TideCode CLI and make the CLI model experience selection-focused.

The requested final behavior is:

- `/model` continues to browse and switch among configured models, including custom models already stored in TideCode.
- The CLI no longer collects model IDs, labels, token limits, JSON bodies, reasoning settings, or image-capability settings through a sequence of terminal prompts.
- `/model add` and the interactive “add model” action launch/focus the TideCode desktop app and navigate directly to **Settings → Models** with the existing **Add model** dialog open when at least one provider is configured.
- If there is no configured provider available for a new model, the same add action launches/focuses the desktop app at **Settings → Providers** with the existing **Add custom provider** dialog open, so the user has an actionable setup path instead of a disabled Models screen.
- CLI custom-model edit/remove management is also moved out of the terminal so the removed form does not remain reachable through `/model edit` or the old “Manage custom models” menu. Legacy edit/remove command forms should redirect the user to desktop model settings rather than directly mutating the shared model store.
- The terminal “moving downward” behavior seen during custom-model creation is resolved by removing the long chain of sequential `helpers.input` / `helpers.select` prompts. Do not change the shared terminal input/redraw primitives as part of this task unless a separate reproduction shows they are broken outside this removed workflow.

## 2. Relevant Current Architecture

### Verified

- `electron/cli/cliModelCommand.ts` currently owns the complete CLI custom-model lifecycle:
  - provider selection;
  - model ID/name/max-token inputs;
  - custom-provider request JSON;
  - reasoning configuration;
  - image support;
  - save/edit/remove operations;
  - interactive custom-model management.
- The same file also handles normal `/model` browsing, direct model switching, list/help output, and the interactive model selector.
- `electron/cli/cliModelInput.ts` contains validation/parsing helpers used only by `cliModelCommand.ts`; its current tests live in `tests/cli/cliModelInput.test.ts`.
- Existing custom models are already included in the shared CLI model snapshot by `electron/cli/models.ts`, which reads the shared custom-model store and merges those models into `allModels` / `configuredModels`. Removing the CLI editor therefore does not remove the CLI’s ability to see or activate existing custom models.
- `src/components/settings/models/ModelsSettingsPanel.tsx` already owns the desktop **Add model**, edit, and remove flows and opens `UserModelDialog` with a configured provider.
- `src/components/settings/providers/ProvidersSettingsPanel.tsx` already owns **Add custom provider** and opens `ProviderConfigDialog` with the custom-provider schema.
- `src/pages/SettingsInterface.tsx` owns the active settings sidebar item. Providers is `settings-item2`; Models is `settings-item3` via `src/components/settings/settingsItems.ts`.
- `src/App.tsx` currently owns the top-level `chat | settings` screen state, but there is no external launch intent that can select a settings section or open a settings dialog.
- The packaged CLI already knows how to locate and start the installed desktop application: `electron/cli/cliUpdateCommand.ts` contains `findInstalledTideCodeExecutable()` and launches the executable with `spawn(..., { detached: true, stdio: 'ignore' })`.
- Electron already enforces a single desktop instance in `electron/main.ts`. The `second-instance` handler focuses an existing window, so a CLI-launched desktop request can reuse this path instead of creating another desktop instance.
- `electron/window/createApplicationWindow.ts` already uses `webPreferences.additionalArguments` to pass initial settings into the preload process.
- `electron/preload.ts` already exposes typed renderer APIs and subscribes to main-process events such as provider/update state changes; `electron/electron-env.d.ts` declares those APIs on `window`.
- The sequential terminal input primitive in `electron/cli/interactiveTextInput.ts` clears its region and writes a newline when each prompt finishes. A long custom-model wizard invokes that primitive repeatedly, making vertical movement especially visible. Other CLI configuration flows reuse the same primitive, so a global redraw change would broaden risk beyond this task.

### Recommended

Use a small, typed **desktop launch request** carried as a fixed TideCode command-line argument. The request should only describe a supported in-app destination/action, not an arbitrary URL or renderer route.

Recommended request shapes:

- Settings → Models, optionally `add-model`.
- Settings → Providers, optionally `add-custom-provider`.

The main process should parse the request on cold launch and in the existing `second-instance` callback. The preload should expose the cold-start request plus an event for subsequent launch requests. `App.tsx` / `SettingsInterface.tsx` should consume the request and convert it into the existing settings item IDs and dialog-opening signals.

This keeps the CLI independent from React internals while reusing the existing desktop dialogs as the single model-management UI.

## 3. Affected Files and Exploration Paths

### Must change

- `electron/cli/cliModelCommand.ts` — modify — remove custom-model form/edit/remove implementation; keep browse/switch/list behavior; add desktop-launch actions and legacy command redirects.
- `electron/cli/commands.ts` — modify — update `/model` description/usage so CLI help no longer advertises terminal-side custom-model editing/removal.
- `electron/cli/cliProviderCommand.ts` — modify — replace user-facing text that says `/model add` creates provider-specific models in the CLI; describe that `/model add` opens desktop model setup.
- `electron/cli/cliUpdateCommand.ts` — modify — stop privately owning the installed-desktop executable finder; reuse a shared CLI desktop-launch helper.
- `electron/main.ts` — modify — parse desktop launch requests on initial startup and `second-instance`, focus/show the desktop window, and deliver valid requests to the renderer.
- `electron/window/createApplicationWindow.ts` — modify — accept an optional initial launch request and append its serialized form to `webPreferences.additionalArguments` alongside initial settings.
- `electron/preload.ts` — modify — expose the initial launch request and a safe listener for subsequent `app:launchRequest` events.
- `electron/electron-env.d.ts` — modify — declare the new preload API on `Window`.
- `src/types/chat/apis.ts` — modify — add the typed renderer-facing app-launch API contract, or import/re-export the shared launch-request type used by that API.
- `src/App.tsx` — modify — read/subscribe to launch requests, open the settings screen, and pass a pending request into `SettingsInterface` without replaying it on later normal settings opens.
- `src/pages/SettingsInterface.tsx` — modify — translate external launch destinations to `settings-item2` / `settings-item3`, retain a one-shot dialog action until the target panel acknowledges it, then clear it.
- `src/components/settings/SettingsContent.tsx` — modify — forward the one-shot settings launch action and acknowledgement callback to the Providers or Models panel.
- `src/components/settings/models/ModelsSettingsPanel.tsx` — modify — when it receives a fresh `add-model` launch action, open `UserModelDialog` using the first configured provider and acknowledge the action only after it has been handled. Keep the existing button behavior unchanged.
- `src/components/settings/providers/ProvidersSettingsPanel.tsx` — modify — when it receives a fresh `add-custom-provider` launch action, open the existing custom `ProviderConfigDialog` and acknowledge the action.

### Create

- `src/lib/appLaunchRequest.ts` — create — define the narrow launch-request union plus serialization/parsing helpers for a fixed TideCode command-line argument. Keep parsing strict and return `null` for malformed or unsupported values.
- `electron/cli/desktopAppLaunch.ts` — create — centralize installed desktop executable discovery and detached spawning. Export the executable resolver for `cliUpdateCommand.ts` and a launch function that accepts the typed app launch request.
- `tests/cli/appLaunchRequest.test.ts` — create — cover request serialization/parsing, unsupported destinations/actions, malformed encoded payloads, and unrelated argv.
- `tests/cli/desktopAppLaunch.test.ts` — create if the executable-resolution logic can be factored into pure candidate generation — cover platform/environment candidate construction without actually spawning a process.

### Remove

- `electron/cli/cliModelInput.ts` — remove — its parsers/validators become dead code once the CLI custom-model form is removed.
- `tests/cli/cliModelInput.test.ts` — remove — tests only the deleted CLI form helpers; model validation remains owned by the desktop model dialog/shared model store.

### Inspect/reference only during implementation

- `electron/cli/models.ts` — verify custom models remain present/selectable after removing direct CLI store mutations.
- `src/components/settings/models/UserModelDialog.tsx` — reuse as the single custom-model add/edit form; do not duplicate its fields in the new launch bridge.
- `src/components/settings/providers/ProviderConfigDialog.tsx` — reuse for the fallback custom-provider setup action.
- `src/components/settings/settingsItems.ts` — use the existing Providers/Models item IDs rather than adding duplicate navigation concepts.
- `electron/settings/bootstrap.ts` — use as the pattern for safe `additionalArguments` serialization/parsing, but keep app launch requests separate from persistent settings bootstrap data.
- `tests/cli/updateRequest.test.ts` — ensure the existing update argument behavior remains compatible with the new app-launch argument handling.

## 4. Implementation Plan

1. **Introduce a narrow app-launch request contract.**
   - Add `src/lib/appLaunchRequest.ts` with a discriminated union for only the destinations/actions needed by this task.
   - Prefer semantic values such as `{ screen: 'settings', section: 'models', action: 'add-model' }` and `{ screen: 'settings', section: 'providers', action: 'add-custom-provider' }` rather than exposing `settings-item2`/`settings-item3` across process boundaries.
   - Add a fixed argument prefix such as `--tidecode-launch=` and serialize an encoded JSON payload or another deterministic compact form.
   - Parsing must validate every enum value and reject malformed payloads; never treat the value as a URL, filesystem path, JavaScript expression, or arbitrary IPC channel.
   - Keep update-request parsing (`--tidecode-install-update`) independent so both features remain explicit and testable.

2. **Create a reusable CLI desktop launcher.**
   - Move `findInstalledTideCodeExecutable()` out of `cliUpdateCommand.ts` into `electron/cli/desktopAppLaunch.ts` without changing the currently verified packaged-app search locations.
   - Add `launchTideCodeDesktop(request)` that:
     - finds the packaged desktop executable;
     - serializes exactly one validated TideCode launch argument;
     - spawns it detached with ignored stdio and `windowsHide: true`, matching the update command’s non-blocking launch behavior;
     - calls `unref()`;
     - returns a structured success/failure result instead of throwing user-facing errors directly.
   - Keep development/source CLI behavior safe: if no packaged desktop executable can be resolved, return a failure that `/model` can render as “Open TideCode → Settings → Models” rather than attempting to spawn arbitrary commands or the current Node executable.
   - Update `cliUpdateCommand.ts` to import the shared executable resolver so update installation behavior does not regress.

3. **Simplify `cliModelCommand.ts` to selection plus desktop handoff.**
   - Delete the custom-model form functions and dependencies: provider-form option assembly used only by the wizard, input validation/parsing, reasoning-form construction, image-support form, direct `saveCustomModelConfig` / `removeCustomModelConfig`, and custom-model management menus.
   - Preserve `getTideCodeSystemModels()`, `getConfiguredProviderModels()`, `findSystemModel()`, model descriptions/badges, direct switching, `/model list`, and current-model selection.
   - Replace the first interactive actions with desktop-oriented entries, for example:
     - `+ Add model in desktop app`;
     - `Manage models in desktop app`.
   - Do not return early merely because `selectableModels.length === 0`; the interactive menu must still expose the desktop setup actions when the user has no model available yet.
   - For `/model add` / `/model new`:
     - determine whether at least one provider is configured using the existing provider/snapshot evidence already available to the command;
     - if yes, launch `{ settings/models, add-model }`;
     - if no, launch `{ settings/providers, add-custom-provider }` as the actionable fallback;
     - render a concise success/info line when the launch request is handed off, or a warning with the manual settings path when no desktop executable is found.
   - For legacy `/model edit ...`, `/model remove ...`, and `/model delete ...` invocations:
     - stop mutating the model store from the CLI;
     - launch Settings → Models without attempting to interpret the model as an edit target;
     - tell the user model editing/removal now lives in the desktop Models settings.
     - This preserves a useful response for users with old muscle memory while enforcing the new single management surface.
   - Update `/model help`, list footer text, menu footer, and menu descriptions accordingly.

4. **Remove dead CLI model-form code.**
   - Confirm `cliModelInput.ts` has no remaining production imports after the `cliModelCommand.ts` cleanup, then delete it.
   - Delete `tests/cli/cliModelInput.test.ts` because it tests the removed CLI-only parsers.
   - Do not remove shared model validation/store code used by `UserModelDialog`, model IPC handlers, or runtime execution.

5. **Deliver launch requests through Electron for both cold and already-running desktop instances.**
   - In `electron/main.ts`, parse a valid launch request from `process.argv` before the initial window is created.
   - Extend `createWindow` / `createApplicationWindow` so a cold-start request is added to the preload `additionalArguments` along with the initial settings payload.
   - In the existing `second-instance` handler:
     - retain the higher-priority update-install request branch;
     - parse a normal app launch request from the second instance’s `argv`;
     - restore/show/focus the current window as today;
     - send only validated requests to the renderer on a dedicated channel such as `app:launchRequest`.
   - If a second-instance request arrives while no window exists and `createWindow()` must recreate it, carry that request into the newly created window’s initial arguments rather than dropping it.
   - Do not allow the CLI request to close chats, change workspace paths, or mutate provider/model state directly; it is navigation intent only.

6. **Expose a typed launch API in preload.**
   - Add a small `TideCodeAppApi` (or equivalently named contract) to the renderer API types.
   - `getInitialLaunchRequest()` should synchronously parse the preload process arguments supplied by `createApplicationWindow` and return a validated request or `null`.
   - `onLaunchRequest(listener)` should subscribe to the dedicated main-process event and return an unsubscribe callback, following the existing provider/update event patterns.
   - Expose it as `window.tidecodeApp` and declare the global in `electron/electron-env.d.ts`.
   - Keep raw `ipcRenderer` use out of React components for this feature.

7. **Convert external launch requests into one-shot settings navigation in `App.tsx` / `SettingsInterface.tsx`.**
   - `App.tsx` should initialize from `window.tidecodeApp.getInitialLaunchRequest()` and subscribe to future requests.
   - A valid request should switch `activeScreen` to `settings` and store it as a pending external request.
   - Pass the pending request and a consume callback to `SettingsInterface`.
   - `SettingsInterface` should map semantic sections to existing item IDs:
     - providers → `settings-item2`;
     - models → `settings-item3`.
   - When a request arrives, set `activeItemId`, copy its action into local one-shot panel-action state, then tell `App.tsx` the external request has been consumed. This prevents the same request from replaying if the user later closes Settings and opens it normally.
   - Keep the panel action locally until the target panel acknowledges it; then clear it so switching away and back within Settings does not reopen a dialog unexpectedly.
   - A later CLI invocation while Settings is already open must replace/trigger a fresh one-shot action and navigate to the requested section again.

8. **Open the existing desktop dialogs from one-shot panel actions.**
   - Extend `SettingsContent.tsx` to pass the relevant action token/payload only to the active Providers or Models panel, plus an acknowledgement callback.
   - In `ModelsSettingsPanel.tsx`:
     - watch for a fresh `add-model` action;
     - wait until provider state is available;
     - choose the first configured provider using the same `configuredProviders` list already used by the Add model button;
     - set `dialogState` exactly as the button does;
     - acknowledge only after the request has either opened the dialog or been deterministically rejected because provider state is loaded and no provider is available.
     - The ordinary Add model button must continue to work independently.
   - In `ProvidersSettingsPanel.tsx`:
     - watch for a fresh `add-custom-provider` action;
     - set `dialog` to `{ kind: 'custom' }`, exactly matching the existing button;
     - acknowledge the one-shot action after opening.
   - Do not create parallel versions of `UserModelDialog` or `ProviderConfigDialog` for CLI launches.

9. **Update adjacent CLI messaging.**
   - Change `/model` command metadata in `electron/cli/commands.ts` to advertise browse/switch/list plus opening desktop model management, not terminal edit/remove forms.
   - Update `electron/cli/cliProviderCommand.ts` messages that currently say custom-provider models are created directly with `/model add`; clarify that `/model add` opens the desktop model setup UI.
   - Leave the `/provider` terminal configuration implementation itself unchanged in this task; the user requested removal of the custom-model CLI form, not a broader provider-management migration.

10. **Validate end to end.**
    - Run `npm run typecheck`.
    - Run the full Node test suite with `npm test` or, at minimum, all changed/new CLI/app-launch tests plus the existing update-request tests.
    - Run a packaged or installed CLI because desktop executable discovery is specifically a packaged-app behavior.
    - Verify both desktop states:
      - desktop app closed when `/model add` runs;
      - desktop app already running when `/model add` runs.
    - Verify both configuration states:
      - at least one provider configured → Models + Add model dialog;
      - no provider configured → Providers + Add custom provider dialog.
    - Verify existing model switching remains instant and does not launch Settings.
    - Verify legacy edit/remove CLI invocations no longer change stored model data.

## 5. Security and Reliability

- Treat the CLI-to-desktop argument as untrusted process input even though TideCode generated it. Parse to a strict finite union and ignore malformed/unsupported values.
- Never accept an arbitrary URL, file path, renderer component name, IPC channel, or command in the launch payload.
- Spawn only an executable path resolved by the existing TideCode installed-app lookup; never interpolate user input into a shell command. Continue using `spawn` without `shell: true`.
- Keep the launch request navigation-only. Saving/removing providers and models must still flow through the existing desktop dialogs and IPC validation/store layers.
- Preserve the existing single-instance behavior so repeated CLI commands focus the same desktop process rather than creating competing app instances.
- Ensure cold-start launch requests are not lost before React subscribes by passing them through `additionalArguments`; use the event channel only for requests that arrive after the desktop process is already alive.
- Consume dialog actions once. A closed Add model/Add provider modal must not reopen simply because the user navigates away and back to the settings section.
- If executable discovery fails, fail gracefully in the CLI with a manual navigation instruction; do not terminate the CLI or attempt an unsafe fallback executable.
- Do not alter `interactiveTextInput` / `interactiveSelect` redraw semantics in this change. They are shared by provider/settings flows and changing them would create a larger regression surface than necessary to satisfy the requested model-flow redesign.

## 6. Tests

### `tests/cli/appLaunchRequest.test.ts` — add

Cover:

- round-trip serialization/parsing for Models + `add-model`;
- round-trip serialization/parsing for Providers + `add-custom-provider`;
- section-only request for opening Models management;
- unrelated argv returns `null`;
- malformed URI/JSON returns `null` without throwing;
- unsupported screen/section/action values are rejected;
- multiple unrelated arguments do not affect request parsing.

### `tests/cli/desktopAppLaunch.test.ts` — add if helper extraction supports pure testing

Cover platform/environment candidate generation for the installed desktop executable. Do not spawn the real app from unit tests.

### Existing CLI regression coverage — update/add

Add pure helper coverage if `cliModelCommand.ts` extracts a target decision function, for example:

- configured provider available → Models + Add model;
- no configured provider → Providers + Add custom provider.

If command execution itself is not easily unit-testable because of process/spawn dependencies, keep the target decision and launch serialization as pure exported helpers and test those seams instead of introducing a large mock harness.

### Remove obsolete test

- Remove `tests/cli/cliModelInput.test.ts` with `electron/cli/cliModelInput.ts` after confirming no remaining imports.

### Existing regression tests to run

- `tests/cli/updateRequest.test.ts` — update request parsing remains independent.
- `tests/cli/cliManagementSettings.test.ts` — shared CLI/desktop settings behavior remains unchanged.
- Full `npm test` and `npm run typecheck`.

### Manual integration checks

Because the repository’s tests are Node-based and there is no verified React DOM test harness in the explored tree, manually verify the renderer handoff in the packaged/installed application:

- `/model add` from a CLI with a running desktop window opens/focuses that window and opens the expected modal.
- `/model add` from a CLI with desktop closed cold-starts into the expected settings page/modal.
- Closing the modal and later reopening Settings manually does not reopen it.
- Running `/model add` a second time while Settings is already open triggers a fresh modal action.
- `/model` still lists and switches to an existing custom model.
- `/model` with zero selectable models still offers the desktop setup actions instead of returning only a warning.
- `/model edit ...` and `/model remove ...` cannot mutate model files/store from the terminal anymore.

## 7. Documentation / Configuration

- No new environment variable or persistent setting is required.
- No model/provider storage migration is required; the shared stores and desktop dialogs remain the source of truth.
- Update CLI help/usage strings in `electron/cli/commands.ts` and `cliModelCommand.ts` so documented behavior matches the new desktop handoff.
- Update related `/provider` footer/info text in `electron/cli/cliProviderCommand.ts` so it does not imply a CLI model form still exists.
- README changes are only necessary if implementation discovers CLI-specific model-management documentation beyond the currently generic model-connection feature description.

## 8. Definition of Done

- The CLI contains no reachable custom-model add/edit form and no direct custom-model save/remove path.
- `electron/cli/cliModelInput.ts` and its obsolete tests are removed with no remaining imports.
- `/model` still browses, lists, and switches configured built-in/custom models.
- `/model` remains useful even when zero models are configured by exposing desktop setup actions.
- `/model add` opens/focuses the desktop app:
  - configured provider exists → Settings → Models with Add model dialog open;
  - no configured provider exists → Settings → Providers with Add custom provider dialog open.
- Legacy `/model edit` / `/model remove` commands route users to desktop Models settings and cannot modify the custom-model store directly.
- Cold-start and already-running desktop launch requests both work through the single-instance Electron architecture.
- Launch payloads are strictly validated and cannot navigate to arbitrary external resources or execute arbitrary commands.
- Closing a launch-opened dialog consumes the request; normal later Settings navigation does not reopen it.
- Existing `/provider`, model selection, provider/model stores, and update-install launch behavior continue working.
- The visible terminal drift from stepping through the custom-model wizard is eliminated because that sequential wizard no longer exists.
- `npm run typecheck` and the relevant/full test suite pass, and packaged CLI integration checks cover both desktop lifecycle states.
