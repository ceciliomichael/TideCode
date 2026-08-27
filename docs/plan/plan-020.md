Status: implemented

# Plan 020: One visual diff card per file

## Goal
Keep all same-file patch hunks inside one visible diff card with one filename header, while preserving each hunk's own line context.

## Findings
The tool invocation is already grouped to one entry per file. The remaining duplication comes from FileChangeDiffResult rendering one full DiffViewer card per change item. DiffViewer already supports a stacked layout, so the safest approach is to reuse it inside one outer card rather than merging source snippets artificially.

## Changes
- Add a small DiffViewer option to suppress its header when embedded under an existing same-file header.
- Render same-file change items inside one outer rounded card, using stacked DiffViewer bodies and only the first filename header.
- Preserve each hunk's own old/new content, start line, and context settings.
- Keep ordinary single-change DiffViewer rendering unchanged.

## Verification
- Add a focused static-render regression proving two same-file hunks render one filename header/card container while both diff bodies remain present.
- Run focused presentation/component tests, TypeScript checking, and scoped git diff --check.

## Scope boundaries
No apply_patch parsing, matching, mutation, or grouping changes.
