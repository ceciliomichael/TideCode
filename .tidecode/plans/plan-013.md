---
status: implementation_started
---

# Move workspace editor change markers beside line numbers

## Goal
Move the blue changed-line and green added-line markers from the gap immediately before the code text into the gutter beside the line numbers, without changing their colors or which lines are marked.

## Findings
- Git line statuses are converted to Monaco model decorations in `src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoDecorations.ts`.
- The decorations currently use `linesDecorationsClassName`, which renders in the line-decoration lane between line numbers and code.
- The shared Monaco options in `workspaceMonacoConfig.ts` disable the glyph margin and reserve an 18px line-decoration lane.
- The marker colors and borders are defined in `src/index.css`; the existing CSS can be reused when the class is rendered in the glyph margin.
- Existing tests cover decoration ordering and shared Monaco options, but not the decoration placement class.

## Implementation
1. Enable Monaco’s glyph margin in the shared workspace editor options and remove the now-unused line-decoration lane width.
2. Change the Git status decoration field from `linesDecorationsClassName` to `glyphMarginClassName`, keeping the existing added/changed classes and CSS colors.
3. Extend the Monaco decoration/config tests to verify the glyph-margin placement and gutter sizing while preserving status ordering.
4. Run the focused Monaco tests and the project typecheck.

## Acceptance
- Changed lines show the blue marker immediately beside the line-number gutter.
- Added lines show the green marker in the same gutter position.
- No marker remains at the code-text edge, and line numbers/code alignment remains readable.
- Existing Monaco decoration behavior and tests remain passing.
