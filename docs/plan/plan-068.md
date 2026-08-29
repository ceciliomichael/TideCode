# Ripgrep search overflow reliability

## Goal
Prevent broad AI grep searches from failing when native ripgrep stdout exceeds its 16 MiB safety cap.

## Changes
- Keep the 16 MiB cap as a memory-safety boundary.
- Add an opt-in ripgrep mode for grep searches that stops the child at the stdout cap and returns only complete buffered lines with a truncation marker instead of rejecting.
- Keep stderr overflow and non-grep callers on the existing fail-fast behavior.
- Make grep pagination report truncated/incomplete results honestly without claiming an exact total count.
- Preserve explicit ignored-directory search behavior and existing visibility filtering.

## Verification
- Add a ripgrep regression for successful stdout truncation while preserving the existing fail-fast default test.
- Add/update workspace grep coverage for truncated page semantics.
- Run ripgrep/workspace tool tests and TypeScript typecheck.

## Scope
Only ripgrep stdout overflow handling and grep result semantics. No changes to workspace instruction behavior or unrelated search features.
