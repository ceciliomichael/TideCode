# Remove AI-facing full_file reads

## Goal

Remove `full_file` from the model-visible `read` contract so every text read uses bounded offset/limit paging, while preserving safe compatibility for historical internal calls.

## Implementation

- Remove `full_file` from the read tool schema, description, and live execution input.
- Keep the legacy internal read flag only as a compatibility path, but normalize it to a bounded first page instead of an unbounded read.
- Update focused read and Code Mode tests to prove the public schema no longer exposes `full_file` and legacy calls cannot bypass the line/byte budget.
- Preserve historical replay fixtures that merely contain old Code Mode source because replay should remain byte-stable.

## Verification

- Run focused read, tool-schema, and Code Mode tests.
- Run TypeScript typecheck and targeted lint.
- Run the complete test suite and `git diff --check`.
