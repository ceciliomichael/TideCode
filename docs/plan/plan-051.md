# Fix empty AI compaction failures

## Goal
Prevent compaction from failing when the model returns empty, JSON, or meta-only output, while preserving normal valid AI summaries and existing UI behavior.

## Changes
- Inspect the reported conversation history to confirm the failure shape.
- Reuse the existing deterministic fallback compaction builder when AI Markdown validation fails.
- Preserve cancellation, timeout, source range, reasoning retention, Code Mode receipts, user prompt ledger, and projection behavior.
- Add regression tests for empty, JSON, meta-only, and valid AI compaction output.

## Verification
Run focused compaction tests, typecheck, lint on touched files, and the broader compaction-related suite.

## Scope
No provider behavior changes, no UI changes, and no new dependencies.
