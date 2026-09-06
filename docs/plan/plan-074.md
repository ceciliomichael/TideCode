# Code Mode reliability hardening

## Goal
Make Code Mode reliable without weakening Plan Mode safety.

## Changes
- Force Plan Mode Code Mode to sandbox authority even when terminal Full Access is selected.
- Replace regex/line-based import lowering with parser-based handling for static and dynamic imports.
- Resolve Full Access imports and require calls relative to the selected workspace.
- Define native async lifetime as explicit Promise/await completion and add a real local HTTP completion regression test.
- Align Code Mode prompt text with Sandbox, Full Access, and Plan Mode behavior.
- Preserve the narrow high-confidence syntax repairs and existing tool-call recovery behavior.

## Dependency
- Add Acorn as a runtime dependency for deterministic JavaScript parsing. It is small, established, and already present transitively in development, but must be a direct runtime dependency for packaged builds.

## Verification
- Add regression tests for Plan Mode isolation, same-line/interleaved imports, workspace-only package resolution, dynamic imports, and awaited native HTTP completion.
- Run Code Mode tests, typecheck, changed-file lint, git diff checks, and the full tool test suite.

## Scope
Only Code Mode runtime/import/reliability behavior, related prompts/UI wording, tests, and the parser dependency.
