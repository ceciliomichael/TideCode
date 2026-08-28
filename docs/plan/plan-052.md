# Fix runaway chat/tool streaming memory and CPU

## Goal
Keep long, tool-heavy chats responsive while preserving the same visible tool results, final history, and provider behavior.

## Changes
- Coalesce streamed tool arguments before run-service/renderer updates and avoid reparsing incomplete JSON on every provider chunk.
- Treat partial tool arguments as transient so they are not repeatedly persisted as full conversation snapshots.
- Bound run projection cadence and run-service socket backpressure so slow renderers cannot create an unbounded event queue.
- Skip redundant renderer-side draft reconstruction for shared runs, which are already rendered from run-service projections.
- Make normal file reads stop after the requested page plus lookahead instead of scanning the whole file.
- Avoid large temporary character arrays in tool-output truncation and avoid parsing collapsed tool result bodies.

## Verification
- Add stress/regression tests for large streamed tool arguments, transient shared persistence, read pagination, and shared-run renderer behavior.
- Run focused chat/runtime/run-service/workspace tests, TypeScript typecheck, targeted ESLint, and the broader test suite if focused checks are clean.

## Scope
- No UI redesign, provider protocol change, tool execution semantic change, storage format change, or new dependency.
