Status: implemented

# Plan 018: Tolerant patch envelope and one block per file

## Goal
Accept harmless duplicated or echoed outer patch wrappers around an otherwise valid canonical patch, and show all changes for the same file in one tool block.

## Findings
The latest failure contains duplicate opening wrappers plus a canonical *** End Patch followed by a bare EndPatch echo. The parser is strict about the entire payload, so that trailing wrapper echo invalidates the patch. The chat presentation also expands each change_diff item independently, which creates duplicate rows for multiple hunks in one file even though the renderer can display multiple diffs in one block.

## Changes
- Normalize only wrapper-like BeginPatch/EndPatch echoes at the outer edges when a canonical *** Begin Patch / *** End Patch envelope is present.
- Keep interior markers and arbitrary extra content strict and rejected.
- Group completed change_diff presentation items by normalized file name so each distinct file produces one display block while preserving per-file hunk order.
- Make multi-change same-file headers resolve the file name correctly.
- Make repeated same-file diff renderer keys unique.

## Verification
- Add an exact regression for the latest malformed envelope shape.
- Keep interior malformed marker rejection covered.
- Add same-file grouping and mixed-file presentation regressions.
- Run focused apply_patch and presentation tests, npm run typecheck, and scoped git diff --check.
