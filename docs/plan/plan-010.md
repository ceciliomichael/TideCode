# Plan 010: Recover duplicate apply_patch envelope markers

Status: Implemented

## Goal
Prevent a valid Code Mode patch from failing when the model accidentally repeats the outer `*** Begin Patch` or `*** End Patch` marker consecutively.

## Findings
- The recorded failure contained two leading `*** Begin Patch` lines.
- The strict parser correctly rejected the second marker as an unexpected body line.
- The model's corrected retry was cancelled before execution, so no second parser failure occurred.
- `applyPatchTool.ts` already owns the AI-facing array-to-patch normalization boundary.

## Implementation
- Normalize only consecutive duplicate begin markers at the start and duplicate end markers at the end before joining patch lines.
- Preserve all file headers, context, additions, removals, and interior control lines unchanged.
- Keep interior duplicate markers, malformed wrappers, and other invalid formats rejected by the strict parser.
- Add no dependencies and make no parser-wide or fuzzy matching changes.

## Verification
- Add regression coverage for the recorded Code Mode payload shape with a duplicate leading marker.
- Cover duplicate trailing markers and rejection of an interior duplicate marker without file mutation.
- Keep malformed wrapper rejection covered.
- Run focused apply-patch/Code Mode/mutation tests, `npm run test:tools`, `npm run typecheck`, and scoped `git diff --check`.

## Scope
Only the apply_patch model-facing normalization boundary, its regression tests, and this plan file are in scope.
