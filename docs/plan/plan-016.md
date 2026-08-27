Status: implemented

# Plan 016: Safe out-of-order apply_patch recovery

## Goal
Prevent unnecessary apply_patch failures when a model emits unique hunks for one file out of source order, while preserving deterministic and safe matching for repeated or overlapping hunks.

## Findings
The current matcher advances a per-file search cursor after every resolved hunk. The failing history emitted a hunk around line 270 before a unique hunk around line 220, so the earlier hunk could no longer be found even though its source text was still present and unambiguous.

## Changes
- Keep the existing top-to-bottom sequential matcher as the primary path.
- If a non-empty update hunk cannot be found after the current cursor, search the original file for all exact/whitespace-equivalent matches.
- Recover only when exactly one match exists in the whole original file and its source range does not overlap any previously resolved replacement.
- Keep repeated/ambiguous matches and overlapping ranges as errors.
- Do not change patch parsing, atomic verification/writes, partial-line rejection, or insertion semantics.

## Verification
- Add a regression matching the history shape where a later source hunk is emitted before an earlier unique hunk.
- Assert repeated/ambiguous out-of-order hunks still fail instead of guessing.
- Assert overlapping out-of-order recovery is rejected.
- Run the apply_patch test suite, typecheck, and scoped git diff --check.
