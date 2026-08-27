Status: implemented

# Plan 021: Correct apply_patch diff line numbers

## Goal
Show each apply_patch diff hunk at its actual resolved source line instead of defaulting every hunk to line 1.

## Findings
The matcher already resolves an exact zero-based source index for every update chunk, but that position is discarded. createPatchPresentationChanges therefore emits no startLineNumber, and DiffViewer falls back to 1.

## Changes
- Let applyUpdateChunks report each resolved chunk position without changing matching behavior.
- Store those resolved start lines on the staged update change.
- Copy the corresponding startLineNumber onto each per-hunk change_diff presentation item.
- Keep add/delete/move behavior unchanged.

## Verification
- Extend the existing multi-hunk apply_patch presentation regression to assert actual start lines.
- Run focused apply_patch and diff presentation tests, npm run typecheck, and scoped git diff --check.

## Scope boundaries
No changes to patch matching rules, mutation ordering, atomic writes, or UI grouping.
