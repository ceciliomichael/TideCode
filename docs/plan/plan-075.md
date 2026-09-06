# Code Mode import semantics hardening

## Goal
Complete Code Mode reliability hardening so import authorization fails closed, Full Access imports use workspace-relative ESM resolution while require keeps CommonJS resolution, and static imports retain familiar module semantics without weakening Sandbox or Plan Mode.

## Implementation
- Add focused regressions first for parser/function-body mismatches, nested and repaired imports, ESM conditional exports, workspace-only and relative modules, import hoisting, live/read-only bindings, missing exports, scope shadowing, and generated-name collisions.
- Make the post-normalization parser pass authoritative: parse failure is an execution error, all dynamic imports are identified and redirected, and Sandbox/Plan Mode reject module loading before worker or tool side effects.
- Compile static imports into a real ESM wrapper around the existing async Code Mode body so native module binding semantics provide hoisting, live bindings, read-only bindings, and missing-export validation while preserving top-level await, top-level return, and injected tools.
- Resolve ESM specifiers relative to the selected workspace with ESM conditions, while retaining createRequire-based CommonJS resolution for require(). Use only runtime behavior verified against the project Node/Electron versions.
- Keep existing narrow literal/payload repairs, tool recovery, promise draining, cancellation, provider transport, and Plan Mode sandboxing unchanged.
- Update the model-facing contract to match the resulting runtime behavior.

## Verification
- Run the new Code Mode regressions, existing Code Mode/reliability/repair/output and relevant compaction tests, npm run test:tools, npm run typecheck, changed-file ESLint, and git diff --check.
- Use only local fixtures and a local HTTP server.

## Scope
Code Mode import parsing/compilation/resolution, related prompt text, focused tests, and a resolution dependency only if the verified runtime lacks a suitable built-in ESM resolver.
