# Simplify model-facing tool output recovery

## Goal
Reduce tool-result token and serialization overhead while keeping recovery reliable and preserving renderer/runtime behavior.

## Changes
- Replace tool-name/UUID recovery handles with collision-safe opaque five-digit string output IDs.
- Keep generic truncation recovery model-facing text minimal: preview plus output_id and targeted read_tool_output guidance; drop unused byte/token/range diagnostics from truncation semantics.
- Make ordinary text read byte-aware as well as line-aware so paged reads return complete safe lines with next_offset and do not need generic output truncation.
- Keep full_file only when the complete text file fits the safe model-output budget; otherwise return a normal bounded page with continuation metadata.
- Simplify read/read_tool_output model-facing paging metadata while preserving internal subject/path data needed by replay and UI.
- Reduce Code Mode serialized tool semantics to fields that actually affect model control flow or recovery, while retaining rich internal tool-call metadata for UI/compaction where required.
- Preserve terminal continuation/error recovery fields, mutation recoverability, Code Mode nested tool-call receipts, and existing tool success/error behavior.

## Verification
- Add/update focused tests for five-digit IDs, collision-safe persistence, minimal truncation notices, byte-aware read paging, full_file fallback, read_tool_output recovery, and reduced Code Mode model payloads.
- Run focused tool/read/Code Mode/canonical-history tests.
- Run typecheck, targeted lint, git diff --check, and the full test suite.

## Scope
No provider changes, UI redesign, dependency changes, or unrelated semantics cleanup outside the model-facing tool contract.