---
status: draft
---

# Make the TideCode editor project-aware like VS Code

# Make the TideCode editor project-aware like VS Code

## Problem

The imports shown as errors in `src/App.tsx` are valid project imports. The issue is the editor integration, not those import statements.

TideCode currently gives Monaco the active file a virtual URI such as `file:///workspace/src/App.tsx`, but its TypeScript worker is not given the rest of the workspace, the active TypeScript configuration, or the dependency declaration files needed to resolve imports. This makes valid local imports and packages such as `react` appear missing.

The current implementation also only defines themes in `beforeMount`. There is no call to configure `typescriptDefaults` or `javascriptDefaults`, no project file synchronization, and no extra library registration. The existing model cache only retains recently opened editor models, so it cannot act as a project graph.

## Goal

Make TypeScript and JavaScript editing behave much closer to VS Code for project resolution:

- Resolve relative imports without requiring the target file to be opened first.
- Respect the applicable `tsconfig.json` or `jsconfig.json`.
- Support `moduleResolution`, JSX mode, `baseUrl`, `paths`, JSON modules, and related compiler options.
- Resolve installed package typings from `node_modules` and `@types` without loading all of `node_modules` into the renderer.
- Keep diagnostics, completion, hover, and Go to Definition useful.
- Update project state after files, configs, or dependencies change.
- Avoid showing known-false semantic diagnostics while project metadata is still loading.

## Implementation plan

### 1. Pass the active workspace into the Monaco editor

Thread `workspaceRootPath` through the existing editor path:

- `src/components/workspaceExplorer/workspaceFileTabsPanel/WorkspaceFileTabsPanelContent.tsx`
- `src/components/workspaceExplorer/WorkspaceFileEditor.tsx`
- `src/components/workspaceExplorer/workspaceFileEditor/useWorkspaceMonacoEditor.ts`

`WorkspaceFileTabsPanel` already has `workspaceRootPath` and passes it to `WorkspaceFileTabsPanelContent`, but `WorkspaceFileTabsPanelContent` currently stops passing it when it creates `WorkspaceFileEditor`.

Use both `workspaceRootPath` and the active relative file path as the identity of the TypeScript project being edited.

### 2. Add an Electron-side TypeScript project snapshot service

Add a workspace service, for example `electron/workspace/typescriptProject.ts`, which receives the workspace root and active relative file path and builds a compact project snapshot using the installed TypeScript compiler API.

For each active TS/JS file:

1. Walk upward from the file directory to find the nearest applicable `tsconfig.json` or `jsconfig.json` inside the workspace. This is important for monorepos and nested projects.
2. Parse the config with TypeScript APIs rather than reimplementing config inheritance and compiler option semantics.
3. Return the effective compiler options in a serializable form.
4. Return project source files needed by Monaco using stable workspace-relative paths.
5. Resolve imported packages through TypeScript module resolution and include only the declaration files actually needed from dependencies and `@types`.
6. Use an inferred-project configuration when no config file exists.

Do not recursively expose all of `node_modules`. The existing workspace listing intentionally ignores it, and sending an entire dependency tree to the renderer would be expensive.

### 3. Add a typed workspace API for project snapshots

Add request/result types in:

- `src/types/chat/workspace.ts`
- `src/types/chat/apis.ts`

Add the IPC handler in:

- `electron/ipc/registerWorkspaceIpcHandlers.ts`

Expose the method from:

- `electron/preload.ts`

Wire the same method through the existing `tidecodeWorkspace` remote RPC path so local desktop and remote browser sessions use the same contract.

A snapshot should have a stable project identity and contain enough information for incremental refresh, for example:

- project/config identifier
- effective compiler options
- source files with virtual URI, content, and version
- dependency declaration files with virtual URI, content, and version
- config path or inferred-project marker

### 4. Configure Monaco from the actual project

Add a renderer service such as:

- `src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoProjectService.ts`

or a small hook plus a service cache.

The service should configure `monaco.languages.typescript.typescriptDefaults` and `javascriptDefaults` from the project snapshot rather than Monaco defaults.

For this repository, that includes the equivalent of the current root `tsconfig.json`, such as:

- target ES2022
- module ESNext
- module resolution Bundler
- JSX `react-jsx`
- `allowSyntheticDefaultImports`
- `esModuleInterop`
- `resolveJsonModule`
- `skipLibCheck`
- configured `baseUrl` and `paths` when present

Map serialized TypeScript options to Monaco TypeScript enum values in one tested helper rather than scattering conversions through the editor hook.

Also enable eager model synchronization where useful so opened models remain in sync with the TypeScript worker.

### 5. Synchronize project files using the same URI namespace as open editor models

Keep `createWorkspaceMonacoModelPath()` as the canonical URI mapping and use the exact same `file:///workspace/...` paths for project source files supplied to the TypeScript worker.

Register unopened source files and dependency declaration files as Monaco extra libraries, or an equivalent project-file registration mechanism. When a file becomes an editable Monaco model, ensure there is no conflicting stale extra-lib copy for that same URI.

Maintain registrations per project and dispose them when:

- the active workspace changes
- the applicable config changes
- files are removed or renamed
- a cached project is evicted

This makes relative imports resolve because `file:///workspace/src/App.tsx` and `file:///workspace/src/pages/ChatInterface.tsx` now exist in one coherent TypeScript project namespace.

### 6. Prevent false red squiggles during project startup

Do not permanently disable TypeScript diagnostics.

While a project snapshot is loading, temporarily suppress semantic validation that depends on module resolution. Keep syntax diagnostics available. Once the snapshot and compiler options are registered, enable normal semantic diagnostics again and trigger revalidation.

If project loading fails, show a small editor-level status/error indication and avoid presenting unresolved-module diagnostics as if they were authoritative.

### 7. Make project synchronization incremental

Reuse the existing workspace change/watch infrastructure to invalidate only affected project data.

Refresh or invalidate when relevant files change, especially:

- `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.d.ts`, JSON modules
- `tsconfig*.json` and `jsconfig*.json`
- `package.json`
- lockfiles
- declaration files selected by dependency resolution

Cache parsed configs and dependency snapshots by workspace/config identity. Avoid rebuilding the whole project on every tab switch or keystroke.

Use limits for source count, declaration count, and total serialized bytes. Large-project fallback should preserve editing and syntax highlighting even if full semantic indexing is temporarily unavailable.

### 8. Add tests that cover the failure shown in the screenshot

Extend `tests/components/workspaceExplorer/workspaceMonacoConfig.test.ts` for compiler-option and URI mapping helpers.

Add Electron/project-service tests with fixture workspaces covering:

- a relative import from `src/App.tsx` to another TS/TSX file
- extensionless TypeScript imports
- package import resolution for `react` or a small fixture package with declarations
- `moduleResolution: Bundler`
- `baseUrl` and `paths` aliases
- inherited tsconfig using `extends`
- nearest-config selection in a monorepo
- JS projects using `jsconfig.json`
- rename/delete invalidation
- config and package dependency changes

Add renderer tests with a fake Monaco API to verify:

- compiler options are applied once per project revision
- source and declaration extra libs are registered with matching URIs
- stale registrations are disposed
- diagnostics are gated during loading and restored afterward

## Acceptance criteria

1. Opening `src/App.tsx` in TideCode no longer marks its valid local imports as missing.
2. The `react` import resolves and React/JSX typings are available.
3. Hover, completion, and Go to Definition work for local TypeScript modules without opening those files first.
4. A workspace using `compilerOptions.paths` resolves aliases correctly.
5. Nested projects use their nearest applicable TypeScript config rather than always using the workspace root config.
6. Renaming, creating, deleting, or editing an imported file updates diagnostics without restarting TideCode.
7. Changing `tsconfig.json`, `package.json`, or installed typings refreshes the project state.
8. The editor does not flash a page full of false unresolved-module errors while project metadata is loading.
9. Non-TypeScript files continue using the existing Monaco behavior without paying the TypeScript project indexing cost.

## Important design note

Changing Monaco's `moduleResolution` option alone is not sufficient. It would make the worker use a more appropriate algorithm, but the worker still cannot resolve files that were never supplied to it. Likewise, keeping more recently opened Monaco models would only fix imports after users manually open dependencies.

The fix needs both pieces: the real project compiler configuration and a project-aware file/declaration snapshot. This gives TideCode the VS Code-like pathing behavior the current editor is missing without replacing Monaco itself.
