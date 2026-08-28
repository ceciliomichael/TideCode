# Plan 057: Preserve active work across AI compaction

## Goal
Prevent automatic compaction from marking the current user request completed while the assistant is still working.

## Changes
- Add an explicit compaction turn lifecycle signal: `active` while automatic compaction runs inside a live provider/tool loop, and `settled` for final/manual compaction.
- Pass that lifecycle into the compaction request so the compactor never infers overall task completion from successful intermediate tools.
- Make the user-prompt ledger keep the latest compacted user prompt open during an active turn, and allow that authoritative active state to correct a stale completed status for the same prompt.
- Tighten the compression prompt to distinguish completed substeps from completion of the overall user request.
- Make runtime compaction AI-only: invalid, empty, or meta-only AI output fails the compaction attempt instead of generating a deterministic fallback handoff.
- Keep older completed turns and existing compaction projection/window behavior unchanged.

## Verification
- Add focused regression tests for active tool-loop compaction, repeated compaction status correction, settled completed work, and settled incomplete/blocked work.
- Run focused compaction tests, typecheck, targeted lint, full test suite, and `git diff --check`.

## Scope
No changes to compaction thresholds, token budgets, window selection, provider selection, or unrelated history/runtime behavior. The deterministic packet builder may remain for tests/history fixtures, but it is not used by the runtime compaction path.
