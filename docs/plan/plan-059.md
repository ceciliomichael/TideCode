# Plan 059: Remove compaction fallback code

## Goal
Make compaction fully AI-driven in production and remove the remaining deterministic fallback implementation from the repository.

## Changes
- Delete the production compaction fallback module.
- Replace tests that imported the fallback builder with a small test-only packet fixture that creates explicit valid packet data without summarizing messages or inferring state.
- Keep historical `usedFallback` event metadata readable for backward compatibility with existing saved conversations, but do not execute any fallback behavior.
- Preserve the active/settled lifecycle protections, prompt-ledger rules, invalid-output rejection, compaction thresholds, projection, and provider behavior from Plan 057.

## Reliability verification
- Keep tests proving valid AI Markdown compacts normally.
- Keep tests proving invalid, empty, and meta-only AI output is rejected rather than committed.
- Keep active-turn tests proving the current request remains open even if the compactor claims completion.
- Run focused compaction/history/provider-migration tests, typecheck, targeted lint, the full test suite, and `git diff --check`.

## Scope
No migration or removal of historical event fields, no changes to compaction budgets or triggers, and no unrelated cleanup.
