# TideCode Development Workflow and Verification

## Toolchain

TideCode is a TypeScript/React/Electron application built with Vite. The package declares Node.js 20 or newer for local development. TypeScript is strict, uses bundler module resolution, enables `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and includes both `src` and `electron`.

Important package scripts:

- `npm run dev`: start the Vite/Electron development flow after syncing the ripgrep binary and generating Electron icons.
- `npm run typecheck`: run `tsc --noEmit`.
- `npm test`: run the Node test runner through `tsx`.
- `npm run test:tools`: run focused tool/provider/script tests.
- `npm run lint`: run ESLint with unused-disable reporting and zero warnings.
- `npm run build`: compile and build the renderer/Electron artifacts.
- `npm run dist*`: build installers for the configured platform; these are packaging operations, not routine regression checks.

## Repository structure for changes

- `src/pages/`: page-level composition and feature orchestration for renderer screens.
- `src/components/`: reusable UI and feature components.
- `src/hooks/`: stateful renderer workflows and subscriptions.
- `src/lib/`: pure functions, contracts, sanitizers, sizing, formatting, and domain logic that can run without Electron.
- `src/types/`: cross-process TypeScript contracts.
- `electron/<capability>/`: main-process side effects and capability services.
- `electron/ipc/`: narrow IPC adapters only.
- `tests/`: focused Node or React tests organized around behavior.
- `docs/`: product context, protocol guides, research, plans, and reusable instructions.

## Preferred implementation sequence

1. Read the relevant types, service, existing tests, and neighboring implementation before changing code.
2. Identify the narrowest integration point and reuse an existing utility or contract.
3. Put pure normalization/validation in `src/lib` when it does not require Electron or filesystem access.
4. Put I/O, process, credential, watcher, and native integrations in an isolated `electron` service.
5. Thread new behavior through typed preload/API contracts rather than broadening the renderer bridge.
6. Add or update the focused regression test before broad checks when practical.
7. Run the smallest decisive verification first, then typecheck/lint/build as proportionate to the affected boundary.
8. Inspect the final diff and confirm no unrelated files or behavior changed.

## Test organization patterns

Tests cover chat state/workflows, Markdown and image handling, provider/model behavior, MCP, Git, settings, skills, updates, Kanban/plan handoff, workspace Explorer, terminal-adjacent behavior, and UI sizing/theme behavior. Pure utilities generally have direct unit tests; renderer state transitions are tested through workflow-focused modules; Electron services are tested with isolated stores or mocked boundaries where possible.

When changing chat runtime or persistence, prioritize tests around stream terminal state, pending-message rollback, compaction markers/status, history replacement, canonical replay, context usage, and checkpoint/revert behavior. When changing workspace or security code, prioritize traversal, symlink, ownership, URL protocol, clipboard, and watcher tests.

## Formatting and source hygiene

Preserve the local human-readable style. Do not minify, collapse, or rewrite unrelated code. Keep imports, types, and module responsibilities clear. Avoid introducing dependencies, migrations, abstractions, or cleanup not required by the requested behavior.

The project has native code paths (`node-pty`, Electron, ripgrep, icons, installers) that may make a full build environment-sensitive. Report unavailable or unrelated failures accurately rather than treating a command exit code as proof of behavior that was not exercised.

## Release awareness

The package version currently declares `1.1.3`. The README describes Windows x64, macOS, and Linux AppImage release targets. Packaging scripts generate icons and installer assets before invoking Electron Builder. Release work should use the documented release scripts and `docs/git-push-protocol.md` rather than improvising credential or publishing behavior.

## Durable engineering expectations

- No fake success paths or placeholder implementations.
- Keep orchestration, domain logic, persistence, validation, state, and UI separated.
- Do not claim a check passed unless it actually tested the changed boundary.
- Fix failures caused by the change; distinguish unrelated baseline failures.
- Preserve existing user work and inspect Git status before mutation.

Verified against `package.json`, TypeScript/Vite configuration, README build instructions, test layout, and repository structure on August 11, 2026.
